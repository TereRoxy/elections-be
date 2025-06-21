const express = require('express');
const { Server, WebSocket } = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { faker } = require('@faker-js/faker');
const { Sequelize, DataTypes } = require('sequelize');
const jwt = require('jsonwebtoken');

faker.locale = 'ro_RO'; // For Romanian names

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

// PostgreSQL connection using Railway's DATABASE_URL
const sequelize = new Sequelize(process.env.DATABASE_PUBLIC_URL, {
    dialect: 'postgres',
    logging: false,
    dialectOptions: {
        ssl: process.env.NODE_ENV === 'production' ? { require: true, rejectUnauthorized: false } : false
    }
});

sequelize.authenticate().then(() => {
    console.log('Database connection successful');
}).catch(err => {
    console.error('Database connection failed:', err);
});

// User Model
const User = sequelize.define('User', {
    cnp: {
        type: DataTypes.STRING(13),
        allowNull: false,
        unique: true,
        validate: { is: /^\d{13}$/ }
    },
    hasVoted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    votedCandidateId: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'users',
    timestamps: false
});

// Candidate Model
const Candidate = sequelize.define('Candidate', {
    id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    party: {
        type: DataTypes.STRING,
        allowNull: false
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    imageUrl: {
        type: DataTypes.STRING,
        allowNull: false
    },
    voteCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    }
}, {
    tableName: 'candidates',
    timestamps: false
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

// CORS configuration
app.use(cors({
    origin: 'https://your-frontend-app.railway.app', // Replace with your actual frontend domain
}));
app.use(express.json());

// JWT Authentication Middleware
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = { cnp: decoded.cnp };
        next();
    } catch (error) {
        console.error('JWT verification failed:', error);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};

// WebSocket connection handling with JWT verification
wss.on('connection', async (ws, req) => {
    console.log('Client connected');
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        ws.close(1008, 'Unauthorized');
        return;
    }

    const token = authHeader.split(' ')[1];
    try {
        jwt.verify(token, JWT_SECRET);
        // Send current candidates list to newly connected client
        const candidates = await Candidate.findAll();
        ws.send(JSON.stringify({ type: 'candidates', data: candidates }));
        
        ws.on('close', () => {
            console.log('Client disconnected');
        });
    } catch (error) {
        console.error('WebSocket JWT verification failed:', error);
        ws.close(1008, 'Unauthorized');
    }
});

// Broadcast candidates to all connected WebSocket clients
async function broadcastCandidates() {
    const candidates = await Candidate.findAll();
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            await client.send(JSON.stringify({ type: 'candidates', data: candidates }));
        }
    }
}

async function generateCandidate() {
    try {
        const gender = await faker.helpers.arrayElement(['men', 'women']);
        const imageId = await faker.number.int({ min: 1, max: 99 });

        return {
            id: uuidv4(),
            name: await faker.person.fullName(),
            party: await faker.helpers.arrayElement(['PNL', 'AUR', 'USR', 'Independent', 'Green Party', 'PSD']),
            description: await faker.lorem.sentence({ min: 10, max: 20 }),
            imageUrl: `https://randomuser.me/api/portraits/${gender}/${imageId}.jpg`,
            voteCount: 0
        };
    } catch (error) {
        console.error('Error generating candidate:', error);
        throw new Error('Failed to generate candidate');
    }
}

// Authentication Routes
app.post('/api/register', async (req, res) => {
    try {
        const { cnp } = req.body;
        
        if (!/^\d{13}$/.test(cnp)) {
            return res.status(400).json({ error: 'Invalid CNP format' });
        }
        
        const existingUser = await User.findOne({ where: { cnp } });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        const user = await User.create({ cnp });
        
        const token = jwt.sign({ cnp: user.cnp }, JWT_SECRET, { expiresIn: '24h' });
        res.status(201).json({ message: 'User registered successfully', token });
    } catch (error) {
        console.error('Error registering user:', error);
        res.status(500).json({ error: 'Failed to register user', message: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { cnp } = req.body;
        
        const user = await User.findOne({ where: { cnp } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ cnp: user.cnp }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ message: 'Login successful', token, hasVoted: user.hasVoted });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ error: 'Failed to login', message: error.message });
    }
});

app.post('/api/logout', (req, res) => {
    // JWT is stateless; client should discard the token
    res.json({ message: 'Logout successful' });
});

app.get('/api/check-session', authenticateJWT, async (req, res) => {
    try {
        const user = await User.findOne({ where: { cnp: req.user.cnp } });
        if (user) {
            res.json({ isAuthenticated: true, hasVoted: user.hasVoted });
        } else {
            res.json({ isAuthenticated: false });
        }
    } catch (error) {
        console.error('Error checking session:', error);
        res.status(500).json({ error: 'Failed to check session', message: error.message });
    }
});

// Voting Route
app.post('/api/vote/:candidateId', authenticateJWT, async (req, res) => {
    try {
        const { candidateId } = req.params;
        const user = await User.findOne({ where: { cnp: req.user.cnp } });
        
        if (user.hasVoted) {
            return res.status(400).json({ error: 'User has already voted' });
        }
        
        const candidate = await Candidate.findOne({ where: { id: candidateId } });
        if (!candidate) {
            return res.status(404).json({ error: 'Candidate not found' });
        }
        
        user.hasVoted = true;
        user.votedCandidateId = candidateId;
        candidate.voteCount += 1;
        
        await user.save();
        await candidate.save();
        await broadcastCandidates();
        
        res.json({ message: 'Vote recorded successfully' });
    } catch (error) {
        console.error('Error voting:', error);
        res.status(500).json({ error: 'Failed to record vote', message: error.message });
    }
});

// CRUD Routes (protected)
app.get('/api/candidates', authenticateJWT, async (req, res) => {
    try {
        const candidates = await Candidate.findAll();
        res.json(candidates);
    } catch (error) {
        console.error('Error fetching candidates:', error);
        res.status(500).json({ error: 'Failed to fetch candidates', message: error.message });
    }
});

app.post('/api/candidates', authenticateJWT, async (req, res) => {
    try {
        const candidate = await Candidate.create({ ...req.body, id: uuidv4(), voteCount: 0 });
        await broadcastCandidates();
        res.status(201).json(candidate);
    } catch (error) {
        console.error('Error creating candidate:', error);
        res.status(500).json({ error: 'Failed to create candidate', message: error.message });
    }
});

app.put('/api/candidates/:id', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const candidate = await Candidate.findOne({ where: { id } });
        if (!candidate) {
            return res.status(404).json({ error: 'Candidate not found' });
        }
        await candidate.update(req.body);
        await broadcastCandidates();
        res.json(candidate);
    } catch (error) {
        console.error('Error updating candidate:', error);
        res.status(500).json({ error: 'Failed to update candidate', message: error.message });
    }
});

app.delete('/api/candidates/:id', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const candidate = await Candidate.findOne({ where: { id } });
        if (!candidate) {
            return res.status(404).json({ error: 'Candidate not found' });
        }
        await candidate.destroy();
        await broadcastCandidates();
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting candidate:', error);
        res.status(500).json({ error: 'Failed to delete candidate', message: error.message });
    }
});

// Candidate generation endpoint
app.post('/api/candidates/generate', authenticateJWT, async (req, res) => {
    try {
        const newCandidate = await generateCandidate();
        const candidate = await Candidate.create(newCandidate);
        await broadcastCandidates();
        res.status(201).json(candidate);
    } catch (error) {
        console.error('Error generating candidate:', error);
        res.status(500).json({ error: 'Failed to generate candidate', message: error.message });
    }
});

// Initialize database and start server
sequelize.sync({ force: true }).then(() => {
    app.set('trust proxy', 1); // Trust Railway's proxy
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}).catch(error => {
    console.error('Failed to sync database:', error);
});
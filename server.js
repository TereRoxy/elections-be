const express = require('express');
const { Server, WebSocket } = require('websocket');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { faker } = require('@faker-js/faker');
const { Sequelize, DataTypes } = require('sequelize');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

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

// Session store
const sessionStore = new pgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'sessions',
    schemaName: 'public',
    createTableIfMissing: true
});

// Session configuration without cookies
const sessionMiddleware = session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'your_session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: null } // No cookies will be sent to client
});

// Apply session middleware
app.use(sessionMiddleware);
// Add this before your other routes
app.options('*', cors());
app.use(cors({
    origin: true,
    credentials: false, // No cookies, so credentials are not needed
    allowedHeaders: ['Content-Type', 'X-Session-ID'], // Allow necessary headers
}));
app.use(express.json());

// Authentication Middleware
const authenticateSession = (req, res, next) => {
    const sessionId = req.get('X-Session-ID');
    if (!sessionId) {
        return res.status(401).json({ error: 'Session ID required' });
    }

    // Retrieve session from store
    sessionStore.get(sessionId, (err, session) => {
        if (err || !session || !session.user) {
            return res.status(401).json({ error: 'Invalid or expired session' });
        }
        req.session = session; // Attach session to request
        req.session.user = session.user; // Ensure user data is available
        next();
    });
};

// WebSocket connection handling with session verification
wss.on('connection', async (ws, req) => {
    const sessionId = req.headers['x-session-id'];
    if (!sessionId) {
        ws.close(1008, 'Session ID required');
        return;
    }

    sessionStore.get(sessionId, async (err, session) => {
        if (err || !session || !session.user) {
            ws.close(1008, 'Invalid or expired session');
            return;
        }

        console.log('WebSocket client connected with session:', sessionId);
        
        // Send current candidates list to newly connected client
        const candidates = await Candidate.findAll();
        ws.send(JSON.stringify({ type: 'candidates', data: candidates }));
        
        ws.on('close', () => {
            console.log('WebSocket client disconnected');
        });
    });
});

// Broadcast candidates to all connected WebSocket clients
async function broadcastCandidates() {
    const candidates = await Candidate.findAll();
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'candidates', data: candidates }));
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
        
        // Initialize session
        req.session.user = { cnp: user.cnp };
        const sessionId = req.sessionID;
        
        // Save session manually
        sessionStore.set(sessionId, req.session, (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to save session' });
            }
            res.status(201).json({ message: 'User registered successfully', sessionId });
        });
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
        
        // Initialize session
        req.session.user = { cnp: user.cnp };
        const sessionId = req.sessionID;
        
        // Save session manually
        sessionStore.set(sessionId, req.session, (err) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to save session' });
            }
            res.json({ message: 'Login successful', hasVoted: user.hasVoted, sessionId });
        });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ error: 'Failed to login', message: error.message });
    }
});

app.post('/api/logout', (req, res) => {
    const sessionId = req.get('X-Session-ID');
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID required' });
    }
    
    sessionStore.destroy(sessionId, (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to logout' });
        }
        res.json({ message: 'Logout successful' });
    });
});

app.get('/api/check-session', (req, res) => {
    const sessionId = req.get('X-Session-ID');
    if (!sessionId) {
        return res.json({ isAuthenticated: false });
    }
    
    sessionStore.get(sessionId, (err, session) => {
        if (err || !session || !session.user) {
            return res.json({ isAuthenticated: false });
        }
        User.findOne({ where: { cnp: session.user.cnp } }).then(user => {
            if (user) {
                res.json({ isAuthenticated: true, hasVoted: user.hasVoted });
            } else {
                res.json({ isAuthenticated: false });
            }
        });
    });
});

// Voting Route
app.post('/api/vote/:candidateId', authenticateSession, async (req, res) => {
    try {
        const { candidateId } = req.params;
        const user = await User.findOne({ where: { cnp: req.session.user.cnp } });
        
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
app.get('/api/candidates', authenticateSession, async (req, res) => {
    try {
        const candidates = await Candidate.findAll();
        res.json(candidates);
    } catch (error) {
        console.error('Error fetching candidates:', error);
        res.status(500).json({ error: 'Failed to fetch candidates', message: error.message });
    }
});

app.post('/api/candidates', authenticateSession, async (req, res) => {
    try {
        const candidate = await Candidate.create({ ...req.body, id: uuidv4(), voteCount: 0 });
        await broadcastCandidates();
        res.status(201).json(candidate);
    } catch (error) {
        console.error('Error creating candidate:', error);
        res.status(500).json({ error: 'Failed to create candidate', message: error.message });
    }
});

app.put('/api/candidates/:id', authenticateSession, async (req, res) => {
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

app.delete('/api/candidates/:id', authenticateSession, async (req, res) => {
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
app.post('/api/candidates/generate', authenticateSession, async (req, res) => {
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
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}).catch(error => {
    console.error('Failed to sync database:', error);
});
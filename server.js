const express = require('express');
const { Server } = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const { faker } = require('@faker-js/faker');

faker.locale = 'ro_RO'; // For Romanian names

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

// In-memory storage for candidates
let candidates = [];

app.use(cors());
app.use(express.json());

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('Client connected');
    
    // Send current candidates list to newly connected client
    ws.send(JSON.stringify({ type: 'candidates', data: candidates }));

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Broadcast candidates to all connected WebSocket clients
function broadcastCandidates() {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'candidates', data: candidates }));
        }
    });
}

// Helper function to generate a random candidate
function generateCandidate() {
    return {
        id: uuidv4(),
        name: faker.person.fullName(),
        party: faker.helpers.arrayElement(['PNL', 'AUR', 'USR', 'Independent', 'Green Party', 'PSD']),
        description: faker.lorem.sentence({ min: 10, max: 20 }),
        imageUrl: faker.helpers.arrayElement([ 'https://duckduckgo.com/i/255febbe579217e1.jpg', 'https://duckduckgo.com/i/15f51d6ee557e753.jpg', 'https://duckduckgo.com/i/05d55141240b08df.jpg', 'https://duckduckgo.com/i/830ff11fac94b260.jpg' ]),
        createdAt: new Date().toISOString(),
    };
}

// CRUD Routes
app.get('/api/candidates', (req, res) => {
    res.json(candidates);
});

app.post('/api/candidates', (req, res) => {
    const candidate = { ...req.body, id: uuidv4(), createdAt: new Date().toISOString() };
    candidates.push(candidate);
    broadcastCandidates();
    res.status(201).json(candidate);
});

app.put('/api/candidates/:id', (req, res) => {
    const { id } = req.params;
    const index = candidates.findIndex((c) => c.id === id);
    if (index === -1) {
        return res.status(404).json({ error: 'Candidate not found' });
    }
    candidates[index] = { ...candidates[index], ...req.body };
    broadcastCandidates();
    res.json(candidates[index]);
});

app.delete('/api/candidates/:id', (req, res) => {
    const { id } = req.params;
    const index = candidates.findIndex((c) => c.id === id);
    if (index === -1) {
        return res.status(404).json({ error: 'Candidate not found' });
    }
    candidates.splice(index, 1);
    broadcastCandidates();
    res.status(204).send();
});

// Candidate generation endpoint
app.post('/api/candidates/generate', (req, res) => {
    const newCandidate = generateCandidate();
    candidates.push(newCandidate);
    broadcastCandidates();
    res.status(201).json(newCandidate);
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
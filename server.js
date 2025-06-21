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

function generateCandidate() {
    try{
        const gender = faker.helpers.arrayElement(['men', 'women']); // Randomly select gender
        const imageId = faker.number.int({ min: 1, max: 99 }); // Randomly select image ID between 1 and 99

        return {
            id: uuidv4(),
            name: faker.person.fullName(),
            party: faker.helpers.arrayElement(['PNL', 'AUR', 'USR', 'Independent', 'Green Party', 'PSD']),
            description: faker.lorem.sentence({ min: 10, max: 20 }),
            imageUrl: `https://randomuser.me/api/portraits/${gender}/${imageId}.jpg`, // Generate URL dynamically
        };

    }catch (error) {
        console.error('Error generating candidate:', error);
        throw new Error('Failed to generate candidate');
    }
}

// CRUD Routes
app.get('/api/candidates', (req, res) => {
    res.json(candidates);
});

app.post('/api/candidates', (req, res) => {
    try{
        const candidate = { ...req.body, id: uuidv4()};
        candidates.push(candidate);
        broadcastCandidates();
        res.status(201).json(candidate);
    } catch (error) {
        console.error('Error creating candidate:', error);
        return res.status(500).json({ error: 'Failed to create candidate' });
    }
});

app.put('/api/candidates/:id', (req, res) => {
    try {
        const { id } = req.params;
        const index = candidates.findIndex((c) => c.id === id);
        if (index === -1) {
            return res.status(404).json({ error: 'Candidate not found' });
        }
        candidates[index] = { ...candidates[index], ...req.body };
        broadcastCandidates();
        res.json(candidates[index]);
    } catch (error) {
        console.error('Error updating candidate:', error);
        return res.status(500).json({ error: 'Failed to update candidate' });
    }
});

app.delete('/api/candidates/:id', (req, res) => {
    try {
        const { id } = req.params;
        const index = candidates.findIndex((c) => c.id === id);
        if (index === -1) {
            return res.status(404).json({ error: 'Candidate not found' });
        }
        candidates.splice(index, 1);
        broadcastCandidates();
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting candidate:', error);
        return res.status(500).json({ error: 'Failed to delete candidate' });
    }
});

// Candidate generation endpoint
app.post('/api/candidates/generate', (req, res) => {
    try {
        const newCandidate = generateCandidate();
        candidates.push(newCandidate);
        broadcastCandidates();
        res.status(201).json(newCandidate);
    } catch (error) {
        console.error('Error generating candidate:', error);
        return res.status(500).json({ error: 'Failed to generate candidate' });
    }
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
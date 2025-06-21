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
wss.on('connection', async (ws) => {
    console.log('Client connected');
    
    // Send current candidates list to newly connected client
    await ws.send(JSON.stringify({ type: 'candidates', data: candidates }));

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Broadcast candidates to all connected WebSocket clients
async function broadcastCandidates() {
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            await client.send(JSON.stringify({ type: 'candidates', data: candidates }));
        }
    }
}

async function generateCandidate() {
    try {
        const gender = await faker.helpers.arrayElement(['men', 'women']); // Randomly select gender
        const imageId = await faker.number.int({ min: 1, max: 99 }); // Randomly select image ID between 1 and 99

        return {
            id: uuidv4(),
            name: await faker.person.fullName(),
            party: await faker.helpers.arrayElement(['PNL', 'AUR', 'USR', 'Independent', 'Green Party', 'PSD']),
            description: await faker.lorem.sentence({ min: 10, max: 20 }),
            imageUrl: `https://randomuser.me/api/portraits/${gender}/${imageId}.jpg`, // Generate URL dynamically
        };
    } catch (error) {
        console.error('Error generating candidate:', error);
        throw new Error('Failed to generate candidate in generateCandidate function');
    }
}

// CRUD Routes
app.get('/api/candidates', async (req, res) => {
    res.json(candidates);
});

app.post('/api/candidates', async (req, res) => {
    try {
        const candidate = { ...req.body, id: uuidv4() };
        candidates.push(candidate);
        await broadcastCandidates();
        res.status(201).json(candidate);
    } catch (error) {
        console.error('Error creating candidate:', error);
        return res.status(500).json({ 
            error: 'Failed to create candidate', 
            message: error.message // Include the error message in the response
        });
    }
});

app.put('/api/candidates/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const index = candidates.findIndex((c) => c.id === id);
        if (index === -1) {
            return res.status(404).json({ error: 'Candidate not found' });
        }
        candidates[index] = { ...candidates[index], ...req.body };
        await broadcastCandidates();
        res.json(candidates[index]);
    } catch (error) {
        console.error('Error updating candidate:', error);
        return res.status(500).json({ 
            error: 'Failed to update candidate', 
            message: error.message // Include the error message in the response
        });
    }
});

app.delete('/api/candidates/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const index = candidates.findIndex((c) => c.id === id);
        if (index === -1) {
            return res.status(404).json({ error: 'Candidate not found' });
        }
        candidates.splice(index, 1);
        await broadcastCandidates();
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting candidate:', error);
        return res.status(500).json({ 
            error: 'Failed to delete candidate', 
            message: error.message // Include the error message in the response
        });
    }
});

// Candidate generation endpoint
app.post('/api/candidates/generate', async (req, res) => {
    try {
        const newCandidate = await generateCandidate();
        candidates.push(newCandidate);
        await broadcastCandidates();
        res.status(201).json(newCandidate);
    } catch (error) {
        console.error('Error generating candidate:', error);
        return res.status(500).json({ 
            error: 'Failed to generate candidate', 
            message: error.message // Include the error message in the response
        });
    }
});

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
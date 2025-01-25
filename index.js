const express = require('express');
const { exec } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = 53535;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

let lobbies = {};
const words = ['apple', 'banana', 'computer', 'elephant', 'giraffe', 'kangaroo', 'library', 'mountain', 'octopus', 'penguin'];
const MAX_LIVES = 3;

function getNextPlayerIndex(lobby) {
    if (!lobby.players.length) return -1;
    const currentIndex = lobby.players.findIndex(p => p.id === lobby.currentSpeller);
    return (currentIndex + 1) % lobby.players.length;
}

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        const lobby = lobbies[data.lobbyId];
        
        switch (data.type) {
            case 'join':
                lobby.players.push({ 
                    id: data.playerId, 
                    name: data.playerName,
                    lives: MAX_LIVES
                });
                broadcastLobbyUpdate(data.lobbyId);
                break;
                
            case 'start':
                startGame(data.lobbyId);
                break;
                
            case 'submit':
                checkSpelling(data.lobbyId, data.playerId, data.spelling);
                break;
        }
    });
});

function broadcastLobbyUpdate(lobbyId) {
    const lobby = lobbies[lobbyId];
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type: 'update',
                players: lobby.players,
                currentWord: lobby.currentWord,
                currentSpeller: lobby.currentSpeller
            }));
        }
    });
}

function startGame(lobbyId) {
    const lobby = lobbies[lobbyId];
    if (lobby.players.length > 0) {
        lobby.currentSpeller = lobby.players[0].id;
        nextWord(lobbyId);
    }
}

function nextWord(lobbyId) {
    const lobby = lobbies[lobbyId];
    const word = words[Math.floor(Math.random() * words.length)];
    lobby.currentWord = word;
    broadcastLobbyUpdate(lobbyId);
}

function checkSpelling(lobbyId, playerId, spelling) {
    const lobby = lobbies[lobbyId];
    const player = lobby.players.find(p => p.id === playerId);
    
    if (spelling.toLowerCase() === lobby.currentWord.toLowerCase()) {
        // Correct spelling
        const nextPlayerIndex = getNextPlayerIndex(lobby);
        lobby.currentSpeller = lobby.players[nextPlayerIndex].id;
    } else {
        // Incorrect spelling
        player.lives -= 1;
        if (player.lives <= 0) {
            // Remove player if they have no lives left
            lobby.players = lobby.players.filter(p => p.id !== playerId);
            if (lobby.players.length === 0) {
                // Game over if no players left
                delete lobbies[lobbyId];
                return;
            }
        }
        // Move to next player even if incorrect
        const nextPlayerIndex = getNextPlayerIndex(lobby);
        lobby.currentSpeller = lobby.players[nextPlayerIndex].id;
    }
    
    broadcastLobbyUpdate(lobbyId);
    setTimeout(() => nextWord(lobbyId), 2000);
}

app.get('/', (req, res) => {
    res.render('index');
});

app.post('/create-lobby', (req, res) => {
    const lobbyId = Math.random().toString(36).substring(2, 8);
    lobbies[lobbyId] = {
        players: [],
        currentWord: '',
        currentSpeller: null,
        turnOrder: 0
    };
    res.redirect(`/lobby/${lobbyId}`);
});

app.post('/join-lobby', (req, res) => {
    const lobbyId = req.body.lobbyId;
    if (!lobbies[lobbyId]) return res.status(404).send('Lobby not found');
    res.redirect(`/lobby/${lobbyId}`);
});

app.get('/lobby/:id', (req, res) => {
    const lobby = lobbies[req.params.id];
    if (!lobby) return res.status(404).send('Lobby not found');
    res.render('lobby', { 
        lobbyId: req.params.id,
        isHost: !lobby.players.length // First player is host
    });
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${port}`);
});
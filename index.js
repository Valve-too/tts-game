const express = require('express');
const { exec } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = 54657;

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

let lobbies = {};
let playerSockets = new Map(); // Map to track WebSocket connections per player
const words = ['apple', 'banana', 'computer', 'elephant', 'giraffe', 'kangaroo', 'library', 'mountain', 'octopus', 'penguin'];
const MAX_LIVES = 3;

function getNextPlayerIndex(lobby) {
    console.log('Getting next player. Current state:', {
        players: lobby.players.map(p => ({
            id: p.id,
            name: p.name
        })),
        currentSpeller: lobby.currentSpeller
    });
    
    if (!lobby.players.length) {
        console.log('No players in lobby');
        return -1;
    }
    
    const currentIndex = lobby.players.findIndex(p => p.id === lobby.currentSpeller);
    console.log('Current player index:', currentIndex, 'Current speller ID:', lobby.currentSpeller);
    
    if (currentIndex === -1) {
        console.log('Current speller not found in players list, starting from beginning');
        return 0;
    }
    
    const nextIndex = (currentIndex + 1) % lobby.players.length;
    const nextPlayer = lobby.players[nextIndex];
    console.log('Next player index:', nextIndex, 'Next player:', {
        id: nextPlayer.id,
        name: nextPlayer.name
    });
    return nextIndex;
}

wss.on('connection', (ws) => {
    console.log('\n=== New WebSocket Connection ===');
    let connectedPlayerId = null;
    
    ws.on('close', () => {
        console.log('\n=== WebSocket Disconnected ===');
        if (connectedPlayerId) {
            console.log('Player disconnected:', connectedPlayerId);
            playerSockets.delete(connectedPlayerId);
        }
    });
    
    ws.on('message', (message) => {
        console.log('\n=== Received WebSocket Message ===');
        let data;
        try {
            data = JSON.parse(message);
            console.log('Message data:', data);
        } catch (error) {
            console.log('Error parsing message:', error);
            return;
        }
        
        const lobby = lobbies[data.lobbyId];
        console.log('Processing message type:', data.type, 'for lobby:', data.lobbyId);
        
        switch (data.type) {
            case 'join':
                if (!lobby) {
                    console.log('Error: Cannot join non-existent lobby:', data.lobbyId);
                    return;
                }
                
                // Store the WebSocket connection for this player
                connectedPlayerId = data.playerId;
                playerSockets.set(data.playerId, ws);
                console.log('Player socket registered:', data.playerId);
                
                lobby.players.push({ 
                    id: data.playerId, 
                    name: data.playerName,
                    lives: MAX_LIVES
                });
                broadcastLobbyUpdate(data.lobbyId);
                break;
                
            case 'start':
                if (!lobby) {
                    console.log('Error: Cannot start non-existent lobby:', data.lobbyId);
                    return;
                }
                startGame(data.lobbyId);
                break;
                
            case 'submit':
                checkSpelling(data.lobbyId, data.playerId, data.spelling);
                break;
        }
    });
});

function cleanupLobby(lobbyId) {
    console.log('\n=== Cleaning up Lobby ===');
    console.log('Lobby ID:', lobbyId);
    
    const lobby = lobbies[lobbyId];
    if (!lobby) return;
    
    // Close all player sockets and remove them from the map
    lobby.players.forEach(player => {
        const playerSocket = playerSockets.get(player.id);
        if (playerSocket) {
            playerSocket.close();
            playerSockets.delete(player.id);
        }
    });
    
    // Delete the lobby
    delete lobbies[lobbyId];
}

function broadcastLobbyUpdate(lobbyId) {
    console.log('\n=== Broadcasting Update ===');
    console.log('Lobby ID:', lobbyId);
    
    const lobby = lobbies[lobbyId];
    if (!lobby) {
        console.log('Error: Lobby not found when broadcasting update');
        return;
    }
    
    const updateData = {
        type: 'update',
        players: lobby.players,
        currentWord: lobby.currentWord,
        currentSpeller: lobby.currentSpeller
    };
    console.log('Broadcasting data:', updateData);
    
    // Only send updates to players in this lobby
    let clientCount = 0;
    lobby.players.forEach(player => {
        const playerSocket = playerSockets.get(player.id);
        if (playerSocket && playerSocket.readyState === WebSocket.OPEN) {
            playerSocket.send(JSON.stringify(updateData));
            clientCount++;
        } else {
            console.log('Warning: No active socket for player:', player.id);
        }
    });
    console.log('Update sent to', clientCount, 'clients');
}

function startGame(lobbyId) {
    console.log('\n=== Starting Game ===');
    console.log('Lobby ID:', lobbyId);
    
    const lobby = lobbies[lobbyId];
    if (!lobby) {
        console.log('Error: Lobby not found when starting game');
        return;
    }
    
    console.log('Players in lobby:', lobby.players);
    
    if (lobby.players.length > 0) {
        lobby.currentSpeller = lobby.players[0].id;
        console.log('First speller set to:', lobby.currentSpeller);
        nextWord(lobbyId);
    } else {
        console.log('Error: Cannot start game with no players');
    }
}

function nextWord(lobbyId) {
    console.log('\n=== Getting Next Word ===');
    console.log('Lobby ID:', lobbyId);
    
    const lobby = lobbies[lobbyId];
    if (!lobby) {
        console.log('Error: Lobby not found when getting next word');
        return;
    }
    
    const word = words[Math.floor(Math.random() * words.length)];
    console.log('Selected new word:', word);
    
    lobby.currentWord = word;
    console.log('Updated lobby state:', {
        players: lobby.players,
        currentWord: lobby.currentWord,
        currentSpeller: lobby.currentSpeller
    });
    
    broadcastLobbyUpdate(lobbyId);
}

function checkSpelling(lobbyId, playerId, spelling) {
    console.log('\n=== Checking Spelling ===');
    console.log('Inputs:', { lobbyId, playerId, spelling });
    
    const lobby = lobbies[lobbyId];
    if (!lobby) {
        console.log('Error: Lobby not found');
        return;
    }

    console.log('Current lobby state:', {
        players: lobby.players.map(p => ({
            id: p.id,
            name: p.name,
            lives: p.lives
        })),
        currentWord: lobby.currentWord,
        currentSpeller: lobby.currentSpeller
    });

    const player = lobby.players.find(p => p.id === playerId);
    if (!player) {
        console.log('Error: Player', playerId, 'not found in players list:', 
            lobby.players.map(p => p.id));
        return;
    }
    
    // Only allow the current speller to submit
    if (playerId !== lobby.currentSpeller) {
        console.log('Error: Not player\'s turn. Current speller:', lobby.currentSpeller, 
            'Attempting player:', playerId);
        return;
    }

    console.log('Checking answer:', {
        given: spelling.toLowerCase(),
        expected: lobby.currentWord.toLowerCase()
    });

    if (spelling.toLowerCase() === lobby.currentWord.toLowerCase()) {
        console.log('Correct spelling!');
        const nextPlayerIndex = getNextPlayerIndex(lobby);
        
        if (nextPlayerIndex === -1 || !lobby.players[nextPlayerIndex]) {
            console.log('No valid next player, ending game');
            delete lobbies[lobbyId];
            return;
        }
        
        lobby.currentSpeller = lobby.players[nextPlayerIndex].id;
        console.log('Turn passed to player:', lobby.currentSpeller);
    } else {
        console.log('Incorrect spelling');
        player.lives -= 1;
        console.log('Player lives reduced to:', player.lives);
        
        if (player.lives <= 0) {
            console.log('Player eliminated:', playerId);
            lobby.players = lobby.players.filter(p => p.id !== playerId);
            console.log('Remaining players:', lobby.players);
            
            // Clean up the eliminated player's socket
            const playerSocket = playerSockets.get(playerId);
            if (playerSocket) {
                playerSocket.close();
                playerSockets.delete(playerId);
            }
            
            if (lobby.players.length === 0) {
                console.log('No players left, ending game');
                cleanupLobby(lobbyId);
                return;
            }
        }
        
        const nextPlayerIndex = getNextPlayerIndex(lobby);
        if (nextPlayerIndex === -1 || !lobby.players[nextPlayerIndex]) {
            console.log('No valid next player after incorrect answer, ending game');
            delete lobbies[lobbyId];
            return;
        }
        
        lobby.currentSpeller = lobby.players[nextPlayerIndex].id;
        console.log('Turn passed to player:', lobby.currentSpeller);
    }
    
    console.log('Broadcasting update after spelling check');
    broadcastLobbyUpdate(lobbyId);
    
    if (lobbies[lobbyId]) {
        console.log('Scheduling next word in 2 seconds');
        setTimeout(() => {
            console.log('Timeout triggered for next word');
            if (lobbies[lobbyId]) {
                nextWord(lobbyId);
            } else {
                console.log('Lobby no longer exists when timeout triggered');
            }
        }, 2000);
    } else {
        console.log('Lobby no longer exists, not scheduling next word');
    }
}

app.get('/', (req, res) => {
    res.render('index');
});

app.post('/create-lobby', (req, res) => {
    console.log('Creating new lobby');
    const lobbyId = Math.random().toString(36).substring(2, 8);
    const playerName = req.body.playerName || 'Player';
    
    lobbies[lobbyId] = {
        players: [],
        currentWord: '',
        currentSpeller: null
    };
    console.log('Created lobby:', lobbyId);
    res.redirect(`/lobby/${lobbyId}?playerName=${encodeURIComponent(playerName)}`);
});

app.post('/join-lobby', (req, res) => {
    const lobbyId = req.body.lobbyId;
    const playerName = req.body.playerName || 'Player';
    console.log('Attempting to join lobby:', lobbyId);
    
    if (!lobbies[lobbyId]) {
        console.log('Lobby not found:', lobbyId);
        return res.status(404).send('Lobby not found');
    }
    
    console.log('Joining lobby:', lobbyId);
    res.redirect(`/lobby/${lobbyId}?playerName=${encodeURIComponent(playerName)}`);
});

app.get('/lobby/:id', (req, res) => {
    const lobbyId = req.params.id;
    const playerName = req.query.playerName || 'Player';
    console.log('Accessing lobby:', lobbyId, 'Player:', playerName);
    
    const lobby = lobbies[lobbyId];
    if (!lobby) {
        console.log('Lobby not found:', lobbyId);
        return res.status(404).send('Lobby not found');
    }
    
    console.log('Rendering lobby. Current players:', lobby.players.length);
    res.render('lobby', { 
        lobbyId: lobbyId,
        playerName: playerName,
        isHost: !lobby.players.length // First player is host
    });
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${port}`);
});
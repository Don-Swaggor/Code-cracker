const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

// ===============================
// GAME SETTINGS
// ===============================

const TURN_TIME = 30;
const ROOM_CODE_LENGTH = 4;
const ROOM_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const MIN_GROUP_PLAYERS = 3;
const MAX_GROUP_PLAYERS = 5;

// All active rooms
const rooms = {};

// ===============================
// ROOM CODE
// ===============================
// Fixed-length code built from a fixed charset. (The previous version used
// Math.random().toString(36).substring(2, 8), which does NOT reliably
// produce 6 characters -- some random values produce far fewer, silently
// creating room codes that could never pass client-side validation.)

function generateRoomCode() {
    let code;

    do {
        code = Array.from(
            { length: ROOM_CODE_LENGTH },
            () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]
        ).join("");
    } while (rooms[code]);

    return code;
}

// ===============================
// VALIDATE NAME
// ===============================

function cleanName(name) {
    if (typeof name !== "string") {
        return "Player";
    }

    name = name.trim();

    if (!name) {
        return "Player";
    }

    return name.substring(0, 20);
}

// ===============================
// VALIDATE 4-DIGIT CODE
// ===============================

function validCode(code) {
    return typeof code === "string" && /^\d{4}$/.test(code);
}

// ===============================
// VALIDATE ROOM SIZE
// ===============================

function validMaxPlayers(mode, maxPlayers) {
    if (mode === "duo") {
        return true; // fixed at 2
    }

    const n = Number(maxPlayers);

    return (
        Number.isInteger(n) &&
        n >= MIN_GROUP_PLAYERS &&
        n <= MAX_GROUP_PLAYERS
    );
}

// ===============================
// CHECK GUESS
// ===============================

function checkGuess(guess, secret) {

    let dead = 0;
    let injured = 0;

    const secretUsed = [false, false, false, false];
    const guessUsed = [false, false, false, false];

    // DEAD: correct digit + correct position
    for (let i = 0; i < 4; i++) {
        if (guess[i] === secret[i]) {
            dead++;
            secretUsed[i] = true;
            guessUsed[i] = true;
        }
    }

    // INJURED: correct digit + wrong position
    for (let i = 0; i < 4; i++) {
        if (guessUsed[i]) continue;

        for (let j = 0; j < 4; j++) {
            if (secretUsed[j]) continue;

            if (guess[i] === secret[j]) {
                injured++;
                secretUsed[j] = true;
                guessUsed[i] = true;
                break;
            }
        }
    }

    return { dead, injured };
}

// ===============================
// ROOM HELPERS
// ===============================

function publicPlayers(room) {
    return room.order.map((id) => {
        const p = room.players[id];

        return {
            id,
            name: p.name,
            ready: p.ready,
            alive: p.alive,
            isHost: id === room.hostId
        };
    });
}

function aliveIds(room) {
    return room.order.filter((id) => room.players[id] && room.players[id].alive);
}

function nextAliveIndex(room, fromIndex) {
    const n = room.order.length;

    for (let step = 1; step <= n; step++) {
        const idx = (fromIndex + step) % n;
        const id = room.order[idx];

        if (room.players[id] && room.players[id].alive) {
            return idx;
        }
    }

    return -1;
}

function roomSummary(room) {
    return {
        mode: room.mode,
        maxPlayers: room.maxPlayers,
        hostId: room.hostId,
        players: publicPlayers(room)
    };
}

function tryAutoStart(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.started || !room.locked) return;
    if (room.order.length < 2) return;

    const allReady = room.order.every((id) => room.players[id].ready);

    if (allReady) {
        room.started = true;
        room.turnIndex = 0;

        io.to(roomCode).emit("gameStarted", {
            turn: room.order[0],
            ...roomSummary(room)
        });

        startTurn(roomCode);
    }
}

// ===============================
// CREATE GAME STATE
// ===============================

function createRoom(socket, name, mode, maxPlayers) {

    const roomCode = generateRoomCode();

    rooms[roomCode] = {
        mode,
        maxPlayers: mode === "duo" ? 2 : maxPlayers,
        players: {
            [socket.id]: {
                id: socket.id,
                name,
                code: null,
                ready: false,
                alive: true
            }
        },
        order: [socket.id],
        hostId: socket.id,
        locked: false,
        turnIndex: 0,
        started: false,
        winner: null,
        timer: null,
        turnEndsAt: null
    };

    socket.join(roomCode);
    socket.roomCode = roomCode;

    return roomCode;
}

function lockRoomForCodes(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.locked) return;

    room.locked = true;

    io.to(roomCode).emit("readyToLockCodes", roomSummary(room));
}

// ===============================
// TURN TIMER
// ===============================

function startTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.winner) return;

    clearTimeout(room.timer);

    const currentId = room.order[room.turnIndex];

    room.turnEndsAt = Date.now() + TURN_TIME * 1000;

    io.to(roomCode).emit("turnStarted", {
        turn: currentId,
        seconds: TURN_TIME,
        endsAt: room.turnEndsAt
    });

    room.timer = setTimeout(() => {
        handleTimeout(roomCode);
    }, TURN_TIME * 1000);
}

function advanceTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.winner) return;

    const nextIdx = nextAliveIndex(room, room.turnIndex);
    if (nextIdx === -1) return;

    room.turnIndex = nextIdx;
    startTurn(roomCode);
}

function handleTimeout(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.winner || !room.started) return;

    const timedOutId = room.order[room.turnIndex];

    if (room.mode === "duo") {

        const opponentId = room.order.find((id) => id !== timedOutId);

        room.winner = opponentId;
        clearTimeout(room.timer);

        io.to(roomCode).emit("gameOver", {
            winner: opponentId,
            reason: "timeout",
            timedOutPlayer: timedOutId
        });

        return;
    }

    // Group mode: a timeout just costs you the turn, not the game.
    io.to(roomCode).emit("turnSkipped", { player: timedOutId });

    advanceTurn(roomCode);
}

// ===============================
// PLAYER LEFT / DISCONNECTED
// ===============================

function handlePlayerLeft(roomCode, playerId) {
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players[playerId];
    if (!player) return;

    if (!room.started) {

        delete room.players[playerId];
        room.order = room.order.filter((id) => id !== playerId);

        if (room.order.length === 0) {
            clearTimeout(room.timer);
            delete rooms[roomCode];
            return;
        }

        if (room.hostId === playerId) {
            room.hostId = room.order[0];
        }

        if (room.locked && room.order.length < 2) {
            io.to(roomCode).emit("roomClosed", {
                message: "Not enough players left to continue."
            });
            clearTimeout(room.timer);
            delete rooms[roomCode];
            return;
        }

        io.to(roomCode).emit("playerLeft", roomSummary(room));

        tryAutoStart(roomCode);
        return;
    }

    if (room.winner) return;

    if (player.alive) {
        player.alive = false;

        io.to(roomCode).emit("playerEliminated", {
            playerId,
            name: player.name,
            reason: "left"
        });
    }

    const remaining = aliveIds(room);

    if (remaining.length <= 1) {
        clearTimeout(room.timer);
        room.winner = remaining[0] || null;

        io.to(roomCode).emit("gameOver", {
            winner: room.winner,
            reason: "opponentLeft"
        });

        return;
    }

    if (room.order[room.turnIndex] === playerId) {
        advanceTurn(roomCode);
    }
}

// ===============================
// SOCKET CONNECTION
// ===============================

io.on("connection", (socket) => {

    console.log("Connected:", socket.id);

    // ===========================
    // CREATE ROOM
    // ===========================

    socket.on("createRoom", (data) => {

        const name = cleanName(data && data.name);
        const mode = data && data.mode === "group" ? "group" : "duo";
        const maxPlayers = data && data.maxPlayers;

        if (!validMaxPlayers(mode, maxPlayers)) {
            socket.emit("errorMessage", "Choose a group size between 3 and 5.");
            return;
        }

        const roomCode = createRoom(socket, name, mode, maxPlayers);
        const room = rooms[roomCode];

        socket.emit("roomCreated", {
            roomCode,
            playerId: socket.id,
            name,
            ...roomSummary(room)
        });

        console.log(`${name} created ${mode} room ${roomCode}`);
    });

    // ===========================
    // JOIN ROOM
    // ===========================

    socket.on("joinRoom", ({ roomCode, name }) => {

        if (typeof roomCode !== "string" || typeof name !== "string") {
            socket.emit("errorMessage", "Invalid information.");
            return;
        }

        roomCode = roomCode.trim().toUpperCase();
        name = cleanName(name);

        const room = rooms[roomCode];

        if (!room) {
            socket.emit("errorMessage", "Room not found.");
            return;
        }

        if (room.locked || room.started) {
            socket.emit("errorMessage", "This game has already started.");
            return;
        }

        if (room.order.length >= room.maxPlayers) {
            socket.emit("errorMessage", "This room is already full.");
            return;
        }

        room.players[socket.id] = {
            id: socket.id,
            name,
            code: null,
            ready: false,
            alive: true
        };

        room.order.push(socket.id);

        socket.join(roomCode);
        socket.roomCode = roomCode;

        socket.emit("joinedRoom", {
            roomCode,
            playerId: socket.id,
            name,
            ...roomSummary(room)
        });

        io.to(roomCode).emit("playerJoined", roomSummary(room));

        console.log(`${name} joined room ${roomCode}`);

        if (room.order.length === room.maxPlayers) {
            lockRoomForCodes(roomCode);
        }
    });

    // ===========================
    // HOST STARTS GROUP GAME EARLY
    // ===========================

    socket.on("startGroupGame", () => {
        const room = rooms[socket.roomCode];

        if (!room || room.mode !== "group" || room.locked) return;
        if (room.hostId !== socket.id) return;

        if (room.order.length < MIN_GROUP_PLAYERS) {
            socket.emit(
                "errorMessage",
                `Need at least ${MIN_GROUP_PLAYERS} players to start.`
            );
            return;
        }

        lockRoomForCodes(socket.roomCode);
    });

    // ===========================
    // SET SECRET CODE
    // ===========================

    socket.on("setCode", (code) => {

        const roomCode = socket.roomCode;
        const room = rooms[roomCode];

        if (!room) return;

        if (room.started) {
            socket.emit("errorMessage", "The game has already started.");
            return;
        }

        if (!room.locked) {
            socket.emit("errorMessage", "Waiting for the lobby to fill up.");
            return;
        }

        if (!validCode(code)) {
            socket.emit("errorMessage", "Your code must contain exactly 4 digits.");
            return;
        }

        const player = room.players[socket.id];
        if (!player) return;

        player.code = code;
        player.ready = true;

        socket.emit("codeAccepted");

        socket.to(roomCode).emit("opponentReady", {
            playerId: socket.id,
            name: player.name
        });

        tryAutoStart(roomCode);
    });

    // ===========================
    // MAKE GUESS
    // ===========================

    socket.on("makeGuess", (data) => {

        const roomCode = socket.roomCode;
        const room = rooms[roomCode];

        if (!room) return;

        if (!room.started) {
            socket.emit("errorMessage", "The game has not started.");
            return;
        }

        if (room.winner) {
            socket.emit("errorMessage", "The game is already over.");
            return;
        }

        const currentId = room.order[room.turnIndex];

        if (currentId !== socket.id) {
            socket.emit("errorMessage", "It is not your turn.");
            return;
        }

        const guess = data && data.guess;
        let targetId = data && data.targetId;

        if (room.mode === "duo") {
            targetId = room.order.find((id) => id !== socket.id);
        }

        const target = room.players[targetId];

        if (!target || !target.alive || targetId === socket.id) {
            socket.emit("errorMessage", "Choose a valid target.");
            return;
        }

        if (!validCode(guess)) {
            socket.emit("errorMessage", "Enter exactly 4 digits.");
            return;
        }

        const result = checkGuess(guess, target.code);

        clearTimeout(room.timer);

        // Result goes ONLY to the guesser -- never reveal it to the room.
        socket.emit("guessResult", {
            guess,
            targetId,
            targetName: target.name,
            dead: result.dead,
            injured: result.injured
        });

        socket.to(roomCode).emit("opponentGuessed", {
            player: socket.id,
            playerName: room.players[socket.id].name,
            targetId,
            targetName: target.name
        });

        if (result.dead === 4) {

            target.alive = false;

            io.to(roomCode).emit("playerEliminated", {
                playerId: targetId,
                name: target.name,
                by: socket.id,
                reason: "cracked"
            });

            const remaining = aliveIds(room);

            if (remaining.length === 1) {
                room.winner = remaining[0];

                io.to(roomCode).emit("gameOver", {
                    winner: remaining[0],
                    reason: "cracked"
                });

                return;
            }
        }

        advanceTurn(roomCode);
    });

    // ===========================
    // REMATCH
    // ===========================

    socket.on("rematch", () => {

        const roomCode = socket.roomCode;
        const room = rooms[roomCode];

        if (!room || room.order.length < 2) {
            socket.emit("errorMessage", "Not enough players left for a rematch.");
            return;
        }

        clearTimeout(room.timer);

        room.order.forEach((id) => {
            const p = room.players[id];
            p.code = null;
            p.ready = false;
            p.alive = true;
        });

        room.turnIndex = 0;
        room.started = false;
        room.winner = null;
        room.turnEndsAt = null;
        room.locked = true; // straight back into the code phase, no new joiners

        io.to(roomCode).emit("rematchStarted", roomSummary(room));
    });

    // ===========================
    // LEAVE ROOM
    // ===========================

    socket.on("leaveRoom", () => {

        const roomCode = socket.roomCode;

        if (roomCode) {
            handlePlayerLeft(roomCode, socket.id);
            socket.leave(roomCode);
        }

        socket.roomCode = null;
    });

    // ===========================
    // DISCONNECT
    // ===========================

    socket.on("disconnect", () => {

        console.log("Disconnected:", socket.id);

        const roomCode = socket.roomCode;
        if (!roomCode) return;

        handlePlayerLeft(roomCode, socket.id);
    });

});

// ===============================
// START SERVER
// ===============================

server.listen(PORT, () => {
    console.log(`Code Cracker running on port ${PORT}`);
});

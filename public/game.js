const socket = io();


// =================================
// GAME VARIABLES
// =================================

let myPlayer = null;      // my own socket id
let myName = "";
let opponentName = "";
let roomCode = "";
let mode = "duo";          // "duo" | "group"
let maxPlayers = 2;
let players = [];          // [{ id, name, ready, alive, isHost }]
let currentTurn = null;
let selectedTargetId = null;
let audioCtx = null;
let myElapsedTimeMs = 0;
let myTurnStartedAt = null;
let timerInterval = null;

const STORAGE_KEY = "codeCrackerSession";

function saveSession() {
    if (!roomCode || !myPlayer) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ roomCode, sessionId: myPlayer }));
}

function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
}

function tryResumeSession() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        if (saved && saved.roomCode && saved.sessionId) {
            socket.emit("resumeGame", saved);
        }
    } catch (_) {
        clearSession();
    }
}


// =================================
// ELEMENTS
// =================================

const screens = {
    home: document.getElementById("homeScreen"),
    lobby: document.getElementById("lobbyScreen"),
    code: document.getElementById("codeScreen"),
    game: document.getElementById("gameScreen"),
    gameOver: document.getElementById("gameOverScreen")
};

const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const secretInput = document.getElementById("secretInput");
const guessInput = document.getElementById("guessInput");
const guessBtn = document.getElementById("guessBtn");
const turnBanner = document.getElementById("turnBanner");
const timer = document.getElementById("timer");
const myHistoryEl = document.getElementById("myHistory");
const opponentHistoryEl = document.getElementById("opponentHistory");
const toast = document.getElementById("toast");
const connectionBanner = document.getElementById("connectionBanner");
const connectionIcon = document.getElementById("connectionIcon");
const connectionMessage = document.getElementById("connectionMessage");
const groupSizeRow = document.getElementById("groupSizeRow");
const groupSizeInput = document.getElementById("groupSizeInput");
const startGroupBtn = document.getElementById("startGroupBtn");
const playersListEl = document.getElementById("playersList");
const playersStatusBar = document.getElementById("playersStatusBar");
const opponentLabelBox = document.getElementById("opponentLabelBox");
const targetSelect = document.getElementById("targetSelect");
const targetList = document.getElementById("targetList");


// =================================
// SCREEN CONTROL
// =================================

function showScreen(screen) {
    Object.values(screens).forEach(s => s.classList.add("hidden"));
    screens[screen].classList.remove("hidden");
}


// =================================
// TOAST MESSAGE
// =================================

function showToast(message) {
    toast.innerText = message;
    toast.classList.add("show");

    setTimeout(() => {
        toast.classList.remove("show");
    }, 2500);
}


// =================================
// CODE VALIDATION
// =================================

function isValidCode(code) {
    return /^\\d{4}$/.test(code) && new Set(code).size === 4;
}


// =================================
// SOUND
// =================================
// Reuses a single AudioContext instead of creating a new one on every
// beep -- browsers cap how many can exist at once.

function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioCtx.state === "suspended") {
        audioCtx.resume();
    }

    return audioCtx;
}

function beep(frequency = 500, duration = 100) {
    try {
        const audio = getAudioContext();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();

        oscillator.frequency.value = frequency;
        oscillator.connect(gain);
        gain.connect(audio.destination);

        oscillator.start();

        gain.gain.exponentialRampToValueAtTime(
            0.0001,
            audio.currentTime + duration / 1000
        );

        oscillator.stop(audio.currentTime + duration / 1000);

    } catch (error) {
        // Sound is optional
    }
}


// =================================
// MODE TOGGLE (HOME SCREEN)
// =================================

let selectedMode = "duo";

document.getElementById("modeDuoBtn").onclick = () => setMode("duo");
document.getElementById("modeGroupBtn").onclick = () => setMode("group");

function setMode(newMode) {
    selectedMode = newMode;

    document.getElementById("modeDuoBtn").classList.toggle("active", newMode === "duo");
    document.getElementById("modeGroupBtn").classList.toggle("active", newMode === "group");
    groupSizeRow.classList.toggle("hidden", newMode !== "group");
}


// =================================
// INPUT FILTERING
// =================================

secretInput.addEventListener("input", () => {
    secretInput.value = secretInput.value.replace(/\D/g, "").slice(0, 4);
});

guessInput.addEventListener("input", () => {
    guessInput.value = guessInput.value.replace(/\D/g, "").slice(0, 4);
});

roomInput.addEventListener("input", () => {
    roomInput.value = roomInput.value
        .replace(/[^a-zA-Z0-9]/g, "")
        .toUpperCase()
        .slice(0, 4);
});


// =================================
// CREATE GAME
// =================================

document.getElementById("createBtn").onclick = () => {

    const name = nameInput.value.trim();

    if (!name) {
        showToast("Enter your name first.");
        return;
    }

    myName = name;

    const payload = { name, mode: selectedMode };

    if (selectedMode === "group") {
        payload.maxPlayers = Number(groupSizeInput.value);
    }

    socket.emit("createRoom", payload);
};


// =================================
// ROOM CREATED / JOINED
// =================================

socket.on("roomCreated", (data) => {
    roomCode = data.roomCode;
    myPlayer = data.playerId;
    myName = data.name;
    mode = data.mode;
    maxPlayers = data.maxPlayers;
    players = data.players;

    document.getElementById("roomCodeDisplay").innerText = roomCode;
    saveSession();

    renderLobby();
    showScreen("lobby");
});

socket.on("joinedRoom", (data) => {
    roomCode = data.roomCode;
    myPlayer = data.playerId;
    myName = data.name;
    mode = data.mode;
    maxPlayers = data.maxPlayers;
    players = data.players;

    document.getElementById("roomCodeDisplay").innerText = roomCode;
    saveSession();

    renderLobby();
    showScreen("lobby");
});


// =================================
// RESUME GAME AFTER REFRESH
// =================================

function updateConnectionBanner(state, message) {
    if (!connectionBanner) return;

    connectionBanner.classList.remove("hidden", "reconnecting", "online");

    if (state === "online") {
        connectionBanner.classList.add("online");
        connectionIcon.innerText = "✓";
        connectionMessage.innerText = message || "Connection restored.";

        setTimeout(() => {
            connectionBanner.classList.add("hidden");
        }, 1800);
        return;
    }

    if (state === "offline") {
        connectionIcon.innerText = "📡";
        connectionMessage.innerText = message || "No internet connection detected. Check your network.";
        return;
    }

    connectionBanner.classList.add("reconnecting");
    connectionIcon.innerText = "⚠️";
    connectionMessage.innerText = message || "Can't reach the game server. This may be a network issue or a temporary server problem. Retrying...";
}

socket.on("connect", () => {
    updateConnectionBanner("online", "Connection restored. Checking your game...");
    tryResumeSession();
});

socket.on("disconnect", (reason) => {
    if (navigator.onLine === false) {
        updateConnectionBanner("offline", "Your internet connection appears to be offline. The game will try again when you're back online.");
    } else {
        updateConnectionBanner("reconnecting", "Connection to the game server was lost. This may be a network issue or a temporary server problem. Retrying...");
    }
});

socket.on("connect_error", () => {
    if (navigator.onLine === false) {
        updateConnectionBanner("offline", "No internet connection detected. Check your network connection.");
    } else {
        updateConnectionBanner("reconnecting", "Unable to reach the game server. Check your network connection. Retrying...");
    }
});

socket.io.on("reconnect_attempt", () => {
    updateConnectionBanner("reconnecting", "Trying to reconnect to the game server...");
});

socket.io.on("reconnect", () => {
    updateConnectionBanner("online", "Connection restored. Resuming your game...");
});

socket.io.on("reconnect_failed", () => {
    updateConnectionBanner("reconnecting", "Still unable to reach the game server. Check your network or try refreshing the page.");
});

window.addEventListener("offline", () => {
    updateConnectionBanner("offline", "Your internet connection is offline. Your game session is being kept while we wait for the connection to return.");
});

window.addEventListener("online", () => {
    updateConnectionBanner("reconnecting", "Internet connection restored. Reconnecting to the game server...");
});

socket.on("gameResumed", (data) => {
    roomCode = data.roomCode;
    myPlayer = data.playerId;
    myName = data.name;
    mode = data.mode;
    maxPlayers = data.maxPlayers;
    players = data.players || [];
    currentTurn = data.turn || null;

    document.getElementById("roomCodeDisplay").innerText = roomCode;
    saveSession();

    if (data.history) restoreHistory(data.history);

    if (data.started) {
        if (data.winner) {
            renderGameOver({ winner: data.winner, reason: "restored", history: data.history || [] });
            return;
        }
        showScreen("game");
        renderGame();
        startTimerForTurn({
            playerTimeMs: Number(data.playerTimeMs?.[myPlayer] || 0),
            turnStartedAt: data.turnStartedAt
        });
    } else if (data.locked) {
        showScreen("code");
        document.getElementById("codeStatus").innerText =
            players.find(p => p.id === myPlayer)?.ready ? "Your code is locked. Waiting for the other player(s)..." : "Choose your secret code.";
    } else {
        renderLobby();
        showScreen("lobby");
    }

    showToast("Game restored. You can continue playing.");
});

socket.on("resumeFailed", () => {
    clearSession();
    showToast("Your previous game could not be found on the server. It may have ended or the server was restarted.");
});

if (socket.connected) {
    tryResumeSession();
}

function restoreHistory(history) {
    myHistoryEl.innerHTML = "";
    opponentHistoryEl.innerHTML = "";

    const mine = history.filter(h => h.player === myPlayer);
    const opponents = history.filter(h => h.player !== myPlayer);

    if (!mine.length) myHistoryEl.innerHTML = `<p class="empty">No guesses yet.</p>`;
    if (!opponents.length) opponentHistoryEl.innerHTML = `<p class="empty">No guesses yet.</p>`;

    // History entries are rendered oldest -> newest because addHistoryEntry prepends.
    mine.forEach(h => addHistoryEntry({
        opponent: false,
        targetName: mode === "group" ? h.targetName : null,
        guess: h.guess, dead: h.dead, injured: h.injured
    }));
    opponents.forEach(h => addHistoryEntry({
        opponent: true,
        playerName: h.playerName,
        targetName: mode === "group" ? h.targetName : null,
        guess: h.guess, dead: h.dead, injured: h.injured
    }));
}

// =================================
// JOIN GAME
// =================================

document.getElementById("joinBtn").onclick = () => {

    const name = nameInput.value.trim();
    const code = roomInput.value.trim().toUpperCase();

    if (!name) {
        showToast("Enter your name first.");
        return;
    }

    if (!/^[A-Z0-9]{4}$/.test(code)) {
        showToast("Enter a valid 4-character room code.");
        return;
    }

    myName = name;

    socket.emit("joinRoom", { roomCode: code, name });
};


// =================================
// LOBBY UPDATES
// =================================

socket.on("playerJoined", (data) => {
    players = data.players;
    mode = data.mode;
    maxPlayers = data.maxPlayers;
    renderLobby();
});

socket.on("playerLeft", (data) => {
    players = data.players;
    mode = data.mode;
    maxPlayers = data.maxPlayers;
    renderLobby();
    showToast("A player left the lobby.");
});

socket.on("readyToLockCodes", (data) => {
    players = data.players;
    mode = data.mode;
    maxPlayers = data.maxPlayers;
    showScreen("code");
});

function renderLobby() {

    playersListEl.innerHTML = "";

    players.forEach((p) => {
        const row = document.createElement("div");
        row.className = "playerRow";

        const icon = document.createElement("span");
        icon.className = "playerIcon";
        icon.innerText = "👤";

        const name = document.createElement("strong");
        name.innerText =
            p.name +
            (p.id === myPlayer ? " (You)" : "") +
            (p.isHost ? " 👑" : "");

        const status = document.createElement("span");
        status.className = "ready";
        status.innerText = "Connected";

        row.append(icon, name, status);
        playersListEl.appendChild(row);
    });

    for (let i = players.length; i < maxPlayers; i++) {
        const row = document.createElement("div");
        row.className = "playerRow waitingRow";

        const icon = document.createElement("span");
        icon.className = "playerIcon";
        icon.innerText = "👤";

        const name = document.createElement("strong");
        name.innerText = "Waiting...";

        const status = document.createElement("span");
        status.className = "waiting";
        status.innerText = "Empty";

        row.append(icon, name, status);
        playersListEl.appendChild(row);
    }

    document.getElementById("lobbyStatus").innerText =
        players.length < maxPlayers
            ? `Waiting for players (${players.length}/${maxPlayers})...`
            : "Everyone is here. Choose your codes.";

    const iAmHost = players.some(p => p.id === myPlayer && p.isHost);

    const canStartEarly =
        mode === "group" &&
        iAmHost &&
        players.length >= 3 &&
        players.length < maxPlayers;

    startGroupBtn.classList.toggle("hidden", !canStartEarly);
}

startGroupBtn.onclick = () => {
    socket.emit("startGroupGame");
};


// =================================
// COPY ROOM CODE
// =================================

document.getElementById("copyBtn").onclick = async () => {
    try {
        await navigator.clipboard.writeText(roomCode);
        showToast("Room code copied!");
    } catch {
        showToast(`Room code: ${roomCode}`);
    }
};


// =================================
// LOBBY LEAVE
// =================================

document.getElementById("lobbyBackBtn").onclick = () => {
    socket.emit("leaveRoom");
    clearSession();
    location.reload();
};


// =================================
// LOCK CODE
// =================================

document.getElementById("lockCodeBtn").onclick = () => {

    const code = secretInput.value;

    if (!isValidCode(code)) {
        showToast("Use 4 different digits (no repeats).");
        return;
    }

    socket.emit("setCode", code);
};

socket.on("codeAccepted", () => {
    secretInput.disabled = true;
    document.getElementById("lockCodeBtn").disabled = true;

    document.getElementById("codeStatus").innerText = "🔒 Your code is locked.";

    showToast("Your secret code is locked.");
});

socket.on("opponentReady", (data) => {
    showToast(`${data.name} locked their code.`);
});


// =================================
// GAME STARTED
// =================================

socket.on("gameStarted", (data) => {

    players = data.players;
    mode = data.mode;
    currentTurn = data.turn;
    myElapsedTimeMs = 0;
    myTurnStartedAt = null;

    document.getElementById("myName").innerText = myName;

    if (mode === "duo") {
        const opponent = players.find(p => p.id !== myPlayer);
        opponentName = opponent ? opponent.name : "Opponent";
        document.getElementById("opponentName").innerText = opponentName;
        opponentLabelBox.classList.remove("hidden");
    } else {
        opponentLabelBox.classList.add("hidden");
    }

    showScreen("game");

    updateTurn(currentTurn);

    beep(700, 150);
});


// =================================
// TURN STARTED / SKIPPED
// =================================

socket.on("turnStarted", (data) => {
    // If our turn just ended, freeze our accumulated time before switching.
    if (currentTurn === myPlayer && data.turn !== myPlayer) {
        stopMyTimer();
    }

    currentTurn = data.turn;
    startTimerForTurn(data);
    updateTurn(data.turn);
});


// =================================
// UPDATE TURN UI
// =================================

function updateTurn(turn) {

    const isMyTurn = turn === myPlayer;

    if (isMyTurn) {
        turnBanner.innerText = "🔥 YOUR TURN";
        turnBanner.classList.remove("waiting");

        document.getElementById("gameStatus").innerText =
            mode === "group"
                ? "Choose a target and crack their code!"
                : "Crack their code!";

    } else {
        const turnPlayer = players.find(p => p.id === turn);
        const turnName = turnPlayer ? turnPlayer.name : "Opponent";

        turnBanner.innerText = `⏳ ${turnName.toUpperCase()}'S TURN`;
        turnBanner.classList.add("waiting");

        document.getElementById("gameStatus").innerText =
            `Waiting for ${turnName}...`;
    }

    if (mode === "group") {
        renderTargetSelector(isMyTurn);
    } else {
        guessInput.disabled = !isMyTurn;
        guessBtn.disabled = !isMyTurn;
    }

    renderPlayersStatusBar();
}


// =================================
// TARGET SELECTOR (GROUP MODE)
// =================================

function renderTargetSelector(isMyTurn) {

    if (!isMyTurn) {
        targetSelect.classList.add("hidden");
        selectedTargetId = null;
        return;
    }

    targetSelect.classList.remove("hidden");
    targetList.innerHTML = "";
    selectedTargetId = null;

    guessInput.disabled = true;
    guessBtn.disabled = true;

    const opponents = players.filter(p => p.id !== myPlayer && p.alive);

    opponents.forEach((p) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "targetChip";
        chip.innerText = p.name;

        chip.onclick = () => {
            selectedTargetId = p.id;

            targetList.querySelectorAll(".targetChip").forEach(c => c.classList.remove("selected"));
            chip.classList.add("selected");

            guessInput.disabled = false;
            guessBtn.disabled = false;
        };

        targetList.appendChild(chip);
    });
}


// =================================
// PLAYERS STATUS BAR (IN-GAME)
// =================================

function renderPlayersStatusBar() {

    playersStatusBar.innerHTML = "";

    players.forEach((p) => {
        const chip = document.createElement("span");
        chip.className = "statusChip";

        if (!p.alive) chip.classList.add("eliminated");
        if (p.id === currentTurn) chip.classList.add("turn");
        if (p.id === myPlayer) chip.classList.add("me");

        chip.innerText =
            p.name +
            (p.id === myPlayer ? " (You)" : "") +
            (!p.alive ? " 💀" : "");

        playersStatusBar.appendChild(chip);
    });
}


function renderGame() {
    const me = players.find(p => p.id === myPlayer);
    const opponent = players.find(p => p.id !== myPlayer && p.alive) || players.find(p => p.id !== myPlayer);

    document.getElementById("myName").innerText = me ? me.name : myName;
    document.getElementById("opponentName").innerText = opponent ? opponent.name : "Opponent";
    updateTurn(currentTurn);
}

// =================================
// PLAYER TURN TIMER
// =================================

function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return hours > 0
        ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
        : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateTurnTimer() {
    const activeMs = currentTurn === myPlayer && myTurnStartedAt
        ? Math.max(0, Date.now() - myTurnStartedAt)
        : 0;

    timer.innerText = formatElapsed(myElapsedTimeMs + activeMs);
}

function startTimerForTurn(data) {
    myElapsedTimeMs = Number.isFinite(Number(data.playerTimeMs))
        ? Number(data.playerTimeMs)
        : 0;

    myTurnStartedAt = currentTurn === myPlayer
        ? Number(data.turnStartedAt) || Date.now()
        : null;

    updateTurnTimer();
}

function stopMyTimer() {
    if (myTurnStartedAt) {
        myElapsedTimeMs += Math.max(0, Date.now() - myTurnStartedAt);
    }
    myTurnStartedAt = null;
    updateTurnTimer();
}

if (timerInterval) clearInterval(timerInterval);
timerInterval = setInterval(updateTurnTimer, 250);
updateTurnTimer();

// =================================
// MAKE GUESS
// =================================

guessBtn.onclick = makeGuess;

guessInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        makeGuess();
    }
});

function makeGuess() {

    if (currentTurn !== myPlayer) {
        showToast("Wait for your turn.");
        return;
    }

    if (mode === "group" && !selectedTargetId) {
        showToast("Choose a target first.");
        return;
    }

    const guess = guessInput.value;

    if (!isValidCode(guess)) {
        showToast("Enter 4 different digits (no repeats).");
        return;
    }

    socket.emit("makeGuess", {
        guess,
        targetId: mode === "group" ? selectedTargetId : null
    });

    guessBtn.disabled = true;
}


// =================================
// GUESS RESULT
// =================================

socket.on("guessResult", (data) => {
    guessBtn.disabled = false;
    guessInput.value = "";
    selectedTargetId = null;

    addHistoryEntry({
        opponent: false,
        targetName: mode === "group" ? data.targetName : null,
        guess: data.guess,
        dead: data.dead,
        injured: data.injured
    });

    if (data.dead === 4) {
        beep(1000, 300);
    } else {
        beep(400, 100);
    }
});


// =================================
// OPPONENT GUESSED
// =================================

socket.on("opponentGuessed", (data) => {

    // Opponent moves are fully visible: guess + DEAD + INJURED.
    addHistoryEntry({
        opponent: true,
        playerName: data.playerName,
        targetName: mode === "group" ? data.targetName : null,
        guess: data.guess,
        dead: data.dead,
        injured: data.injured
    });

    beep(300, 100);
});


// =================================
// ADD HISTORY (built with DOM nodes, not innerHTML, so player
// names can never be interpreted as markup)
// =================================

function addHistoryEntry(data) {

    const historyEl = data.opponent ? opponentHistoryEl : myHistoryEl;
    if (!historyEl) return;

    const empty = historyEl.querySelector(".empty");
    if (empty) empty.remove();

    const item = document.createElement("div");
    item.className = "historyItem";

    const label = document.createElement("div");
    label.className = "opponentMove";
    if (data.opponent) {
        label.innerText = mode === "group"
            ? `👤 ${data.playerName} guessed ${data.targetName}'s code`
            : `👤 Your opponent guessed`;
    } else if (data.targetName) {
        label.innerText = `🎯 You guessed ${data.targetName}'s code`;
    } else {
        label.innerText = "🎯 You guessed";
    }
    item.appendChild(label);

    const guessRow = document.createElement("div");
    guessRow.className = "historyGuess";
    guessRow.innerText = data.guess;
    item.appendChild(guessRow);

    const resultRow = document.createElement("div");
    resultRow.className = "historyResult";

    const deadSpan = document.createElement("span");
    deadSpan.className = "dead";
    deadSpan.innerText = `💀 Dead: ${data.dead}`;
    resultRow.appendChild(deadSpan);

    const injuredSpan = document.createElement("span");
    injuredSpan.className = "injured";
    injuredSpan.innerText = `🩹 Injured: ${data.injured}`;
    resultRow.appendChild(injuredSpan);

    item.appendChild(resultRow);
    historyEl.prepend(item);
}


// =================================
// PLAYER ELIMINATED
// =================================

socket.on("playerEliminated", (data) => {

    const p = players.find(pl => pl.id === data.playerId);
    if (p) p.alive = false;

    const name = data.name || (p ? p.name : "A player");

    if (data.reason === "left") {
        showToast(`${name} left the game.`);
    } else {
        showToast(`💀 ${name}'s code was cracked!`);
    }

    renderPlayersStatusBar();
});


// =================================
// GAME OVER
// =================================

function renderGameOver(data) {
    if (data.history) restoreHistory(data.history);
    showScreen("gameOver");

    const won = data.winner === myPlayer;
    const winnerPlayer = players.find(p => p.id === data.winner);
    const winnerName = winnerPlayer ? winnerPlayer.name : "Someone";

    const title = document.getElementById("gameOverTitle");
    const message = document.getElementById("gameOverMessage");
    const icon = document.getElementById("gameOverIcon");

    if (!data.winner) {
        title.innerText = "GAME OVER";
        icon.innerText = "🏳️";
        message.innerText = "The game ended with no winner.";
    } else if (won) {
        title.innerText = "🎉 YOU WON!";
        icon.innerText = "🏆";
        if (data.reason === "opponentLeft") {
            message.innerText = "You won because the other player(s) left.";
        } else {
            message.innerText = "You cracked the code!";
        }
        beep(1000, 400);
    } else {
        title.innerText = "💀 YOU LOST";
        icon.innerText = "💀";
        if (data.reason === "opponentLeft") {
            message.innerText = "The other player left or was disconnected.";
        } else {
            message.innerText = `${winnerName} cracked your code.`;
        }
        beep(200, 400);
    }
}

socket.on("gameOver", renderGameOver);


// =================================
// REMATCH
// =================================

document.getElementById("rematchBtn").onclick = () => {
    socket.emit("rematch");
};

socket.on("rematchStarted", (data) => {

    players = data.players;
    mode = data.mode;
    selectedTargetId = null;

    secretInput.value = "";
    secretInput.disabled = false;
    document.getElementById("lockCodeBtn").disabled = false;
    document.getElementById("codeStatus").innerText = "";

    myHistoryEl.innerHTML = `<p class="empty">No guesses yet.</p>`;
    opponentHistoryEl.innerHTML = `<p class="empty">No guesses yet.</p>`;

    showScreen("code");
});


// =================================
// MAIN MENU / LEAVE
// =================================

document.getElementById("homeBtn").onclick = () => {
    clearSession();
    location.reload();
};

document.getElementById("leaveGameBtn").onclick = () => {
    if (confirm("Are you sure you want to leave?")) {
        socket.emit("leaveRoom");
        clearSession();
        location.reload();
    }
};


// =================================
// ROOM CLOSED (e.g. too few players remain in lobby/code phase)
// =================================

socket.on("roomClosed", (data) => {
    showToast(data.message);
    setTimeout(() => location.reload(), 2000);
});


// =================================
// ERROR
// =================================

socket.on("errorMessage", (message) => {
    showToast(message);
});

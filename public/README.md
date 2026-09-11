# 🔐 Code Cracker

A real-time, multiplayer code-breaking game built with **Node.js**, **Express**, and **Socket.io**.

- **1v1 Duel** — crack your opponent's secret 4-digit code before they crack yours.
- **Group mode (3–5 players)** — everyone sets a code, everyone takes turns guessing everyone else's, last player standing wins.

Guess feedback works like Mastermind/Bulls-and-Cows: **DEAD** = right digit, right position. **INJURED** = right digit, wrong position.

---

## Project structure

```
code-cracker/
├── server.js          # Express + Socket.io game server (all game logic/state)
├── package.json
├── public/             # served as static files by Express
│   ├── index.html
│   ├── style.css
│   └── game.js         # client-side Socket.io logic
├── render.yaml          # one-click config for Render
├── .gitignore
├── LICENSE
└── README.md
```

> Your original files (`index.html`, `style.css`, `game.js`) were moved into a `public/` folder — `server.js` already expects `express.static(path.join(__dirname, "public"))`, so this is required for the server to actually find and serve them.

---

## Run it locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` in two browser tabs (or two devices on the same network, using your machine's local IP) to test a match.

---

## ⚠️ A note on where this can actually be hosted

This game keeps all room/player state **in memory** on the server (a plain JS object), and relies on **persistent WebSocket connections** via Socket.io. That combination does **not** work on:

- **Vercel** — its functions are stateless and short-lived (serverless). Your in-memory `rooms` object would get wiped constantly, and long-lived WebSocket connections aren't supported the way this app needs.
- **Firebase Cloud Functions** — same fundamental issue (stateless, ephemeral).

So even though you can absolutely push this repo to GitHub and connect it to Vercel, **the multiplayer game itself won't function correctly there.**

### What will work

Any host that runs your Node process continuously, exactly like running `node server.js` on your own machine:

| Host | Free tier | Notes |
|---|---|---|
| **[Render](https://render.com)** | Yes | Easiest — connect your GitHub repo, it reads `render.yaml` automatically. Recommended. |
| **[Railway](https://railway.app)** | Trial credit | Also connects directly to GitHub, auto-detects Node. |
| **[Fly.io](https://fly.io)** | Yes (limited) | More setup (needs a Dockerfile/`fly.toml`), but full control. |

### Deploying on Render (recommended, closest to your Vercel workflow)
1. Push this repo to GitHub (steps below).
2. Go to [render.com](https://render.com) → **New → Web Service** → connect your GitHub repo.
3. Render will detect `render.yaml` and pre-fill the settings (build: `npm install`, start: `node server.js`). Click **Create Web Service**.
4. You'll get a live URL like `https://code-cracker.onrender.com` — that's playable multiplayer, immediately.

### If you specifically want Firebase involved
Firebase Hosting/Functions alone can't run this server. Two real options if Firebase matters to you:
1. **Firebase Realtime Database for state, Render/Railway for the socket server** — swap the in-memory `rooms` object for Firebase Realtime Database calls, and still deploy the Node server itself on Render/Railway. Firebase becomes your shared state store, not your host.
2. **Google Cloud Run** (Firebase's sibling product, same GCP account) — unlike Cloud Functions, Cloud Run runs a real persistent container and *does* support WebSockets if you set `min instances: 1`. You'd containerize this app with a `Dockerfile` and deploy that way.

Happy to build out either of these if you want to go that route — just say the word.

---

## Push this to GitHub

```bash
git init
git add .
git commit -m "Initial commit: Code Cracker game"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

(Create the empty repo on GitHub first at github.com/new, without a README/gitignore/license so it doesn't conflict with the ones already in this folder.)

---

## Tech stack

- [Express 5](https://expressjs.com/) — static file serving
- [Socket.io 4](https://socket.io/) — real-time bidirectional communication
- Vanilla JS / HTML / CSS on the client — no build step required

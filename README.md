# 🎴 UNO Party

Real-time multiplayer UNO for up to 16 players. React + TypeScript + Tailwind on the
front, Node.js + Express + Socket.IO on the back. The server is authoritative —
clients only render state and send intended moves; every move is validated server-side.

## Features

- **Lobby system** — create a room, get a 6-character code, friends join with a name
  and get a fun auto-generated emoji avatar. Host starts when 2+ players are in.
- **House rules** — host-configurable toggles in the lobby: +2/+4 stacking (default on),
  7-0 rule (play a 7 to swap hands with anyone, a 0 to rotate all hands), and jump-in
  (play out of turn with an exact match). Enforced server-side, shown as badges in-game.
- **Sound effects** — synthesized Web Audio sounds (laugh on +2/+4, drumroll on UNO,
  card whoosh/click, victory fanfare) with a mute toggle. No audio files, no libraries.
- **Installable PWA** — add to home screen on mobile/desktop, offline app shell,
  custom icons.
- **Dynamic deck scaling** — 108-card standard decks scale with headcount:
  2–4 players → 1 deck, 5–8 → 2 decks, 9–12 → 3, up to 16 players (4 decks).
- **Standard UNO rules** — match color or value, Skip, Reverse, +2, Wild, Wild +4
  with a color picker. Reverse flips turn direction (acts as Skip with 2 players).
- **Free draw** — draw at any time on your turn, even with a playable card. After
  drawing you may play the drawn card if it's valid, or pass.
- **UNO pressure** — down to 1 card? A pulsing UNO! button appears and the screen
  shakes. Call it within 3 seconds or anyone can hit "Caught!" and you draw 2.
- **Emoji reactions** — 😂 flies over your avatar when you eat a +2/+4, 😜 when you're
  skipped, 🔄 on reverse, plus a quick-reaction bar (😂 😮 😭 🔥 👏) anyone can fire.
- **Reconnects** — drop your connection, come back with the room code, pick up your hand.
- **Security** — server-side validation of turn order, card ownership, and legality;
  you only ever receive your own hand; per-socket rate limiting; WSS in production.

## Repo layout

```
uno/
├── shared/            # protocol.md — the client↔server socket contract
├── server/            # Node.js + Express + Socket.IO game server (authoritative)
│   └── src/game/      # engine logic, separated from socket handlers
└── client/            # React + TS + Tailwind (Vite)
```

## Local development

Prereqs: Node.js 20+.

```bash
# Terminal 1 — server
cd server
npm install
npm run dev          # http://localhost:3001

# Terminal 2 — client
cd client
npm install
npm run dev          # http://localhost:5173
```

Open http://localhost:5173 in two browser tabs (or devices on your network), create a
room in one, join with the code from the other, and start the game.

The client connects to `http://localhost:3001` by default in dev. Override with
`VITE_SERVER_URL` in `client/.env` if your server runs elsewhere (e.g. your LAN IP for
phone testing: `VITE_SERVER_URL=http://192.168.x.x:3001`).

## Production deployment (HTTPS / WSS)

All traffic should be encrypted in production so Socket.IO upgrades to **WSS**.

### Option A — Docker / Render (recommended)

The repo ships an all-in-one `Dockerfile` (builds the client, serves it from the
Express server, single port) and a `render.yaml` blueprint.

**Render deploy:**

1. Push this repo to GitHub/GitLab.
2. In Render: **New → Web Service → connect the repo**. Render auto-detects
   `render.yaml` (or pick "Docker" as the runtime manually).
3. Deploy. Render assigns a `https://<name>.onrender.com` URL with TLS and proxies
   WebSocket upgrades automatically — the client builds with a same-origin socket
   URL, so **HTTPS + WSS work with zero extra config**.
4. (Optional) Add a custom domain in Render's settings; TLS certs are automatic.

Local Docker check:

```bash
docker build -t uno-party .
docker run -p 3001:3001 uno-party
# open http://localhost:3001
```

The same image works on Railway (`railway up`) and Fly.io (`fly deploy`); both
terminate TLS and proxy WebSockets in front of the container.

### Option B — reverse proxy (Node + nginx/Caddy)

Build the client and serve it statically, terminate TLS at Caddy or nginx, and proxy
Socket.IO to the Node server:

```bash
cd client && npm run build        # outputs client/dist
cd ../server && npm run build && npm start
```

The Express server also serves `../client/dist` directly when it exists (override
with `CLIENT_DIST`), so a single `npm start` can serve the whole app behind the
proxy without nginx static rules.

Example nginx block:

```nginx
server {
  listen 443 ssl;
  server_name uno.example.com;

  ssl_certificate     /etc/letsencrypt/live/uno.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/uno.example.com/privkey.pem;

  root /var/www/uno/client/dist;

  location /socket.io/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location / { try_files $uri /index.html; }
}
```

Set `CLIENT_ORIGIN=https://uno.example.com` on the server. The client defaults to
same-origin in production builds, so no `VITE_SERVER_URL` is needed when served
from the same domain.

### Option C — TLS directly in Node

Point the server at your certs and it serves HTTPS + WSS itself:

```bash
TLS_KEY_PATH=/path/to/privkey.pem \
TLS_CERT_PATH=/path/to/fullchain.pem \
CLIENT_ORIGIN=https://uno.example.com \
npm start
```

### Server environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Listen port |
| `CLIENT_ORIGIN` | `*` | CORS origin for Socket.IO (set to your domain in prod) |
| `CLIENT_DIST` | `../client/dist` | Client build to serve statically, when it exists |
| `TLS_KEY_PATH` | — | Path to TLS private key (enables HTTPS/WSS when both set) |
| `TLS_CERT_PATH` | — | Path to TLS certificate |

Client build-time variable: `VITE_SERVER_URL` overrides the Socket.IO server URL;
the default is `window.location.origin` in production builds and
`http://localhost:3001` in dev.

See `server/.env.example`.

## Tweaking the rules

Game logic lives in `server/src/game/` (`cards.ts`, `engine.ts`) with no socket
imports — change stacking, penalties, deck composition, or draw rules there without
touching the transport layer. The event contract both sides speak is documented in
`shared/protocol.md`.

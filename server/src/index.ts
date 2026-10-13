/**
 * Entry point: Express health endpoint + Socket.IO server, plus static
 * serving of the client build in production (CLIENT_DIST).
 *
 * Transport: HTTPS/WSS when TLS_KEY_PATH + TLS_CERT_PATH are set,
 * otherwise plain HTTP/WS for local dev.
 */
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { registerHandlers } from './sockets/handlers.js';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? '*';
const TLS_KEY_PATH = process.env.TLS_KEY_PATH;
const TLS_CERT_PATH = process.env.TLS_CERT_PATH;
// Client build to serve statically (production all-in-one deploy).
const CLIENT_DIST = process.env.CLIENT_DIST ?? path.resolve(process.cwd(), '../client/dist');

const app = express();
app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Single-port production mode: serve the built client, SPA fallback for
// anything that isn't the API or the socket endpoint.
if (existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!health|socket\.io).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
  console.log(`Serving client build from ${CLIENT_DIST}`);
}

const useTls = Boolean(TLS_KEY_PATH && TLS_CERT_PATH);
const server = useTls
  ? createHttpsServer(
      { key: readFileSync(TLS_KEY_PATH!), cert: readFileSync(TLS_CERT_PATH!) },
      app,
    )
  : createHttpServer(app);

const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN },
});

registerHandlers(io);

server.listen(PORT, () => {
  const scheme = useTls ? 'https' : 'http';
  console.log(`UNO Party server listening on ${scheme}://0.0.0.0:${PORT} (cors: ${CLIENT_ORIGIN})`);
});

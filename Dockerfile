# UNO Party — all-in-one image: client build + game server on a single port.

# ---- Stage 1: build the client ----
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Stage 2: build the server ----
FROM node:22-alpine AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---- Stage 3: runtime ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=server-build /app/server/package.json /app/server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY --from=server-build /app/server/dist ./server/dist
COPY --from=client-build /app/client/dist ./client/dist

# The server serves the client build and Socket.IO from the same port,
# so WSS works wherever the container gets TLS (Render/Railway/Fly all
# terminate TLS in front and proxy websockets automatically).
ENV PORT=3001 \
    CLIENT_DIST=/app/client/dist
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "server/dist/index.js"]

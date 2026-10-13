/**
 * Socket.IO wiring: validates intents against rooms + engine, translates
 * engine effects into protocol events, and broadcasts a personalized
 * `gameState` to every connected player (each sees only their own hand).
 */
import type { Server, Socket } from 'socket.io';
import type {
  Card,
  Color,
  GameStateForClient,
  PlayerPublic,
} from '../shared/protocol.js';
import { ALLOWED_REACTIONS } from '../shared/protocol.js';
import * as engine from '../game/engine.js';
import type { Effect } from '../game/engine.js';
import * as rooms from '../game/rooms.js';
import type { Room, RoomPlayer } from '../game/rooms.js';
import { SocketRateLimits } from './rateLimit.js';

type AckCallback = (res: object) => void;

const COLORS: readonly Color[] = ['red', 'yellow', 'green', 'blue'];

function isColor(v: unknown): v is Color {
  return typeof v === 'string' && (COLORS as readonly string[]).includes(v);
}

function ackErr(cb: AckCallback | undefined, error: string): void {
  cb?.({ ok: false, error });
}

function ackOk(cb: AckCallback | undefined, data?: object): void {
  cb?.(data ? { ok: true, ...data } : { ok: true });
}

// Timers that refresh `canCatch` exactly when an UNO deadline expires.
const unoTimers = new Map<string, NodeJS.Timeout>();

function scheduleUnoRefresh(io: Server, room: Room): void {
  const existing = unoTimers.get(room.code);
  if (existing) clearTimeout(existing);
  unoTimers.delete(room.code);
  const pending = room.game?.unoPending;
  if (!pending || room.phase !== 'playing') return;
  const delay = Math.max(0, pending.deadline - Date.now()) + 50;
  unoTimers.set(
    room.code,
    setTimeout(() => {
      unoTimers.delete(room.code);
      // Only refresh if the same window is still open.
      if (room.game?.unoPending && room.game.unoPending.deadline === pending.deadline) {
        broadcastState(io, room);
      }
    }, delay),
  );
}

function playerName(room: Room, id: string): string {
  return room.players.find((p) => p.id === id)?.name ?? 'Unknown';
}

/** Build the personalized state one player is allowed to see. */
function stateFor(room: Room, player: RoomPlayer): GameStateForClient {
  const game = room.game;
  const publicPlayers: PlayerPublic[] = room.players.map((p) => {
    const enginePlayer = game?.players.find((ep) => ep.id === p.id);
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      connected: p.connected,
      isHost: p.id === room.hostId,
      cardCount: enginePlayer?.hand.length ?? 0,
      hasCalledUno: game?.unoCalled.has(p.id) ?? false,
      place: enginePlayer?.place ?? null,
    };
  });
  const me = game?.players.find((ep) => ep.id === player.id);
  const isPlaying = room.phase === 'playing' && !!game;
  const isCurrent = !!game && engine.currentPlayer(game).id === player.id;
  // Spectator reveal: finished players (and only them) see everyone's hand.
  const spectator = isPlaying && me !== undefined && me.place !== null;
  const visibleHands: Record<string, Card[]> | null = spectator
    ? Object.fromEntries(game!.players.map((ep) => [ep.id, ep.hand]))
    : null;
  return {
    roomCode: room.code,
    phase: room.phase,
    hostId: room.hostId,
    players: publicPlayers,
    myPlayerId: player.id,
    myHand: isPlaying ? [...(me?.hand ?? [])] : [],
    topCard: game ? engine.topCard(game) : null,
    activeColor: game ? game.activeColor : null,
    currentPlayerId: isPlaying && game ? engine.currentPlayer(game).id : null,
    direction: game?.direction ?? 1,
    deckCount: room.deckCount,
    drawPileCount: game?.drawPile.length ?? 0,
    drawStack: game?.drawStack ?? null,
    unoPending: game?.unoPending ?? null,
    winnerId: game?.winnerId ?? null,
    // drawableCardId is only meaningful for the current player's own view.
    drawableCardId: isCurrent && game ? game.drawableCardId : null,
    canCatch: isPlaying && game ? engine.canCatch(game, player.id) : false,
    rules: { ...room.rules },
    visibleHands,
  };
}

/** Send each connected player their own personalized gameState. */
function broadcastState(io: Server, room: Room): void {
  for (const p of room.players) {
    if (!p.connected || !p.socketId) continue;
    io.to(p.socketId).emit('gameState', stateFor(room, p));
  }
  scheduleUnoRefresh(io, room);
}

/** Translate engine effects into room-wide protocol events. */
function emitEffects(io: Server, room: Room, effects: Effect[]): void {
  for (const e of effects) {
    switch (e.type) {
      case 'cardPlayed':
        io.to(room.code).emit('cardPlayed', {
          playerId: e.playerId,
          card: e.card,
          ...(e.chosenColor ? { chosenColor: e.chosenColor } : {}),
        });
        break;
      case 'cardDrawn':
        io.to(room.code).emit('cardDrawn', { playerId: e.playerId, count: e.count });
        break;
      case 'emoji':
        io.to(room.code).emit('emojiEffect', {
          playerId: e.playerId,
          emoji: e.emoji,
          kind: e.kind,
        });
        break;
      case 'unoCaught':
        io.to(room.code).emit('unoCaught', { targetId: e.targetId, catcherId: e.catcherId });
        break;
      case 'playerFinished': {
        // Placements ride on gameState; a toast + chat system message
        // announce the finish to the table.
        const text = `${playerName(room, e.playerId)} finished #${e.place} 🏆`;
        io.to(room.code).emit('toast', { kind: 'info', message: text });
        io.to(room.code).emit('chat:message', rooms.addSystemMessage(room, text));
        break;
      }
      case 'gameOver': {
        room.phase = 'finished';
        const placements = room.players
          .map((p) => ({
            playerId: p.id,
            name: p.name,
            place: room.game?.players.find((ep) => ep.id === p.id)?.place ?? 0,
          }))
          .sort((a, b) => a.place - b.place);
        io.to(room.code).emit('chat:message', rooms.addSystemMessage(room, `Game over! ${playerName(room, e.winnerId)} takes 1st place 🎉`));
        io.to(room.code).emit('gameOver', {
          winnerId: e.winnerId,
          winnerName: playerName(room, e.winnerId),
          placements,
        });
        break;
      }
    }
  }
}

/**
 * Shared wrapper for in-game actions: rate limit, membership, then run.
 * Engine errors come back as ack {ok:false} + an error toast (so the
 * client shakes the offending card).
 */
function withGame(
  io: Server,
  socket: Socket,
  limits: SocketRateLimits,
  cb: AckCallback | undefined,
  action: (game: engine.GameState, player: RoomPlayer) => engine.Result,
  onOk?: (room: Room, player: RoomPlayer) => void,
): void {
  if (!limits.general.tryConsume()) {
    ackErr(cb, 'Rate limited — slow down');
    socket.emit('toast', { kind: 'error', message: 'Slow down!' });
    return;
  }
  const ctx = rooms.lookupSocket(socket.id);
  if (!ctx) {
    ackErr(cb, 'You are not in a room');
    return;
  }
  const { room, player } = ctx;
  if (room.phase !== 'playing' || !room.game) {
    ackErr(cb, 'No game in progress');
    return;
  }
  const result = action(room.game, player);
  if (!result.ok) {
    ackErr(cb, result.error);
    socket.emit('toast', { kind: 'error', message: result.error });
    return;
  }
  ackOk(cb);
  onOk?.(room, player);
  emitEffects(io, room, result.effects);
  broadcastState(io, room);
}

export function registerHandlers(io: Server): void {
  io.on('connection', (socket) => {
    const limits = new SocketRateLimits();

    /** Join the socket.io room + confirm membership after create/join/rejoin. */
    const settle = (room: Room, player: RoomPlayer, cb?: AckCallback) => {
      void socket.join(room.code);
      ackOk(cb, { roomCode: room.code, playerId: player.id });
      // Replay recent chat history to this socket only (ephemeral context).
      if (room.chat.length > 0) socket.emit('chat:history', { messages: room.chat });
      broadcastState(io, room);
    };

    socket.on('createRoom', (payload: { name?: unknown; rules?: unknown }, cb?: AckCallback) => {
      if (!limits.general.tryConsume()) return ackErr(cb, 'Rate limited — slow down');
      const result = rooms.createRoom(payload?.name, payload?.rules, socket.id);
      if ('error' in result) return ackErr(cb, result.error);
      settle(result.room, result.player, cb);
    });

    socket.on(
      'joinRoom',
      (payload: { roomCode?: unknown; name?: unknown }, cb?: AckCallback) => {
        if (!limits.general.tryConsume()) return ackErr(cb, 'Rate limited — slow down');
        const result = rooms.joinRoom(payload?.roomCode, payload?.name, socket.id);
        if ('error' in result) return ackErr(cb, result.error);
        const sys = rooms.addSystemMessage(result.room, `${result.player.name} joined the room 👋`);
        io.to(result.room.code).emit('chat:message', sys);
        settle(result.room, result.player, cb);
      },
    );

    socket.on(
      'rejoinRoom',
      (
        payload: { roomCode?: unknown; playerId?: unknown; name?: unknown },
        cb?: AckCallback,
      ) => {
        if (!limits.general.tryConsume()) return ackErr(cb, 'Rate limited — slow down');
        const result = rooms.rejoinRoom(
          payload?.roomCode,
          payload?.playerId,
          payload?.name,
          socket.id,
        );
        if ('error' in result) return ackErr(cb, result.error);
        const { room, player } = result;
        if (room.game) engine.handleReconnect(room.game, player.id);
        socket.to(room.code).emit('playerPresence', { playerId: player.id, connected: true });
        settle(room, player, cb);
      },
    );

    socket.on('updateRules', (payload: { rules?: unknown }, cb?: AckCallback) => {
      if (!limits.general.tryConsume()) return ackErr(cb, 'Rate limited — slow down');
      const ctx = rooms.lookupSocket(socket.id);
      if (!ctx) return ackErr(cb, 'You are not in a room');
      const result = rooms.updateRules(ctx.room, ctx.player, payload?.rules);
      if ('error' in result) return ackErr(cb, result.error);
      ackOk(cb);
      broadcastState(io, ctx.room);
    });

    socket.on('startGame', (_payload: unknown, cb?: AckCallback) => {
      if (!limits.general.tryConsume()) return ackErr(cb, 'Rate limited — slow down');
      const ctx = rooms.lookupSocket(socket.id);
      if (!ctx) return ackErr(cb, 'You are not in a room');
      const { room, player } = ctx;
      if (room.phase !== 'lobby') return ackErr(cb, 'Game already started');
      if (room.hostId !== player.id) return ackErr(cb, 'Only the host can start the game');
      const connectedCount = room.players.filter((p) => p.connected).length;
      if (connectedCount < 2) return ackErr(cb, 'Need at least 2 connected players');

      room.deckCount = rooms.computeDeckCount(room.players.length);
      const { state, effects } = engine.createGame(
        room.players.map((p) => ({ id: p.id, connected: p.connected })),
        room.deckCount,
        room.rules,
      );
      room.game = state;
      room.phase = 'playing';
      const sys = rooms.addSystemMessage(room, 'The game has started! 🎮');
      io.to(room.code).emit('chat:message', sys);
      ackOk(cb);
      emitEffects(io, room, effects);
      broadcastState(io, room);
    });

    socket.on(
      'playCard',
      (
        payload: { cardId?: unknown; chosenColor?: unknown; swapTargetId?: unknown },
        cb?: AckCallback,
      ) => {
        const cardId = payload?.cardId;
        if (typeof cardId !== 'string') return ackErr(cb, 'cardId is required');
        if (payload?.chosenColor !== undefined && !isColor(payload.chosenColor)) {
          return ackErr(cb, 'chosenColor must be red, yellow, green or blue');
        }
        if (payload?.swapTargetId !== undefined && typeof payload.swapTargetId !== 'string') {
          return ackErr(cb, 'swapTargetId must be a player id');
        }
        withGame(io, socket, limits, cb, (game, player) =>
          engine.playCard(
            game,
            player.id,
            cardId,
            payload?.chosenColor as Color | undefined,
            payload?.swapTargetId as string | undefined,
          ),
        );
      },
    );

    socket.on('drawCard', (_payload: unknown, cb?: AckCallback) => {
      withGame(io, socket, limits, cb, (game, player) => engine.drawCard(game, player.id));
    });

    socket.on('passTurn', (_payload: unknown, cb?: AckCallback) => {
      withGame(io, socket, limits, cb, (game, player) => engine.passTurn(game, player.id));
    });

    socket.on('callUno', (_payload: unknown, cb?: AckCallback) => {
      withGame(
        io,
        socket,
        limits,
        cb,
        (game, player) => engine.callUno(game, player.id),
        (room, player) => {
          io.to(room.code).emit('unoCalled', { playerId: player.id });
        },
      );
    });

    socket.on('catchPlayer', (payload: { targetId?: unknown }, cb?: AckCallback) => {
      const targetId = payload?.targetId;
      if (typeof targetId !== 'string') return ackErr(cb, 'targetId is required');
      withGame(io, socket, limits, cb, (game, player) =>
        engine.catchPlayer(game, player.id, targetId),
      );
    });

    socket.on('sendReaction', (payload: { emoji?: unknown }, cb?: AckCallback) => {
      if (!limits.reaction.tryConsume() || !limits.general.tryConsume()) {
        return ackErr(cb, 'Rate limited — slow down');
      }
      const emoji = payload?.emoji;
      if (typeof emoji !== 'string' || !(ALLOWED_REACTIONS as readonly string[]).includes(emoji)) {
        return ackErr(cb, 'Reaction must be one of 😂 😮 😭 🔥 👏');
      }
      const ctx = rooms.lookupSocket(socket.id);
      if (!ctx) return ackErr(cb, 'You are not in a room');
      ackOk(cb);
      io.to(ctx.room.code).emit('emojiEffect', {
        playerId: ctx.player.id,
        emoji,
        kind: 'reaction',
      });
    });

    socket.on('playAgain', (_payload: unknown, cb?: AckCallback) => {
      if (!limits.general.tryConsume()) return ackErr(cb, 'Rate limited — slow down');
      const ctx = rooms.lookupSocket(socket.id);
      if (!ctx) return ackErr(cb, 'You are not in a room');
      const { room, player } = ctx;
      if (room.hostId !== player.id) return ackErr(cb, 'Only the host can restart the game');
      if (room.phase !== 'finished') return ackErr(cb, 'No finished game to restart');
      room.game = null;
      room.phase = 'lobby';
      ackOk(cb);
      broadcastState(io, room);
    });

    // Chat: room-scoped (lobby and game). Excess rate → silently dropped
    // (ack still ok:true, nothing broadcast).
    socket.on('chat:send', (payload: { text?: unknown }, cb?: AckCallback) => {
      const ctx = rooms.lookupSocket(socket.id);
      if (!ctx) return ackErr(cb, 'You are not in a room');
      const text = rooms.sanitizeChatText(payload?.text);
      if (!text) return ackErr(cb, 'Message cannot be empty');
      if (!limits.chat.tryConsume()) return ackOk(cb); // silently dropped
      const msg = rooms.addChatMessage(ctx.room, ctx.player, text);
      io.to(ctx.room.code).emit('chat:message', msg);
      ackOk(cb);
    });

    socket.on('leaveRoom', (_payload: unknown, cb?: AckCallback) => {
      if (!limits.general.tryConsume()) return ackErr(cb, 'Rate limited — slow down');
      const ctx = rooms.lookupSocket(socket.id);
      if (!ctx) return ackErr(cb, 'You are not in a room');
      const { room, player } = ctx;
      rooms.unbindSocket(socket.id);
      void socket.leave(room.code);
      const result = rooms.leaveRoom(room, player);
      ackOk(cb);
      if ('error' in result || result.kind === 'roomClosed') return;
      io.to(room.code).emit('chat:message', rooms.addSystemMessage(room, `${player.name} left the room 👋`));
      if (result.kind === 'markedAway' && room.game) {
        engine.handleDisconnect(room.game, player.id);
        io.to(room.code).emit('playerPresence', { playerId: player.id, connected: false });
      }
      broadcastState(io, room);
    });

    socket.on('disconnect', () => {
      const ctx = rooms.lookupSocket(socket.id);
      rooms.unbindSocket(socket.id);
      if (!ctx) return;
      const { room, player } = ctx;
      rooms.handleSocketDrop(room, player);
      if (room.players.every((p) => !p.connected)) {
        // Everyone is gone (lobby or mid-game) — clean the room up.
        rooms.deleteRoom(room.code);
        return;
      }
      if (room.phase === 'playing' && room.game) {
        engine.handleDisconnect(room.game, player.id);
      }
      io.to(room.code).emit('playerPresence', { playerId: player.id, connected: false });
      broadcastState(io, room);
    });
  });
}

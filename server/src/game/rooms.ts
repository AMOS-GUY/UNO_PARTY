/**
 * Room registry. Pure data layer — no socket imports. The socket handlers
 * bind sockets to players and translate results into events.
 */
import { randomBytes, randomInt } from 'node:crypto';
import type { ChatMessage, HouseRules, RoomPhase } from '../shared/protocol.js';
import { CHAT_HISTORY_SIZE, CHAT_MAX_LENGTH, DEFAULT_RULES, MAX_PLAYERS } from '../shared/protocol.js';
import type { GameState } from './engine.js';

export interface RoomPlayer {
  id: string; // 16-byte hex token, needed for rejoin
  name: string;
  avatar: string; // emoji, unique within the room
  socketId: string | null; // current live socket, if connected
  connected: boolean;
}

export interface Room {
  code: string;
  phase: RoomPhase;
  players: RoomPlayer[]; // seat order == turn order once the game starts
  hostId: string;
  deckCount: number; // set at game start: ceil(players / 4)
  game: GameState | null;
  rules: HouseRules; // house-rule config, editable in the lobby by the host
  chat: ChatMessage[]; // ephemeral: last CHAT_HISTORY_SIZE messages, dies with the room
}

/** Unambiguous alphabet: no 0/O/1/I. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const AVATARS = [
  '🦊', '🐼', '🐸', '🦁', '🐯', '🐨', '🐷', '🐙',
  '🦄', '🐝', '🦖', '🐳', '🦉', '🐢', '🐰', '🦜',
];

const rooms = new Map<string, Room>();
const socketIndex = new Map<string, { roomCode: string; playerId: string }>();

function generateRoomCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
}

function newPlayerId(): string {
  return randomBytes(16).toString('hex');
}

function pickAvatar(room: Room): string {
  const used = new Set(room.players.map((p) => p.avatar));
  const free = AVATARS.filter((a) => !used.has(a));
  // 16 avatars == max 16 players, so this never runs dry.
  return free[randomInt(free.length)]!;
}

function validateName(name: unknown): string | { error: string } {
  if (typeof name !== 'string') return { error: 'Name must be a string' };
  const trimmed = name.trim().slice(0, 20);
  if (trimmed.length === 0) return { error: 'Name is required' };
  return trimmed;
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function deleteRoom(code: string): void {
  rooms.delete(code);
}

export function lookupSocket(socketId: string): { room: Room; player: RoomPlayer } | undefined {
  const hit = socketIndex.get(socketId);
  if (!hit) return undefined;
  const room = rooms.get(hit.roomCode);
  const player = room?.players.find((p) => p.id === hit.playerId);
  if (!room || !player) return undefined;
  return { room, player };
}

export function bindSocket(socketId: string, roomCode: string, playerId: string): void {
  socketIndex.set(socketId, { roomCode, playerId });
}

export function unbindSocket(socketId: string): void {
  socketIndex.delete(socketId);
}

/** Merge a client-supplied partial rules object over the defaults, keeping only valid booleans. */
export function sanitizeRules(raw: unknown): HouseRules {
  const rules: HouseRules = { ...DEFAULT_RULES };
  if (raw && typeof raw === 'object') {
    for (const key of ['stacking', 'sevenZero', 'jumpIn'] as const) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === 'boolean') rules[key] = v;
    }
  }
  return rules;
}

export function createRoom(
  name: unknown,
  rulesRaw: unknown,
  socketId: string,
): { room: Room; player: RoomPlayer } | { error: string } {
  const valid = validateName(name);
  if (typeof valid !== 'string') return valid;
  const code = generateRoomCode();
  const room: Room = {
    code,
    phase: 'lobby',
    players: [],
    hostId: '',
    deckCount: 1,
    game: null,
    rules: sanitizeRules(rulesRaw),
    chat: [],
  };
  const player: RoomPlayer = {
    id: newPlayerId(),
    name: valid,
    avatar: pickAvatar(room),
    socketId,
    connected: true,
  };
  room.players.push(player);
  room.hostId = player.id;
  rooms.set(code, room);
  bindSocket(socketId, code, player.id);
  return { room, player };
}

export function joinRoom(
  code: unknown,
  name: unknown,
  socketId: string,
): { room: Room; player: RoomPlayer } | { error: string } {
  if (typeof code !== 'string') return { error: 'roomCode is required' };
  const room = getRoom(code);
  if (!room) return { error: 'Room not found' };
  const valid = validateName(name);
  if (typeof valid !== 'string') return valid;
  if (room.phase !== 'lobby') return { error: 'Game already started' };
  if (room.players.length >= MAX_PLAYERS) return { error: 'Room is full' };
  const player: RoomPlayer = {
    id: newPlayerId(),
    name: valid,
    avatar: pickAvatar(room),
    socketId,
    connected: true,
  };
  room.players.push(player);
  bindSocket(socketId, room.code, player.id);
  return { room, player };
}

export function rejoinRoom(
  code: unknown,
  playerId: unknown,
  name: unknown,
  socketId: string,
): { room: Room; player: RoomPlayer } | { error: string } {
  if (typeof code !== 'string' || typeof playerId !== 'string') {
    return { error: 'roomCode and playerId are required' };
  }
  const room = getRoom(code);
  if (!room) return { error: 'Room not found' };
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return { error: 'Player not found in this room' };
  if (player.connected && player.socketId && player.socketId !== socketId) {
    return { error: 'This player is already connected' };
  }
  const valid = validateName(name);
  if (typeof valid === 'string') player.name = valid;
  player.socketId = socketId;
  player.connected = true;
  bindSocket(socketId, room.code, player.id);
  return { room, player };
}

export type LeaveResult =
  | { kind: 'seatRemoved'; room: Room; player: RoomPlayer }
  | { kind: 'markedAway'; room: Room; player: RoomPlayer }
  | { kind: 'roomClosed'; player: RoomPlayer }
  | { error: string };

/**
 * Explicit leaveRoom: in the lobby (or after the game finished) the seat is
 * removed; mid-game the player is marked disconnected (their hand stays,
 * they could rejoin).
 */
export function leaveRoom(room: Room, player: RoomPlayer): LeaveResult {
  if (room.phase === 'lobby' || room.phase === 'finished') {
    room.players = room.players.filter((p) => p.id !== player.id);
    if (room.players.length === 0) {
      rooms.delete(room.code);
      return { kind: 'roomClosed', player };
    }
    if (room.hostId === player.id) {
      const next = room.players.find((p) => p.connected) ?? room.players[0]!;
      room.hostId = next.id;
    }
    return { kind: 'seatRemoved', room, player };
  }
  player.connected = false;
  player.socketId = null;
  return { kind: 'markedAway', room, player };
}

/**
 * Socket dropped without leaveRoom: mark away, migrate the host if needed.
 * Returns false when the room no longer exists for this player.
 */
export function handleSocketDrop(room: Room, player: RoomPlayer): void {
  player.connected = false;
  player.socketId = null;
  if (room.phase === 'lobby' && room.hostId === player.id) {
    const next = room.players.find((p) => p.connected);
    if (next) room.hostId = next.id;
  }
  // Empty lobby rooms (everyone gone) are cleaned up.
  if (room.phase === 'lobby' && room.players.every((p) => !p.connected)) {
    rooms.delete(room.code);
  }
}

/** Host-only, lobby-only house-rule update; merges valid boolean keys over the current rules. */
export function updateRules(room: Room, player: RoomPlayer, rulesRaw: unknown): { ok: true } | { error: string } {
  if (room.hostId !== player.id) return { error: 'Only the host can change house rules' };
  if (room.phase !== 'lobby') return { error: 'Rules are locked once the game starts' };
  if (rulesRaw && typeof rulesRaw === 'object') {
    for (const key of ['stacking', 'sevenZero', 'jumpIn'] as const) {
      const v = (rulesRaw as Record<string, unknown>)[key];
      if (typeof v === 'boolean') room.rules[key] = v;
    }
  }
  return { ok: true };
}

/** deckCount per the protocol: ceil(playerCount / 4). */
export function computeDeckCount(playerCount: number): number {
  return Math.max(1, Math.ceil(playerCount / 4));
}

// ---- Chat ----

/** Plain-text sanitize: strip control chars, collapse nothing else, trim, cap length. */
export function sanitizeChatText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, CHAT_MAX_LENGTH);
  return text.length > 0 ? text : null;
}

/** Append a player chat message to the room history. */
export function addChatMessage(room: Room, player: RoomPlayer, text: string): ChatMessage {
  const msg: ChatMessage = {
    id: randomBytes(6).toString('hex'),
    playerId: player.id,
    playerName: player.name,
    avatar: player.avatar,
    text,
    ts: Date.now(),
    kind: 'player',
  };
  room.chat.push(msg);
  if (room.chat.length > CHAT_HISTORY_SIZE) room.chat.splice(0, room.chat.length - CHAT_HISTORY_SIZE);
  return msg;
}

/** Append a system message (joined/left/started/finished/game over). */
export function addSystemMessage(room: Room, text: string): ChatMessage {
  const msg: ChatMessage = {
    id: randomBytes(6).toString('hex'),
    playerId: null,
    playerName: 'UNO Party',
    avatar: '',
    text,
    ts: Date.now(),
    kind: 'system',
  };
  room.chat.push(msg);
  if (room.chat.length > CHAT_HISTORY_SIZE) room.chat.splice(0, room.chat.length - CHAT_HISTORY_SIZE);
  return msg;
}

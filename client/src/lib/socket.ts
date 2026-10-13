import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  CatchPlayerPayload,
  ChatSendPayload,
  CreateRoomPayload,
  HouseRules,
  JoinAckData,
  JoinRoomPayload,
  PlayCardPayload,
  RejoinRoomPayload,
  SendReactionPayload,
  UpdateRulesPayload,
} from '../shared/protocol';

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);

export const socket: Socket = io(SERVER_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
});

const ACK_TIMEOUT_MS = 5000;

// Typed emit-with-ack helper matching the protocol's Ack shape.
export function emitAck<T = object>(event: string, payload: object = {}): Promise<Ack<T>> {
  return new Promise((resolve) => {
    socket
      .timeout(ACK_TIMEOUT_MS)
      .emit(event, payload, (err: Error | null, res: Ack<T>) => {
        if (err) {
          resolve({ ok: false, error: 'Server did not respond in time' });
        } else {
          resolve(res);
        }
      });
  });
}

export const api = {
  createRoom: (name: string, rules?: Partial<HouseRules>) =>
    emitAck<JoinAckData>('createRoom', { name, rules } satisfies CreateRoomPayload),
  joinRoom: (roomCode: string, name: string) =>
    emitAck<JoinAckData>('joinRoom', {
      roomCode,
      name,
    } satisfies JoinRoomPayload),
  rejoinRoom: (roomCode: string, playerId: string, name: string) =>
    emitAck<JoinAckData>('rejoinRoom', {
      roomCode,
      playerId,
      name,
    } satisfies RejoinRoomPayload),
  updateRules: (rules: Partial<HouseRules>) =>
    emitAck('updateRules', { rules } satisfies UpdateRulesPayload),
  startGame: () => emitAck('startGame'),
  playCard: (cardId: string, options: { chosenColor?: PlayCardPayload['chosenColor']; swapTargetId?: string } = {}) =>
    emitAck('playCard', {
      cardId,
      chosenColor: options.chosenColor,
      swapTargetId: options.swapTargetId,
    } satisfies PlayCardPayload),
  drawCard: () => emitAck('drawCard'),
  passTurn: () => emitAck('passTurn'),
  callUno: () => emitAck('callUno'),
  playAgain: () => emitAck('playAgain'),
  catchPlayer: (targetId: string) =>
    emitAck('catchPlayer', { targetId } satisfies CatchPlayerPayload),
  sendReaction: (emoji: string) =>
    emitAck('sendReaction', { emoji } satisfies SendReactionPayload),
  sendChat: (text: string) =>
    emitAck('chat:send', { text } satisfies ChatSendPayload),
  leaveRoom: () => emitAck('leaveRoom'),
};

// Session persistence, keyed by roomCode (protocol: rejoin flow).
// sessionStorage (not localStorage) keeps the seat tab-scoped: reloads and
// network drops in this tab rejoin the same seat, while a second tab on the
// same browser can join the same room as a different player.
const KEY_PREFIX = 'uno-party:session:';

export interface StoredSession {
  playerId: string;
  name: string;
}

export function loadSession(roomCode: string): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + roomCode.toUpperCase());
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(roomCode: string, session: StoredSession): void {
  sessionStorage.setItem(KEY_PREFIX + roomCode.toUpperCase(), JSON.stringify(session));
}

export function clearSession(roomCode: string): void {
  sessionStorage.removeItem(KEY_PREFIX + roomCode.toUpperCase());
}

// The room this tab is currently seated in — lets a full page reload find its
// session again (roomCodeRef alone only covers socket-level reconnects).
const CURRENT_ROOM_KEY = 'uno-party:current-room';

export function setCurrentRoom(roomCode: string): void {
  sessionStorage.setItem(CURRENT_ROOM_KEY, roomCode.toUpperCase());
}

export function getCurrentRoom(): string | null {
  return sessionStorage.getItem(CURRENT_ROOM_KEY);
}

export function clearCurrentRoom(): void {
  sessionStorage.removeItem(CURRENT_ROOM_KEY);
}

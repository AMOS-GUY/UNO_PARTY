/**
 * Shared protocol types — mirrors /shared/protocol.md exactly.
 * Keep this file in sync with client/src/shared/protocol.ts.
 */

export type Color = 'red' | 'yellow' | 'green' | 'blue';

export type CardValue =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'skip' | 'reverse' | 'draw2'
  | 'wild' | 'wild4';

export interface Card {
  id: string; // unique per card instance, e.g. "d1-c17"
  color: Color | 'wild';
  value: CardValue;
}

export interface PlayerPublic {
  id: string; // stable player id (secret-ish token, used for rejoin)
  name: string;
  avatar: string; // emoji avatar, server-assigned
  connected: boolean;
  isHost: boolean;
  cardCount: number;
  hasCalledUno: boolean; // true while player sits on 1 card having called UNO
}

export type RoomPhase = 'lobby' | 'playing' | 'finished';

export interface HouseRules {
  stacking: boolean; // +2/+4 stacking (default true)
  sevenZero: boolean; // 7 swaps hands with a chosen player, 0 rotates all hands (default false)
  jumpIn: boolean; // out-of-turn play with an exact match (default false)
}

export const DEFAULT_RULES: HouseRules = { stacking: true, sevenZero: false, jumpIn: false };

export interface DrawStack {
  amount: number;
  kind: 'draw2' | 'wild4';
}

export interface GameStateForClient {
  roomCode: string;
  phase: RoomPhase;
  hostId: string;
  players: PlayerPublic[]; // in turn order
  myPlayerId: string;
  myHand: Card[]; // empty unless phase === 'playing'
  topCard: Card | null;
  activeColor: Color | null; // set by wild cards; equals topCard.color otherwise
  currentPlayerId: string | null;
  direction: 1 | -1;
  deckCount: number; // how many physical decks the room uses
  drawPileCount: number;
  drawStack: DrawStack | null;
  unoPending: { playerId: string; deadline: number } | null; // deadline = epoch ms
  winnerId: string | null;
  drawableCardId: string | null;
  canCatch: boolean; // true for me if I may use the "Caught!" button now
  rules: HouseRules; // the room's house-rule configuration
}

// ---- Client -> Server payloads ----

export type Ack<T = undefined> = T extends undefined
  ? { ok: true } | { ok: false; error: string }
  : ({ ok: true } & T) | { ok: false; error: string };

export interface CreateRoomPayload {
  name: string;
  rules?: Partial<HouseRules>; // missing keys fall back to DEFAULT_RULES
}
export interface CreateRoomAckData {
  roomCode: string;
  playerId: string;
}

export interface JoinRoomPayload {
  roomCode: string;
  name: string;
}
export interface JoinRoomAckData {
  roomCode: string;
  playerId: string;
}

export interface RejoinRoomPayload {
  roomCode: string;
  playerId: string;
  name: string;
}
export interface RejoinRoomAckData {
  roomCode: string;
  playerId: string;
}

export interface PlayCardPayload {
  cardId: string;
  chosenColor?: Color;
  swapTargetId?: string; // required when sevenZero is on and the card is a 7
}

export interface UpdateRulesPayload {
  rules: Partial<HouseRules>;
}

export interface CatchPlayerPayload {
  targetId: string;
}

export interface SendReactionPayload {
  emoji: string;
}

// ---- Server -> Client payloads ----

export interface ToastPayload {
  kind: 'error' | 'info';
  message: string;
}

export interface CardPlayedPayload {
  playerId: string;
  card: Card;
  chosenColor?: Color;
}

export interface CardDrawnPayload {
  playerId: string;
  count: number;
}

export interface EmojiEffectPayload {
  playerId: string;
  emoji: string;
  kind: 'reaction' | 'penalty' | 'skip' | 'reverse';
}

export interface UnoCalledPayload {
  playerId: string;
}

export interface UnoCaughtPayload {
  targetId: string;
  catcherId: string;
}

export interface GameOverPayload {
  winnerId: string;
  winnerName: string;
}

export interface PlayerPresencePayload {
  playerId: string;
  connected: boolean;
}

/** The five allowed chat reactions. */
export const ALLOWED_REACTIONS = ['😂', '😮', '😭', '🔥', '👏'] as const;
export type ReactionEmoji = (typeof ALLOWED_REACTIONS)[number];

/** Emojis the server emits for penalty/skip/reverse effects. */
export const EFFECT_EMOJI = {
  penalty: '😂',
  skip: '😜',
  reverse: '🔄',
} as const;

/** Milliseconds a player on 1 card has to call UNO before they can be caught. */
export const UNO_WINDOW_MS = 3000;

export const MAX_PLAYERS = 16;
export const HAND_SIZE = 7;

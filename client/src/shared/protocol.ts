// Shared Socket Protocol — copy of /shared/protocol.md data model.
// Single source of truth: /shared/protocol.md. Keep in sync.

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

// What every client knows about the room/game (plus their private hand)
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
  // active penalty stack: null when no stack is pending
  drawStack: { amount: number; kind: 'draw2' | 'wild4' } | null;
  // player currently on 1 card who has NOT called UNO yet; deadline = epoch ms
  unoPending: { playerId: string; deadline: number } | null;
  winnerId: string | null;
  // id of the card the current player just drew this turn, or null
  drawableCardId: string | null;
  canCatch: boolean; // true for me if I may use the "Caught!" button now
  rules: HouseRules; // the room's house-rule configuration
}

export interface HouseRules {
  stacking: boolean; // +2/+4 stacking (default true)
  sevenZero: boolean; // 7 swaps hands with a chosen player, 0 rotates all hands (default false)
  jumpIn: boolean; // out-of-turn play with an exact match (default false)
}

export const DEFAULT_RULES: HouseRules = { stacking: true, sevenZero: false, jumpIn: false };

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// ---- Client → Server payloads ----

export interface CreateRoomPayload {
  name: string;
  rules?: Partial<HouseRules>;
}
export interface JoinRoomPayload {
  roomCode: string;
  name: string;
}
export interface RejoinRoomPayload {
  roomCode: string;
  playerId: string;
  name: string;
}
export interface UpdateRulesPayload {
  rules: Partial<HouseRules>;
}
export interface PlayCardPayload {
  cardId: string;
  chosenColor?: Color;
  swapTargetId?: string;
}
export interface CatchPlayerPayload {
  targetId: string;
}
export interface SendReactionPayload {
  emoji: string;
}

export interface JoinAckData {
  roomCode: string;
  playerId: string;
}

// ---- Server → Client payloads ----

export interface ToastEvent {
  kind: 'error' | 'info';
  message: string;
}
export interface CardPlayedEvent {
  playerId: string;
  card: Card;
  chosenColor?: Color;
}
export interface CardDrawnEvent {
  playerId: string;
  count: number;
}
export interface EmojiEffectEvent {
  playerId: string;
  emoji: string;
  kind: 'reaction' | 'penalty' | 'skip' | 'reverse';
}
export interface UnoCalledEvent {
  playerId: string;
}
export interface UnoCaughtEvent {
  targetId: string;
  catcherId: string;
}
export interface GameOverEvent {
  winnerId: string;
  winnerName: string;
}
export interface PlayerPresenceEvent {
  playerId: string;
  connected: boolean;
}

export const REACTION_EMOJIS = ['😂', '😮', '😭', '🔥', '👏'] as const;

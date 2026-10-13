/**
 * Pure-ish game engine. No socket imports — the socket layer translates
 * the returned effects into events and builds personalized game state.
 *
 * All public functions validate the action and return either
 * `{ ok: true, effects }` or `{ ok: false, error }`; state is only
 * mutated on success.
 */
import type {
  Card,
  Color,
  DrawStack,
  EmojiEffectPayload,
  HouseRules,
} from '../shared/protocol.js';
import { UNO_WINDOW_MS } from '../shared/protocol.js';
import { buildDecks, randomColor, shuffle } from './cards.js';

export interface EnginePlayer {
  id: string;
  connected: boolean;
  hand: Card[];
}

export interface GameState {
  /** Players in turn order. Seats never move once the game starts. */
  players: EnginePlayer[];
  drawPile: Card[];
  discardPile: Card[];
  activeColor: Color;
  currentIndex: number;
  direction: 1 | -1;
  drawStack: DrawStack | null;
  /** Single pending window per the protocol's data model. */
  unoPending: { playerId: string; deadline: number } | null;
  /** Players sitting on 1 card who have called UNO. */
  unoCalled: Set<string>;
  /** Current player has used their free draw this turn. */
  drewThisTurn: boolean;
  /** The card drawn via free draw — the only card that may now be played. */
  drawableCardId: string | null;
  winnerId: string | null;
  /** The room's house-rule configuration, fixed at game start. */
  rules: HouseRules;
}

export type Effect =
  | { type: 'cardPlayed'; playerId: string; card: Card; chosenColor?: Color }
  | { type: 'cardDrawn'; playerId: string; count: number }
  | { type: 'emoji'; playerId: string; emoji: string; kind: EmojiEffectPayload['kind'] }
  | { type: 'unoCaught'; targetId: string; catcherId: string }
  | { type: 'gameOver'; winnerId: string };

export type Result = { ok: true; effects: Effect[] } | { ok: false; error: string };

const ok = (effects: Effect[] = []): Result => ({ ok: true, effects });
const err = (error: string): Result => ({ ok: false, error });

const NUMERIC = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

export function topCard(state: GameState): Card | null {
  return state.discardPile.length > 0
    ? state.discardPile[state.discardPile.length - 1]!
    : null;
}

export function currentPlayer(state: GameState): EnginePlayer {
  return state.players[state.currentIndex]!;
}

function findPlayer(state: GameState, playerId: string): EnginePlayer | undefined {
  return state.players.find((p) => p.id === playerId);
}

/** Is `card` legal on top of the pile, ignoring turn/stack/drawable rules? */
export function canPlay(state: GameState, card: Card): boolean {
  if (card.color === 'wild') return true;
  const top = topCard(state);
  if (!top) return true;
  return card.color === state.activeColor || card.value === top.value;
}

/** One step in the current direction, skipping disconnected players. */
function stepOnce(state: GameState, from: number): number {
  const n = state.players.length;
  let i = from;
  for (let k = 0; k < n; k++) {
    i = (((i + state.direction) % n) + n) % n;
    if (state.players[i]!.connected) return i;
  }
  return from; // nobody else connected: keep the turn here
}

function advance(state: GameState, steps: number): void {
  for (let s = 0; s < steps; s++) {
    state.currentIndex = stepOnce(state, state.currentIndex);
  }
  state.drewThisTurn = false;
  state.drawableCardId = null;
}

/** Recycle the discard pile (minus top card) when the draw pile runs low. */
function ensureDrawPile(state: GameState, need: number): void {
  if (state.drawPile.length >= need) return;
  const top = state.discardPile.pop();
  if (state.discardPile.length > 0) {
    state.drawPile.push(...shuffle(state.discardPile));
    state.discardPile = top ? [top] : [];
  }
}

/** Move up to `n` cards from the draw pile into `player`'s hand. Returns count drawn. */
function dealTo(state: GameState, player: EnginePlayer, n: number): number {
  ensureDrawPile(state, n);
  let drawn = 0;
  while (drawn < n && state.drawPile.length > 0) {
    player.hand.push(state.drawPile.pop()!);
    drawn++;
  }
  return drawn;
}

/**
 * Clear UNO state for players who are no longer on exactly 1 card.
 * Called after every hand-size change.
 */
function syncUnoState(state: GameState): void {
  for (const p of state.players) {
    if (p.hand.length !== 1) state.unoCalled.delete(p.id);
  }
  if (state.unoPending) {
    const pending = findPlayer(state, state.unoPending.playerId);
    if (!pending || pending.hand.length !== 1) state.unoPending = null;
  }
}

/**
 * Deal a new game. `players` is the seat order (turn order).
 * Initial flip: action cards apply; wild → random active color;
 * wild4 → buried and re-flipped (per protocol's "simple approach").
 */
export function createGame(
  players: { id: string; connected: boolean }[],
  deckCount: number,
  rules: HouseRules,
): { state: GameState; effects: Effect[] } {
  const state: GameState = {
    players: players.map((p) => ({ id: p.id, connected: p.connected, hand: [] })),
    drawPile: shuffle(buildDecks(deckCount)),
    discardPile: [],
    activeColor: 'red', // overwritten by the initial flip
    currentIndex: 0,
    direction: 1,
    drawStack: null,
    unoPending: null,
    unoCalled: new Set(),
    drewThisTurn: false,
    drawableCardId: null,
    winnerId: null,
    rules,
  };
  const effects: Effect[] = [];

  for (const p of state.players) dealTo(state, p, 7);

  // Flip until a non-wild4 start card; buried wild4s go back via reshuffle later.
  const buried: Card[] = [];
  let first: Card;
  for (;;) {
    ensureDrawPile(state, 1);
    first = state.drawPile.pop()!;
    if (first.value === 'wild4') {
      buried.push(first);
      continue;
    }
    break;
  }
  state.drawPile.push(...buried);
  state.discardPile.push(first);
  state.activeColor = first.color === 'wild' ? randomColor() : first.color;

  const starter = currentPlayer(state);
  switch (first.value) {
    case 'skip': {
      effects.push({ type: 'emoji', playerId: starter.id, emoji: '😜', kind: 'skip' });
      advance(state, 1);
      break;
    }
    case 'reverse': {
      state.direction = -1;
      effects.push({ type: 'emoji', playerId: starter.id, emoji: '🔄', kind: 'reverse' });
      // Player 0 still opens; play simply proceeds the other way.
      break;
    }
    case 'draw2': {
      const n = dealTo(state, starter, 2);
      if (n > 0) {
        effects.push({ type: 'cardDrawn', playerId: starter.id, count: n });
        effects.push({ type: 'emoji', playerId: starter.id, emoji: '😂', kind: 'penalty' });
      }
      advance(state, 1); // drawing player is also skipped
      break;
    }
    default:
      break; // number or wild: nothing extra
  }
  return { state, effects };
}

export function playCard(
  state: GameState,
  playerId: string,
  cardId: string,
  chosenColor?: Color,
  swapTargetId?: string,
): Result {
  if (state.winnerId) return err('Game is over');

  // Jump-in (house rule): an out-of-turn exact match steals the turn.
  // Exact = same color AND same value as the top card; wilds never qualify.
  // With a stack pending only a stack-legal card may jump in.
  let player = currentPlayer(state);
  if (player.id !== playerId) {
    if (!state.rules.jumpIn) return err('Not your turn');
    const jumper = findPlayer(state, playerId);
    if (!jumper || !jumper.connected) return err('Not your turn');
    const card = jumper.hand.find((c) => c.id === cardId);
    if (!card) return err("You don't have that card");
    const top = topCard(state);
    const exact =
      top !== null && card.color !== 'wild' && card.color === top.color && card.value === top.value;
    const stackLegal = !state.drawStack || card.value === state.drawStack.kind;
    if (!exact || !stackLegal) return err('Jump-in requires an exact color and value match');
    // Steal the turn: play continues from the jumper's seat.
    state.currentIndex = state.players.indexOf(jumper);
    state.drewThisTurn = false;
    state.drawableCardId = null;
    player = jumper;
  }

  const cardIndex = player.hand.findIndex((c) => c.id === cardId);
  if (cardIndex === -1) return err("You don't have that card");
  const card = player.hand[cardIndex]!;

  if (card.color === 'wild' && !chosenColor) return err('chosenColor is required for wild cards');

  // Free-draw rule: after drawing, only the drawn card may be played.
  if (state.drewThisTurn && cardId !== state.drawableCardId) {
    return err('You may only play the card you just drew, or pass');
  }

  // Stacking rule: with a pending stack only the same kind may be played.
  if (state.drawStack) {
    const required = state.drawStack.kind;
    if (card.value !== required) {
      return err(`You must stack a ${required} or draw the ${state.drawStack.amount}-card penalty`);
    }
  } else if (!canPlay(state, card)) {
    return err("Card doesn't match the active color or value");
  }

  // 7-0 house rule: playing a 7 swaps hands with a chosen player.
  let swapTarget: EnginePlayer | null = null;
  if (state.rules.sevenZero && card.value === '7') {
    if (!swapTargetId) return err('Choose a player to swap hands with');
    if (swapTargetId === playerId) return err('You cannot swap hands with yourself');
    swapTarget = findPlayer(state, swapTargetId) ?? null;
    if (!swapTarget) return err('No such player to swap with');
  }

  player.hand.splice(cardIndex, 1);
  state.discardPile.push(card);
  state.activeColor = card.color === 'wild' ? chosenColor! : card.color;

  const effects: Effect[] = [{ type: 'cardPlayed', playerId, card, chosenColor }];

  // Winning ends the game immediately — no card effects apply.
  if (player.hand.length === 0) {
    state.winnerId = playerId;
    state.unoPending = null;
    state.unoCalled.delete(playerId);
    effects.push({ type: 'gameOver', winnerId: playerId });
    return ok(effects);
  }

  // 7-0 house rule effects apply after the win check.
  if (state.rules.sevenZero && card.value === '7' && swapTarget) {
    const mine = player.hand;
    player.hand = swapTarget.hand;
    swapTarget.hand = mine;
  } else if (state.rules.sevenZero && card.value === '0') {
    rotateHands(state);
  }

  if (player.hand.length === 1) {
    state.unoPending = { playerId, deadline: Date.now() + UNO_WINDOW_MS };
    state.unoCalled.delete(playerId);
  }

  switch (card.value) {
    case 'skip':
      effects.push({ type: 'emoji', playerId, emoji: '😜', kind: 'skip' });
      advance(state, 2);
      break;
    case 'reverse':
      state.direction = state.direction === 1 ? -1 : 1;
      effects.push({ type: 'emoji', playerId, emoji: '🔄', kind: 'reverse' });
      // With exactly 2 players reverse acts as skip.
      advance(state, state.players.length === 2 ? 2 : 1);
      break;
    case 'draw2':
      if (state.rules.stacking) {
        if (state.drawStack) state.drawStack.amount += 2;
        else state.drawStack = { amount: 2, kind: 'draw2' };
        advance(state, 1);
      } else {
        // Stacking OFF: the next player draws 2 immediately and is skipped.
        applyImmediateDraw(state, 2, effects);
      }
      break;
    case 'wild4':
      if (state.rules.stacking) {
        if (state.drawStack) state.drawStack.amount += 4;
        else state.drawStack = { amount: 4, kind: 'wild4' };
        advance(state, 1);
      } else {
        applyImmediateDraw(state, 4, effects);
      }
      break;
    default:
      advance(state, 1);
      break;
  }
  syncUnoState(state);
  return ok(effects);
}

/** Rotate every hand one seat in the current direction of play (7-0 rule's 0). */
function rotateHands(state: GameState): void {
  const hands = state.players.map((p) => p.hand);
  const n = hands.length;
  state.players.forEach((p, i) => {
    const from = (((i - state.direction) % n) + n) % n;
    p.hand = hands[from]!;
  });
}

/** Stacking OFF: the next connected player draws `n` and loses their turn. */
function applyImmediateDraw(state: GameState, n: number, effects: Effect[]): void {
  const victimIndex = stepOnce(state, state.currentIndex);
  const victim = state.players[victimIndex]!;
  const drawn = dealTo(state, victim, n);
  if (drawn > 0) {
    effects.push({ type: 'cardDrawn', playerId: victim.id, count: drawn });
    effects.push({ type: 'emoji', playerId: victim.id, emoji: '😂', kind: 'penalty' });
  }
  // Move the turn onto the victim, then past them (they are skipped).
  state.currentIndex = victimIndex;
  advance(state, 1);
}

export function drawCard(state: GameState, playerId: string): Result {
  if (state.winnerId) return err('Game is over');
  const player = currentPlayer(state);
  if (player.id !== playerId) return err('Not your turn');
  const effects: Effect[] = [];

  if (state.drawStack) {
    // Resolving a penalty stack: draw the whole amount, turn passes.
    const amount = state.drawStack.amount;
    const n = dealTo(state, player, amount);
    state.drawStack = null;
    if (n > 0) {
      effects.push({ type: 'cardDrawn', playerId, count: n });
      effects.push({ type: 'emoji', playerId, emoji: '😂', kind: 'penalty' });
    }
    advance(state, 1);
    syncUnoState(state);
    return ok(effects);
  }

  // Free draw: once per turn, even with playable cards.
  if (state.drewThisTurn) return err('You already drew this turn — play the drawn card or pass');
  const n = dealTo(state, player, 1);
  if (n === 0) return err('No cards left to draw');
  const card = player.hand[player.hand.length - 1]!;
  state.drewThisTurn = true;
  state.drawableCardId = card.id;
  effects.push({ type: 'cardDrawn', playerId, count: 1 });
  syncUnoState(state);
  return ok(effects);
}

export function passTurn(state: GameState, playerId: string): Result {
  if (state.winnerId) return err('Game is over');
  const player = currentPlayer(state);
  if (player.id !== playerId) return err('Not your turn');
  if (state.drawStack) return err('You must draw the penalty stack — you cannot pass');
  if (!state.drewThisTurn) return err('You can only pass after drawing a card');
  advance(state, 1);
  return ok();
}

export function callUno(state: GameState, playerId: string): Result {
  if (state.winnerId) return err('Game is over');
  const player = findPlayer(state, playerId);
  if (!player) return err('You are not in this game');
  if (player.hand.length !== 1) return err('You can only call UNO with exactly 1 card');
  if (!state.unoPending || state.unoPending.playerId !== playerId) {
    return err('No UNO window is open for you');
  }
  state.unoPending = null;
  state.unoCalled.add(playerId);
  return ok();
}

export function catchPlayer(state: GameState, catcherId: string, targetId: string): Result {
  if (state.winnerId) return err('Game is over');
  if (catcherId === targetId) return err('You cannot catch yourself');
  const catcher = findPlayer(state, catcherId);
  const target = findPlayer(state, targetId);
  if (!catcher) return err('You are not in this game');
  if (!target) return err('No such player');
  if (!state.unoPending || state.unoPending.playerId !== targetId) {
    return err('That player has no open UNO window');
  }
  if (Date.now() < state.unoPending.deadline) {
    return err('The UNO window is still open — wait for the deadline');
  }
  state.unoPending = null;
  const n = dealTo(state, target, 2);
  const effects: Effect[] = [{ type: 'unoCaught', targetId, catcherId }];
  if (n > 0) effects.push({ type: 'cardDrawn', playerId: targetId, count: n });
  syncUnoState(state);
  return ok(effects);
}

/**
 * A player disconnected. If it was their turn, advance to the next
 * connected player without a draw. Returns true if the turn changed.
 */
export function handleDisconnect(state: GameState, playerId: string): boolean {
  const player = findPlayer(state, playerId);
  if (!player) return false;
  player.connected = false;
  if (state.unoPending?.playerId === playerId) state.unoPending = null;
  state.unoCalled.delete(playerId);
  if (state.winnerId) return false;
  if (currentPlayer(state).id === playerId) {
    advance(state, 1);
    return true;
  }
  return false;
}

/** A rejoined player is connected again. */
export function handleReconnect(state: GameState, playerId: string): void {
  const player = findPlayer(state, playerId);
  if (player) player.connected = true;
}

/** May `playerId` press the "Caught!" button right now? */
export function canCatch(state: GameState, playerId: string): boolean {
  return (
    state.winnerId === null &&
    state.unoPending !== null &&
    state.unoPending.playerId !== playerId &&
    Date.now() >= state.unoPending.deadline
  );
}

/** Used by the socket layer to check a card exists in a hand before effects. */
export function hasCard(state: GameState, playerId: string, cardId: string): boolean {
  const player = findPlayer(state, playerId);
  return !!player && player.hand.some((c) => c.id === cardId);
}

export { NUMERIC };

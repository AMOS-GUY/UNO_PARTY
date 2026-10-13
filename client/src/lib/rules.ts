import type { Card, GameStateForClient } from '../shared/protocol';

// Client-side mirror of the server-side legality rules (protocol.md "Rules
// summary"). The server is authoritative; this is only for UI highlighting.
export function isPlayable(card: Card, state: GameStateForClient): boolean {
  if (state.phase !== 'playing') return false;
  if (state.currentPlayerId !== state.myPlayerId) return false;
  // After drawing, only the drawn card may be played.
  if (state.drawableCardId) return card.id === state.drawableCardId;
  // With a pending draw stack the only legal play is stacking the same kind.
  if (state.drawStack) return card.value === state.drawStack.kind;
  if (card.color === 'wild') return true;
  if (state.activeColor && card.color === state.activeColor) return true;
  if (state.topCard && card.value === state.topCard.value) return true;
  return false;
}

export function isMyTurn(state: GameStateForClient): boolean {
  return state.phase === 'playing' && state.currentPlayerId === state.myPlayerId;
}

export function canPassTurn(state: GameStateForClient): boolean {
  return isMyTurn(state) && state.drawableCardId !== null;
}

export function needsColorChoice(card: Card): boolean {
  return card.value === 'wild' || card.value === 'wild4';
}

// Jump-in house rule: out of turn, only an exact match (same color AND same
// value as the top card) may be slammed down. Wilds never qualify, and a
// pending draw stack restricts jump-ins to stack-legal cards.
export function isJumpInPlayable(card: Card, state: GameStateForClient): boolean {
  if (state.phase !== 'playing') return false;
  if (!state.rules.jumpIn) return false;
  if (state.currentPlayerId === state.myPlayerId) return false; // that's a normal play
  if (!state.topCard) return false;
  if (state.drawStack && card.value !== state.drawStack.kind) return false;
  if (card.color === 'wild') return false;
  return card.color === state.topCard.color && card.value === state.topCard.value;
}

// 7-0 house rule: playing a 7 requires choosing a swap target.
export function needsSwapTarget(card: Card, state: GameStateForClient): boolean {
  return state.rules.sevenZero && card.value === '7';
}

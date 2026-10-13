/**
 * Deck construction and shuffling. Pure module — no I/O, no sockets.
 */
import { randomInt } from 'node:crypto';
import type { Card, CardValue, Color } from '../shared/protocol.js';

export const COLORS: readonly Color[] = ['red', 'yellow', 'green', 'blue'];

/**
 * One standard 108-card UNO deck:
 * per color — one 0, two each of 1–9, two each of skip/reverse/draw2;
 * plus four wild and four wild4.
 * `deckIndex` (1-based) is baked into card ids so cards stay unique
 * across multi-deck games: "d1-c17".
 */
export function buildDeck(deckIndex: number): Card[] {
  const cards: Card[] = [];
  let n = 0;
  const id = () => `d${deckIndex}-c${n++}`;

  for (const color of COLORS) {
    cards.push({ id: id(), color, value: '0' });
    for (let v = 1; v <= 9; v++) {
      const value = String(v) as CardValue;
      cards.push({ id: id(), color, value });
      cards.push({ id: id(), color, value });
    }
    for (const value of ['skip', 'reverse', 'draw2'] as const) {
      cards.push({ id: id(), color, value });
      cards.push({ id: id(), color, value });
    }
  }
  for (let i = 0; i < 4; i++) {
    cards.push({ id: id(), color: 'wild', value: 'wild' });
    cards.push({ id: id(), color: 'wild', value: 'wild4' });
  }
  return cards;
}

/** Build `deckCount` standard decks merged into one pile. */
export function buildDecks(deckCount: number): Card[] {
  const cards: Card[] = [];
  for (let d = 1; d <= deckCount; d++) cards.push(...buildDeck(d));
  return cards;
}

/** In-place Fisher–Yates shuffle using crypto-random indices. Returns the same array. */
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** Random active color for wild cards (initial flip). */
export function randomColor(): Color {
  return COLORS[randomInt(COLORS.length)]!;
}

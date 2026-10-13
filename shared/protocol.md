# UNO Party — Shared Socket Protocol

This file is the **single source of truth** for the client ↔ server contract.
Both `/server` and `/client` copy `protocol.ts` into their own `src/shared/` folder
(`client/src/shared/protocol.ts`, `server/src/shared/protocol.ts`). Keep them in sync.

Transport: Socket.IO over WSS (production) / WS (local dev).
The server is authoritative: clients send intents, server validates everything,
clients only ever receive their own hand.

## Data model

```ts
type Color = 'red' | 'yellow' | 'green' | 'blue';
type CardValue =
  | '0'|'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'
  | 'skip' | 'reverse' | 'draw2'
  | 'wild' | 'wild4';

interface Card {
  id: string;        // unique per card instance, e.g. "d1-c17"
  color: Color | 'wild';
  value: CardValue;
}

interface PlayerPublic {
  id: string;            // stable player id (secret-ish token, used for rejoin)
  name: string;
  avatar: string;        // emoji avatar, server-assigned
  connected: boolean;
  isHost: boolean;
  cardCount: number;
  hasCalledUno: boolean; // true while player sits on 1 card having called UNO
  place: number | null;  // null = still playing; 1 = first to finish, etc.
}

type RoomPhase = 'lobby' | 'playing' | 'finished';

// What every client knows about the room/game (plus their private hand)
interface GameStateForClient {
  roomCode: string;
  phase: RoomPhase;
  hostId: string;
  players: PlayerPublic[];      // in turn order
  myPlayerId: string;
  myHand: Card[];               // empty unless phase === 'playing'
  topCard: Card | null;
  activeColor: Color | null;    // set by wild cards; equals topCard.color otherwise
  currentPlayerId: string | null;
  direction: 1 | -1;
  deckCount: number;            // how many physical decks the room uses
  drawPileCount: number;
  // active penalty stack: e.g. {amount: 6, kind: 'draw2'} means next player
  // must stack a draw2 or draw 6. null when no stack is pending.
  drawStack: { amount: number; kind: 'draw2' | 'wild4' } | null;
  // player currently on 1 card who has NOT called UNO yet
  unoPending: { playerId: string; deadline: number } | null; // deadline = epoch ms
  winnerId: string | null;
  // id of the card the current player just drew this turn (only card they may
  // now play), or null. Only meaningful for the current player's own view.
  drawableCardId: string | null;
  canCatch: boolean; // convenience: true for me if I may use the "Caught!" button now
  rules: HouseRules; // the room's house-rule configuration
  // Spectator reveal: ONLY sent to finished players (place !== null) — maps
  // playerId → that player's hand, face-up. Always null for active players.
  visibleHands: Record<string, Card[]> | null;
}

interface HouseRules {
  stacking: boolean;  // +2/+4 stacking (default true)
  sevenZero: boolean; // 7 swaps hands with a chosen player, 0 rotates all hands (default false)
  jumpIn: boolean;    // out-of-turn play with an exact match (default false)
}

const DEFAULT_RULES: HouseRules = { stacking: true, sevenZero: false, jumpIn: false };
```

## Client → Server events

All mutating events take an ack callback `(res: Ack) => void` where
`type Ack = { ok: true } | { ok: false; error: string }`.

| Event | Payload | Notes |
|---|---|---|
| `createRoom` | `{ name: string, rules?: Partial<HouseRules> }` | Ack data: `{ roomCode, playerId }`. Creator becomes host. Missing rule keys fall back to `DEFAULT_RULES`. |
| `joinRoom` | `{ roomCode: string, name: string }` | Ack data: `{ roomCode, playerId }`. Errors: room not found, full (16), game started. |
| `rejoinRoom` | `{ roomCode: string, playerId: string, name: string }` | Reconnect after disconnect. Restores seat & hand. |
| `updateRules` | `{ rules: Partial<HouseRules> }` | Host only, lobby phase only. Broadcast via `gameState.rules`; shown as badges in-game. |
| `startGame` | `{}` | Host only, needs ≥ 2 connected players, phase must be `lobby`. |
| `playCard` | `{ cardId: string, chosenColor?: Color, swapTargetId?: string }` | `chosenColor` required for wild/wild4. Server validates turn, ownership, legality, draw-stack rules, drawableCardId rule. With `sevenZero` on, playing a `7` requires `swapTargetId` = another player's id (hands are swapped after the play). |
| `drawCard` | `{}` | Current player only. Free draw: allowed even with playable cards, once per turn. After drawing, only the drawn card may be played, else `passTurn`. If a drawStack is pending, drawing resolves the stack (draw `amount`, turn passes). |
| `passTurn` | `{}` | Only allowed after having drawn this turn. |
| `callUno` | `{}` | Caller must have exactly 1 card and a pending UNO window. |
| `catchPlayer` | `{ targetId: string }` | Anyone except target; valid only after `unoPending.deadline` passed. Target draws 2 penalty cards. |
| `sendReaction` | `{ emoji: string }` | One of `😂 😮 😭 🔥 👏`. Rate limited. |
| `leaveRoom` | `{}` | Leaves cleanly; in lobby removes seat, mid-game marks disconnected. |

## Server → Client events

| Event | Payload | Notes |
|---|---|---|
| `gameState` | `GameStateForClient` | Personalized per socket (own hand, myPlayerId, canCatch). Sent on every state change. |
| `toast` | `{ kind: 'error' \| 'info', message: string }` | Error toasts also imply client should shake the offending card (client ties this to its last attempted cardId). |
| `cardPlayed` | `{ playerId: string, card: Card, chosenColor?: Color }` | For animation: slide card to discard pile. |
| `cardDrawn` | `{ playerId: string, count: number }` | For animation: deck → hand. |
| `emojiEffect` | `{ playerId: string, emoji: string, kind: 'reaction' \| 'penalty' \| 'skip' \| 'reverse' }` | Big emoji over avatar (~2s). 😂 on +2/+4 hit, 😜 on skip, 🔄 on reverse, player reactions float up. |
| `unoCalled` | `{ playerId: string }` | Screen shake + "UNO!" banner for everyone. |
| `unoCaught` | `{ targetId: string, catcherId: string }` | Target drew 2 penalty cards. |
| `gameOver` | `{ winnerId: string, winnerName: string, placements: { playerId: string, name: string, place: number }[] }` | Podium screen. `winnerId`/`winnerName` = the 1st-place player; `placements` is the full ranking (last place included). |
| `playAgain` (C→S) | `{}` | Host only, phase must be `finished`. Resets the room to `lobby` with the same players/seats; broadcast via `gameState`. |
| `playerPresence` | `{ playerId: string, connected: boolean }` | Away/back indicator. |

## Rules summary implemented server-side

- Decks: 108-card standard deck × `ceil(playerCount / 4)` (2–4→1, 5–8→2, 9–12→3, 13–16→4). Max 16 players.
- Standard deck per deck: per color — one 0, two each of 1–9, two each of skip/reverse/draw2; four wild, four wild4.
- 7 cards dealt per player. First discard: if it's an action/wild, its effect applies (wild4 → reshuffle until non-wild4 start... simple approach: flip until a non-wild card; if wild, random active color).
- Playable if: matches activeColor, or same value, or any wild. When a drawStack is pending, the ONLY legal plays are stacking the same kind (draw2 on draw2, wild4 on wild4); otherwise the player must drawCard (which draws the whole stacked amount and passes their turn).
- Direction reverses on reverse (with 2 players, reverse acts as skip).
- Skip skips next player.
- UNO: when a player reaches 1 card, server opens a 3s window (`unoPending`). `callUno` clears it. After deadline, anyone may `catchPlayer` → target draws 2, window closes.
- Winner: NO instant win. Playing your last card assigns your finishing place (1st, 2nd, …); you become a spectator (keep seat + place, hold no cards, removed from turn order). The game ends when exactly one active player remains — they get last place automatically. Turn rotation skips finished seats (Reverse flips direction but never resurrects them). A pending +2/+4 stack from a finishing player lands on the next ACTIVE player. Finished players cannot be caught, swapped with (7-0), or jump in.
- Disconnect: player marked `connected: false`, turn skipped if it was theirs (auto-pass after draw... simplest: if current player disconnects, advance turn without draw). Rejoin via `rejoinRoom` restores seat.

## House rules (all enforced engine-side in `server/src/game/`)

- **`stacking` (default ON)** — current behavior. When OFF: playing a draw2/wild4 applies immediately — the next player draws the cards and is skipped; no drawStack is ever created and stacking plays are rejected as ordinary legality allows (a draw2 may still be played *on* a draw2 as a normal color/value match on your turn, it just applies its own +2 immediately instead of adding to a stack).
- **`sevenZero` (default OFF)** — playing a `7` (any color): after the card lands, the player's whole hand is swapped with `swapTargetId`'s hand (must be another connected-or-away player in the room; server validates). Playing a `0` (any color): every hand rotates one seat in the current direction of play. These effects happen after the normal play; winning checks apply before the swap/rotation (playing your last card as a 7 still wins immediately).
- **`jumpIn` (default OFF)** — a player may `playCard` out of turn ONLY with an exact match: same color AND same value as the current topCard (wild/wild4 are never jump-in cards; colored wilds don't exist so only colored cards qualify). The server accepts the first valid jump-in it processes (race-safe); the play applies its normal effect (skip/reverse/draw2 included) and turn order continues from the jumper's seat. The jumper must respect a pending drawStack like anyone else (no jump-in while a stack awaits resolution... jump-in IS allowed only if the card would be legal as a stack response). Failed jump-ins (too slow, no exact match) get a normal `{ok:false}` ack. Jump-in does not bypass UNO rules: jumping to 1 card opens the usual UNO window.

## Security / ops notes

- `playerId` is a random 16-byte hex token issued at join; needed for rejoin (client stores it in **sessionStorage** keyed by roomCode — tab-scoped, so reloads rejoin the same seat but a second tab can join as a different player).
- Room codes: 6 chars from unambiguous alphabet (no 0/O/1/I), crypto-random.
- Rate limit: per-socket token bucket, e.g. 10 events/sec burst 20; `sendReaction` max 1/sec.
- TLS: server reads `TLS_KEY_PATH`/`TLS_CERT_PATH`; if set serves HTTPS+WSS, else HTTP+WS for local dev. Production recommended behind a TLS-terminating reverse proxy (Caddy/nginx).

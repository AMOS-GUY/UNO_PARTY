/**
 * Smoke test for the UNO Party server.
 *
 * Part 1 (socket level, requires the server running on :3001):
 *   create room → join → start → personalized state → play/draw/pass →
 *   invalid-play rejection → reaction rate limit → rejoin.
 * Part 2 (engine level, deterministic, imported from dist/):
 *   +2 stacking rules, UNO window (call/catch/deadline), reverse-as-skip,
 *   free-draw restriction, win detection.
 *
 * Run: node test/smoke.mjs   (exit code 0 = all passed)
 */
import { io } from 'socket.io-client';
import assert from 'node:assert/strict';

const URL = process.env.SERVER_URL ?? 'http://localhost:3001';

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function track(socket) {
  const t = { state: null, toasts: [], events: [] };
  socket.on('gameState', (s) => (t.state = s));
  socket.on('toast', (m) => t.toasts.push(m));
  for (const ev of ['cardPlayed', 'cardDrawn', 'emojiEffect', 'unoCalled', 'unoCaught', 'gameOver', 'playerPresence']) {
    socket.on(ev, (p) => t.events.push({ ev, p }));
  }
  return t;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitState(t, pred, what, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (t.state && pred(t.state)) return t.state;
    await sleep(25);
  }
  throw new Error(`timeout waiting for state: ${what}`);
}

async function waitToast(tr, kind, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (tr.toasts.some((t) => t.kind === kind)) return;
    await sleep(25);
  }
  throw new Error(`timeout waiting for ${kind} toast`);
}

// Client-side mirror of the legality rule, for choosing valid moves.
function isPlayable(card, state) {
  if (card.color === 'wild') return true;
  if (!state.topCard) return false;
  return card.color === state.activeColor || card.value === state.topCard.value;
}

async function socketTests() {
  console.log('Part 1: socket-level smoke');
  const a = await connect();
  const ta = track(a);

  // --- createRoom ---
  const created = await emitAck(a, 'createRoom', { name: 'Alice' });
  assert.equal(created.ok, true, JSON.stringify(created));
  const { roomCode, playerId: aliceId } = created;
  assert.match(roomCode, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.match(aliceId, /^[0-9a-f]{32}$/);
  check('createRoom acks { roomCode, playerId } with crypto-shaped values', () => {});
  await waitState(ta, (s) => s.phase === 'lobby' && s.players.length === 1, 'lobby state');

  // --- joinRoom ---
  const b = await connect();
  const tb = track(b);
  const joined = await emitAck(b, 'joinRoom', { roomCode, name: 'Bob' });
  assert.equal(joined.ok, true, JSON.stringify(joined));
  const bobId = joined.playerId;
  check('joinRoom ok', () => {});
  await waitState(ta, (s) => s.players.length === 2, 'Alice sees Bob');

  const stLobby = ta.state;
  check('avatars unique, Alice is host', () => {
    assert.equal(new Set(stLobby.players.map((p) => p.avatar)).size, 2);
    const alice = stLobby.players.find((p) => p.id === aliceId);
    assert.equal(alice.isHost, true);
  });
  check('default rules in lobby state (stacking on, others off)', () => {
    assert.deepEqual(stLobby.rules, { stacking: true, sevenZero: false, jumpIn: false });
  });

  // --- updateRules: host only, lobby only ---
  const rulesByBob = await emitAck(b, 'updateRules', { rules: { jumpIn: true } });
  check('updateRules by non-host rejected', () => assert.equal(rulesByBob.ok, false));
  const rulesByAlice = await emitAck(a, 'updateRules', { rules: { jumpIn: true, sevenZero: true } });
  check('updateRules by host ok and broadcast to all', () => {
    assert.equal(rulesByAlice.ok, true);
  });
  await waitState(tb, (s) => s.rules.jumpIn === true, 'Bob sees updated rules');
  check('rules update merges (stacking stays on)', () => {
    assert.deepEqual(tb.state.rules, { stacking: true, sevenZero: true, jumpIn: true });
  });
  // back to defaults for the rest of the socket test
  await emitAck(a, 'updateRules', { rules: { jumpIn: false, sevenZero: false } });
  await waitState(ta, (s) => s.rules.jumpIn === false, 'rules reset');

  // --- join errors ---
  const badJoin = await emitAck(await connect(), 'joinRoom', { roomCode: 'ZZZZZZ', name: 'X' });
  check('joinRoom unknown code rejected', () => assert.equal(badJoin.ok, false));

  // --- startGame: non-host rejected, host ok ---
  const startByBob = await emitAck(b, 'startGame', {});
  check('startGame by non-host rejected', () => assert.equal(startByBob.ok, false));
  const started = await emitAck(a, 'startGame', {});
  assert.equal(started.ok, true, JSON.stringify(started));

  const sA = await waitState(ta, (s) => s.phase === 'playing', 'Alice playing');
  const sB = await waitState(tb, (s) => s.phase === 'playing', 'Bob playing');
  check('both players dealt 7, personalized view', () => {
    assert.equal(sA.myHand.length, 7);
    assert.equal(sB.myHand.length, 7);
    assert.equal(sA.myPlayerId, aliceId);
    assert.equal(sB.myPlayerId, bobId);
    for (const s of [sA, sB]) {
      assert.equal(s.players.length, 2);
      for (const p of s.players) assert.ok([7, 8, 9].includes(p.cardCount)); // 9 if initial draw2 flip
    }
    assert.ok(sA.currentPlayerId);
    assert.equal(sA.deckCount, 1); // ceil(2/4)
    assert.ok(sA.topCard);
  });
  check('no hand leaks: state only contains own cards', () => {
    // GameStateForClient has no field exposing the opponent's hand.
    const raw = JSON.stringify(sA);
    for (const c of sB.myHand) assert.ok(!raw.includes(`"${c.id}"`));
  });
  check('visibleHands is null for active players (spectator-only reveal)', () => {
    assert.equal(sA.visibleHands, null);
    assert.equal(sB.visibleHands, null);
    assert.ok(sA.players.every((p) => p.place === null));
  });

  const rulesMidGame = await emitAck(a, 'updateRules', { rules: { jumpIn: true } });
  check('updateRules mid-game rejected (locked)', () => assert.equal(rulesMidGame.ok, false));
  check('rules carried into playing state', () => {
    assert.deepEqual(sA.rules, { stacking: true, sevenZero: false, jumpIn: false });
  });

  // --- invalid plays rejected ---
  const curIsAlice = sA.currentPlayerId === aliceId;
  const cur = curIsAlice ? [a, ta] : [b, tb];
  const other = curIsAlice ? [b, tb] : [a, ta];

  const bogus = await emitAck(cur[0], 'playCard', { cardId: 'nope-nope' });
  assert.equal(bogus.ok, false);
  await waitToast(cur[1], 'error'); // ack resolves before the toast arrives
  check('playCard unknown card rejected + toast', () => {});
  const otherCard = other[1].state.myHand[0];
  const stolen = await emitAck(cur[0], 'playCard', { cardId: otherCard.id });
  check("playCard with opponent's card rejected", () => assert.equal(stolen.ok, false));
  const outOfTurn = await emitAck(other[0], 'playCard', { cardId: otherCard.id });
  check('out-of-turn play rejected', () => assert.equal(outOfTurn.ok, false));
  const passNoDraw = await emitAck(cur[0], 'passTurn', {});
  check('passTurn before drawing rejected', () => assert.equal(passNoDraw.ok, false));

  // --- free draw: only drawn card may be played, then pass ---
  const drawn = await emitAck(cur[0], 'drawCard', {});
  check('free drawCard ok even with playable cards', () => assert.equal(drawn.ok, true));
  const sCur = await waitState(cur[1], (s) => s.drawableCardId !== null, 'drawableCardId');
  check('drawableCardId set for current player only', () => {
    assert.ok(sCur.myHand.some((c) => c.id === sCur.drawableCardId));
  });
  const otherCardId = sCur.myHand.find((c) => c.id !== sCur.drawableCardId).id;
  const wrongCard = await emitAck(cur[0], 'playCard', { cardId: otherCardId });
  check('playing a non-drawn card after free draw rejected', () => assert.equal(wrongCard.ok, false));
  const secondDraw = await emitAck(cur[0], 'drawCard', {});
  check('second free draw same turn rejected', () => assert.equal(secondDraw.ok, false));

  const drawnCard = sCur.myHand.find((c) => c.id === sCur.drawableCardId);
  if (isPlayable(drawnCard, sCur)) {
    const payload = { cardId: drawnCard.id };
    if (drawnCard.color === 'wild') payload.chosenColor = 'red';
    const played = await emitAck(cur[0], 'playCard', payload);
    check('drawn card playable', () => assert.equal(played.ok, true, JSON.stringify(played)));
  } else {
    const passedAck = await emitAck(cur[0], 'passTurn', {});
    check('passTurn after draw ok', () => assert.equal(passedAck.ok, true));
  }
  await sleep(200); // let the broadcast settle (skip/reverse may keep the turn with 2 players)

  // --- play several legal turns ---
  // The ack resolves before the gameState broadcast arrives, so after every
  // action we wait until BOTH clients' views reflect it before continuing.
  const settlePlay = async (cardId) => {
    await waitState(ta, (s) => s.phase !== 'playing' || s.topCard?.id === cardId, 'play visible to Alice');
    await waitState(tb, (s) => s.phase !== 'playing' || s.topCard?.id === cardId, 'play visible to Bob');
  };
  const settleTurn = async (actorId) => {
    await waitState(ta, (s) => s.phase !== 'playing' || s.currentPlayerId !== actorId, 'turn moved for Alice');
    await waitState(tb, (s) => s.phase !== 'playing' || s.currentPlayerId !== actorId, 'turn moved for Bob');
  };
  let playedCount = 0;
  for (let turn = 0; turn < 6; turn++) {
    const sMeA = ta.state;
    if (!sMeA || sMeA.phase !== 'playing') break;
    const [sock, tr] = sMeA.currentPlayerId === aliceId ? [a, ta] : [b, tb];
    const s = tr.state;
    if (!s || s.currentPlayerId !== s.myPlayerId) { await sleep(50); continue; }
    if (s.drawStack) {
      // try to stack, else eat the penalty
      const stack = s.drawStack;
      const stackCard = s.myHand.find((c) => c.value === stack.kind);
      if (stackCard) {
        const payload = { cardId: stackCard.id };
        if (stackCard.color === 'wild') payload.chosenColor = 'blue';
        const r = await emitAck(sock, 'playCard', payload);
        assert.equal(r.ok, true, JSON.stringify(r));
        playedCount++;
        await settlePlay(stackCard.id);
      } else {
        const r = await emitAck(sock, 'drawCard', {});
        assert.equal(r.ok, true);
        await waitState(tr, (x) => x.phase !== 'playing' || !x.drawStack, 'stack cleared');
        check('drawStack resolved by drawing (auto-pass)', () => {
          assert.ok(tr.events.some((e) => e.ev === 'cardDrawn' && e.p.count === stack.amount));
          assert.ok(tr.events.some((e) => e.ev === 'emojiEffect' && e.p.kind === 'penalty'));
        });
        await settleTurn(s.myPlayerId);
      }
      continue;
    }
    const playable = s.myHand.find((c) => isPlayable(c, s));
    if (playable) {
      const payload = { cardId: playable.id };
      if (playable.color === 'wild') payload.chosenColor = 'green';
      const r = await emitAck(sock, 'playCard', payload);
      assert.equal(r.ok, true, JSON.stringify(r));
      playedCount++;
      await settlePlay(playable.id);
    } else {
      assert.equal((await emitAck(sock, 'drawCard', {})).ok, true);
      const s2 = await waitState(tr, (x) => x.drawableCardId !== null, 'drawable');
      const dc = s2.myHand.find((c) => c.id === s2.drawableCardId);
      if (isPlayable(dc, s2)) {
        const payload = { cardId: dc.id };
        if (dc.color === 'wild') payload.chosenColor = 'yellow';
        assert.equal((await emitAck(sock, 'playCard', payload)).ok, true);
        playedCount++;
        await settlePlay(dc.id);
      } else {
        assert.equal((await emitAck(sock, 'passTurn', {})).ok, true);
        await settleTurn(s.myPlayerId);
      }
    }
    if (ta.state.phase === 'finished') break;
  }
  check(`played ${playedCount} real cards with cardPlayed broadcasts`, () => {
    assert.ok(playedCount >= 1);
    assert.ok(ta.events.some((e) => e.ev === 'cardPlayed'));
    assert.ok(tb.events.some((e) => e.ev === 'cardPlayed'));
  });

  // --- wild requires chosenColor ---
  const latest = ta.state.phase === 'playing' ? ta.state : null;
  if (latest) {
    const [sock, tr] = latest.currentPlayerId === aliceId ? [a, ta] : [b, tb];
    const s = tr.state;
    const wild = s.myHand.find((c) => c.color === 'wild' && isPlayable(c, s) && !s.drawStack);
    if (wild && s.currentPlayerId === s.myPlayerId && !s.drawableCardId) {
      const noColor = await emitAck(sock, 'playCard', { cardId: wild.id });
      check('wild without chosenColor rejected', () => assert.equal(noColor.ok, false));
    }
  }

  // --- reactions: allowed set + rate limit 1/s ---
  const react1 = await emitAck(a, 'sendReaction', { emoji: '🔥' });
  const react2 = await emitAck(a, 'sendReaction', { emoji: '🔥' });
  const reactBad = await emitAck(a, 'sendReaction', { emoji: '💩' });
  check('sendReaction: first ok, second rate-limited, invalid emoji rejected', () => {
    assert.equal(react1.ok, true);
    assert.equal(react2.ok, false);
    assert.equal(reactBad.ok, false);
    assert.ok(tb.events.some((e) => e.ev === 'emojiEffect' && e.p.kind === 'reaction' && e.p.emoji === '🔥'));
  });

  // --- disconnect + rejoin restores seat and hand ---
  const handBefore = tb.state?.myHand?.length;
  const b2 = await connect();
  const tb2 = track(b2);
  b.disconnect();
  await sleep(200);
  const rejoined = await emitAck(b2, 'rejoinRoom', { roomCode, playerId: bobId, name: 'Bob' });
  check('rejoinRoom ok with same playerId', () => {
    assert.equal(rejoined.ok, true);
    assert.equal(rejoined.playerId, bobId);
  });
  const sRe = await waitState(tb2, (s) => s.myPlayerId === bobId, 'rejoined state');
  check('rejoin restores hand and marks presence', () => {
    assert.equal(sRe.myHand.length, handBefore);
    assert.equal(sRe.players.find((p) => p.id === bobId).connected, true);
    assert.ok(ta.events.some((e) => e.ev === 'playerPresence' && e.p.playerId === bobId));
  });

  a.disconnect();
  b2.disconnect();

  // --- createRoom with explicit rules is honored ---
  const h = await connect();
  const th = track(h);
  const created2 = await emitAck(h, 'createRoom', { name: 'Zoe', rules: { sevenZero: true, stacking: false } });
  check('createRoom with rules payload ok', () => assert.equal(created2.ok, true));
  await waitState(th, (s) => s.phase === 'lobby', 'Zoe lobby');
  check('createRoom rules honored (merge over defaults)', () => {
    assert.deepEqual(th.state.rules, { stacking: false, sevenZero: true, jumpIn: false });
  });
  h.disconnect();
}

async function engineTests() {
  console.log('Part 2: engine-level deterministic rules');
  const engine = await import('../dist/game/engine.js');
  const { DEFAULT_RULES } = await import('../dist/shared/protocol.js');

  const mkState = (rules = DEFAULT_RULES, players = ['p1', 'p2']) => {
    const { state } = engine.createGame(
      players.map((id) => ({ id, connected: true })),
      1,
      rules,
    );
    return state;
  };
  const card = (id, color, value) => ({ id, color, value });

  // --- +2 stacking ---
  {
    const s = mkState();
    s.players[0].hand = [card('a', 'red', 'draw2'), card('b', 'red', '5')];
    s.players[1].hand = [card('c', 'blue', '7'), card('d', 'blue', 'draw2')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    let r = engine.playCard(s, 'p1', 'a');
    assert.equal(r.ok, true);
    assert.deepEqual(s.drawStack, { amount: 2, kind: 'draw2' });
    assert.equal(s.players[s.currentIndex].id, 'p2');

    r = engine.playCard(s, 'p2', 'c'); // blue 7 matches nothing AND stack pending
    check('stack pending: non-stack card rejected', () => assert.equal(r.ok, false));
    r = engine.playCard(s, 'p2', 'd'); // stack a draw2
    check('draw2 stacks on draw2 → amount 4', () => {
      assert.equal(r.ok, true);
      assert.deepEqual(s.drawStack, { amount: 4, kind: 'draw2' });
    });
    assert.equal(s.players[s.currentIndex].id, 'p1');
    const before = s.players[0].hand.length;
    r = engine.drawCard(s, 'p1'); // p1 has no draw2 → eats the stack
    check('drawing the stack draws full amount, clears it, passes turn', () => {
      assert.equal(r.ok, true);
      assert.equal(s.players[0].hand.length, before + 4);
      assert.equal(s.drawStack, null);
      assert.equal(s.players[s.currentIndex].id, 'p2');
      assert.ok(r.effects.some((e) => e.type === 'emoji' && e.kind === 'penalty'));
    });
    r = engine.passTurn(s, 'p2');
    check('passTurn without draw rejected after stack resolution', () => assert.equal(r.ok, false));
  }

  // --- wild4 only stacks on wild4 ---
  {
    const s = mkState();
    s.players[0].hand = [card('a', 'wild', 'wild4'), card('b', 'red', '5')];
    s.players[1].hand = [card('c', 'red', 'draw2'), card('d', 'green', '3')];
    s.discardPile = [card('t', 'blue', '2')];
    s.activeColor = 'blue';
    s.currentIndex = 0;
    let r = engine.playCard(s, 'p1', 'a');
    check('wild4 without chosenColor rejected', () => assert.equal(r.ok, false));
    r = engine.playCard(s, 'p1', 'a', 'green');
    assert.equal(r.ok, true);
    assert.equal(s.activeColor, 'green');
    assert.deepEqual(s.drawStack, { amount: 4, kind: 'wild4' });
    r = engine.playCard(s, 'p2', 'c', undefined);
    check('draw2 cannot stack on wild4', () => assert.equal(r.ok, false));
  }

  // --- UNO window: call clears; catch only after deadline ---
  {
    const s = mkState();
    s.players[0].hand = [card('a', 'red', '5'), card('b', 'blue', '6')];
    s.players[1].hand = [card('c', 'green', '1'), card('d', 'green', '2')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    const r = engine.playCard(s, 'p1', 'a');
    assert.equal(r.ok, true);
    check('reaching 1 card opens unoPending with ~3s deadline', () => {
      assert.equal(s.unoPending.playerId, 'p1');
      const dt = s.unoPending.deadline - Date.now();
      assert.ok(dt > 2500 && dt <= 3000);
    });
    let c = engine.catchPlayer(s, 'p2', 'p1');
    check('catch before deadline rejected', () => assert.equal(c.ok, false));
    c = engine.callUno(s, 'p2');
    check('callUno by wrong player rejected', () => assert.equal(c.ok, false));
    c = engine.callUno(s, 'p1');
    check('callUno clears window and sets hasCalledUno', () => {
      assert.equal(c.ok, true);
      assert.equal(s.unoPending, null);
      assert.ok(s.unoCalled.has('p1'));
    });
  }
  {
    const s = mkState();
    s.players[0].hand = [card('a', 'red', '5'), card('b', 'blue', '6')];
    s.players[1].hand = [card('c', 'green', '1'), card('d', 'green', '2')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    engine.playCard(s, 'p1', 'a');
    s.unoPending.deadline = Date.now() - 1; // pretend the window expired
    const handBefore = s.players[0].hand.length;
    const r = engine.catchPlayer(s, 'p1', 'p1');
    check('cannot catch yourself', () => assert.equal(r.ok, false));
    const c = engine.catchPlayer(s, 'p2', 'p1');
    check('catch after deadline: target draws 2, window closes', () => {
      assert.equal(c.ok, true);
      assert.equal(s.players[0].hand.length, handBefore + 2);
      assert.equal(s.unoPending, null);
      assert.ok(c.effects.some((e) => e.type === 'unoCaught' && e.catcherId === 'p2'));
    });
  }

  // --- reverse with exactly 2 players acts as skip ---
  {
    const s = mkState();
    s.players[0].hand = [card('a', 'red', 'reverse'), card('b', 'blue', '6')];
    s.players[1].hand = [card('c', 'green', '1'), card('d', 'green', '2')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    const r = engine.playCard(s, 'p1', 'a');
    check('2-player reverse flips direction and keeps turn (acts as skip)', () => {
      assert.equal(r.ok, true);
      assert.equal(s.direction, -1);
      assert.equal(s.players[s.currentIndex].id, 'p1');
      assert.ok(r.effects.some((e) => e.type === 'emoji' && e.kind === 'reverse'));
    });
  }

  // --- skip jumps one player ---
  {
    const s = mkState();
    s.players[0].hand = [card('a', 'red', 'skip'), card('b', 'blue', '6')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    engine.playCard(s, 'p1', 'a');
    check('skip moves turn past next player (2p → back to self)', () => {
      assert.equal(s.players[s.currentIndex].id, 'p1');
    });
  }

  // --- finishing: places assigned, game ends when one active player remains ---
  {
    const s = mkState();
    s.players[0].hand = [card('a', 'red', '5')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    const r = engine.playCard(s, 'p1', 'a');
    check('2p: playing last card → place 1, other player auto last place, game over', () => {
      assert.equal(r.ok, true);
      assert.equal(s.players[0].place, 1);
      assert.equal(s.players[1].place, 2);
      assert.equal(s.winnerId, 'p1'); // 1st-place player
      assert.equal(s.unoPending, null);
      assert.ok(r.effects.some((e) => e.type === 'gameOver' && e.winnerId === 'p1'));
      assert.ok(r.effects.some((e) => e.type === 'playerFinished' && e.playerId === 'p1' && e.place === 1));
      assert.ok(r.effects.some((e) => e.type === 'playerFinished' && e.playerId === 'p2' && e.place === 2));
    });
    const after = engine.playCard(s, 'p1', 'a');
    check('no actions after game over', () => assert.equal(after.ok, false));
  }

  // --- 3 players: first finisher spectates, game continues, turn skips them ---
  {
    const s = mkState(undefined, ['p1', 'p2', 'p3']);
    s.players[0].hand = [card('a', 'red', '5')];
    s.players[1].hand = [card('b', 'blue', '6'), card('b2', 'green', '6')];
    s.players[2].hand = [card('c', 'green', '1'), card('c2', 'yellow', '2')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    const r = engine.playCard(s, 'p1', 'a');
    check('3p: first finisher gets place 1, game continues', () => {
      assert.equal(r.ok, true);
      assert.equal(s.players[0].place, 1);
      assert.equal(s.winnerId, null);
      assert.equal(s.players[1].place, null);
    });
    check('turn passes to next ACTIVE player (p2), skipping the finisher later', () => {
      assert.equal(s.players[s.currentIndex].id, 'p2');
    });
    // p2 passes the turn to p3, and p3's turn wraps past finished p1 to p2
    engine.drawCard(s, 'p2');
    engine.passTurn(s, 'p2');
    assert.equal(s.players[s.currentIndex].id, 'p3');
    engine.drawCard(s, 'p3');
    engine.passTurn(s, 'p3');
    check('rotation wraps past the finished seat (p3 → p2, never p1)', () => {
      assert.equal(s.players[s.currentIndex].id, 'p2');
    });
  }

  // --- Reverse never resurrects a finished seat ---
  {
    const s = mkState(undefined, ['p1', 'p2', 'p3']);
    s.players[0].hand = []; // pretend p1 already finished
    s.players[0].place = 1;
    s.nextPlace = 2;
    s.players[1].hand = [card('b', 'red', 'reverse'), card('b2', 'blue', '6')];
    s.players[2].hand = [card('c', 'green', '1')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 1; // p2's turn
    s.direction = 1;
    const r = engine.playCard(s, 'p2', 'b');
    check('reverse with 2 active players acts as skip (turn stays on p2)', () => {
      assert.equal(r.ok, true);
      assert.equal(s.direction, -1);
      assert.equal(s.players[s.currentIndex].id, 'p2');
    });
    // now p2 passes to p3 (direction -1 wraps: p2 → p1 seat skipped → p3)
    engine.drawCard(s, 'p2');
    engine.passTurn(s, 'p2');
    check('after reverse, rotation still skips the finished seat', () => {
      assert.equal(s.players[s.currentIndex].id, 'p3');
    });
  }

  // --- pending stack from a finishing player lands on the next ACTIVE player ---
  {
    const s = mkState(undefined, ['p1', 'p2', 'p3']);
    s.players[0].hand = [card('a', 'red', 'draw2')];
    s.players[1].hand = [card('b', 'blue', '6'), card('b2', 'blue', '7')];
    s.players[2].hand = [card('c', 'green', '1'), card('c2', 'green', '2')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    const r = engine.playCard(s, 'p1', 'a');
    check('finisher played draw2: stack pending on next active player', () => {
      assert.equal(r.ok, true);
      assert.equal(s.players[0].place, 1);
      assert.deepEqual(s.drawStack, { amount: 2, kind: 'draw2' });
      assert.equal(s.players[s.currentIndex].id, 'p2');
    });
    const before = s.players[1].hand.length;
    const d = engine.drawCard(s, 'p2');
    check('next active player eats the finisher’s stack', () => {
      assert.equal(d.ok, true);
      assert.equal(s.players[1].hand.length, before + 2);
      assert.equal(s.drawStack, null);
    });
  }

  // --- finished players are out of bounds for house rules and catching ---
  {
    const s = mkState({ stacking: true, sevenZero: true, jumpIn: true }, ['p1', 'p2', 'p3']);
    s.players[0].hand = [];
    s.players[0].place = 1;
    s.nextPlace = 2;
    s.players[1].hand = [card('b', 'red', '7'), card('b2', 'blue', '9')];
    s.players[2].hand = [card('c', 'red', '9'), card('c2', 'green', '2')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 1; // p2's turn
    let r = engine.playCard(s, 'p2', 'b', undefined, 'p1');
    check('7-0: swapping with a finished player rejected', () => assert.equal(r.ok, false));
    r = engine.playCard(s, 'p1', 'nope');
    check('jumpIn: finished player cannot jump in', () => assert.equal(r.ok, false));
    // finished player cannot catch, and cannot be caught
    s.unoPending = { playerId: 'p3', deadline: Date.now() - 1 };
    r = engine.catchPlayer(s, 'p1', 'p3');
    check('spectator cannot use Caught!', () => assert.equal(r.ok, false));
    check('canCatch is false for spectators', () => assert.equal(engine.canCatch(s, 'p1'), false));
    s.unoPending = { playerId: 'p1', deadline: Date.now() - 1 };
    r = engine.catchPlayer(s, 'p2', 'p1');
    check('finished player cannot be caught', () => assert.equal(r.ok, false));
    s.unoPending = null;
  }

  // --- game ends when the second-to-last player finishes ---
  {
    const s = mkState(undefined, ['p1', 'p2', 'p3']);
    s.players[0].hand = [];
    s.players[0].place = 1;
    s.nextPlace = 2;
    s.players[1].hand = [card('b', 'red', '5')];
    s.players[2].hand = [card('c', 'green', '1'), card('c2', 'green', '2')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 1;
    const r = engine.playCard(s, 'p2', 'b');
    check('second-to-last finisher ends the game; last place auto-assigned', () => {
      assert.equal(r.ok, true);
      assert.equal(s.players[1].place, 2);
      assert.equal(s.players[2].place, 3); // last place, cards in hand
      assert.equal(s.winnerId, 'p1');
      assert.ok(r.effects.some((e) => e.type === 'gameOver' && e.winnerId === 'p1'));
    });
  }

  // --- free draw: once per turn, only drawn card playable ---
  {
    const s = mkState();
    s.players[0].hand = [card('a', 'red', '5'), card('b', 'blue', '6')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    let r = engine.drawCard(s, 'p1');
    assert.equal(r.ok, true);
    assert.ok(s.drawableCardId);
    r = engine.playCard(s, 'p1', 'a'); // legal card, but not the drawn one
    check('after free draw only drawn card may be played', () => assert.equal(r.ok, false));
    r = engine.passTurn(s, 'p1');
    check('passTurn after free draw ok and resets restriction', () => {
      assert.equal(r.ok, true);
      assert.equal(s.drawableCardId, null);
      assert.equal(s.players[s.currentIndex].id, 'p2');
    });
  }

  // --- disconnect: current player turn advances without draw ---
  {
    const s = mkState();
    s.currentIndex = 0;
    const handSizes = s.players.map((p) => p.hand.length);
    const changed = engine.handleDisconnect(s, 'p1');
    check('disconnect of current player advances turn, no cards drawn', () => {
      assert.equal(changed, true);
      assert.equal(s.players[s.currentIndex].id, 'p2');
      assert.deepEqual(s.players.map((p) => p.hand.length), handSizes);
      assert.equal(s.players[0].connected, false);
    });
    const back = engine.handleReconnect(s, 'p1');
    check('reconnect flips connected back', () => {
      assert.equal(s.players[0].connected, true);
    });
  }

  // --- house rule: stacking OFF → draw cards apply immediately, victim skipped ---
  {
    const s = mkState({ stacking: false, sevenZero: false, jumpIn: false });
    s.players[0].hand = [card('a', 'red', 'draw2'), card('b', 'red', '5')];
    s.players[1].hand = [card('c', 'blue', '7')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    const before = s.players[1].hand.length;
    const r = engine.playCard(s, 'p1', 'a');
    check('stacking OFF: draw2 deals 2 immediately, no drawStack, victim skipped', () => {
      assert.equal(r.ok, true);
      assert.equal(s.drawStack, null);
      assert.equal(s.players[1].hand.length, before + 2);
      assert.equal(s.players[s.currentIndex].id, 'p1'); // back to p1: p2 skipped
      assert.ok(r.effects.some((e) => e.type === 'cardDrawn' && e.playerId === 'p2' && e.count === 2));
      assert.ok(r.effects.some((e) => e.type === 'emoji' && e.playerId === 'p2' && e.kind === 'penalty'));
    });
    // wild4 immediate +4 with chosenColor
    s.players[0].hand = [card('w', 'wild', 'wild4'), card('w2', 'red', '6')];
    s.discardPile = [card('t2', 'red', '5')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    const before4 = s.players[1].hand.length;
    const r4 = engine.playCard(s, 'p1', 'w', 'blue');
    check('stacking OFF: wild4 deals 4 immediately and sets active color', () => {
      assert.equal(r4.ok, true);
      assert.equal(s.drawStack, null);
      assert.equal(s.players[1].hand.length, before4 + 4);
      assert.equal(s.activeColor, 'blue');
    });
  }

  // --- house rule: sevenZero — 7 swaps hands with a chosen player ---
  {
    const s = mkState({ stacking: true, sevenZero: true, jumpIn: false });
    s.players[0].hand = [card('a', 'red', '7'), card('b', 'red', '5')];
    s.players[1].hand = [card('c', 'blue', '1'), card('d', 'blue', '2'), card('e', 'blue', '3')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    let r = engine.playCard(s, 'p1', 'a');
    check('sevenZero: 7 without swapTargetId rejected', () => assert.equal(r.ok, false));
    r = engine.playCard(s, 'p1', 'a', undefined, 'p1');
    check('sevenZero: swapping with yourself rejected', () => assert.equal(r.ok, false));
    r = engine.playCard(s, 'p1', 'a', undefined, 'nope');
    check('sevenZero: unknown swap target rejected', () => assert.equal(r.ok, false));
    r = engine.playCard(s, 'p1', 'a', undefined, 'p2');
    check('sevenZero: playing a 7 swaps hands with the target', () => {
      assert.equal(r.ok, true);
      assert.deepEqual(s.players[0].hand.map((c) => c.id), ['c', 'd', 'e']);
      assert.deepEqual(s.players[1].hand.map((c) => c.id), ['b']);
      assert.equal(s.players[s.currentIndex].id, 'p2'); // normal turn advance
    });
  }

  // --- house rule: sevenZero — 0 rotates all hands in turn direction ---
  {
    const s = mkState({ stacking: true, sevenZero: true, jumpIn: false }, ['p1', 'p2', 'p3']);
    s.players[0].hand = [card('a', 'red', '0'), card('b', 'red', '5')];
    s.players[1].hand = [card('c', 'blue', '1')];
    s.players[2].hand = [card('d', 'green', '2'), card('e', 'green', '3')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    s.direction = 1;
    const r = engine.playCard(s, 'p1', 'a');
    check('sevenZero: playing a 0 rotates hands one seat in play direction', () => {
      assert.equal(r.ok, true);
      // direction 1: each seat receives the hand of the previous seat
      assert.deepEqual(s.players[0].hand.map((c) => c.id), ['d', 'e']);
      assert.deepEqual(s.players[1].hand.map((c) => c.id), ['b']);
      assert.deepEqual(s.players[2].hand.map((c) => c.id), ['c']);
    });
  }

  // --- house rule: jumpIn — out-of-turn exact match steals the turn ---
  {
    const s = mkState({ stacking: true, sevenZero: false, jumpIn: true }, ['p1', 'p2', 'p3']);
    s.players[0].hand = [card('a', 'blue', '5')];
    s.players[1].hand = [card('b', 'red', '9'), card('x', 'blue', '1')];
    s.players[2].hand = [card('c', 'green', '3')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0; // p1's turn; p2 jumps in
    let r = engine.playCard(s, 'p2', 'x');
    check('jumpIn: out-of-turn non-exact card rejected', () => assert.equal(r.ok, false));
    r = engine.playCard(s, 'p2', 'b');
    check('jumpIn: exact color+value match out of turn is accepted', () => {
      assert.equal(r.ok, true);
      assert.equal(s.players[1].hand.length, 1);
    });
    check('jumpIn: turn continues from the jumper (p2 → p3)', () => {
      assert.equal(s.players[s.currentIndex].id, 'p3');
    });
    // p1's normal turn was stolen — playing now is out of turn
    r = engine.playCard(s, 'p1', 'a');
    check('jumpIn: previous current player lost their turn', () => assert.equal(r.ok, false));
  }
  {
    const s = mkState({ stacking: true, sevenZero: false, jumpIn: false });
    s.players[0].hand = [card('a', 'red', '5')];
    s.players[1].hand = [card('b', 'red', '9')];
    s.discardPile = [card('t', 'red', '9')];
    s.activeColor = 'red';
    s.currentIndex = 0;
    const r = engine.playCard(s, 'p2', 'b');
    check('jumpIn OFF: out-of-turn exact match rejected', () => assert.equal(r.ok, false));
  }

  // --- deck shape ---
  {
    const { buildDeck } = await import('../dist/game/cards.js');
    const deck = buildDeck(1);
    check('standard deck is 108 unique cards', () => {
      assert.equal(deck.length, 108);
      assert.equal(new Set(deck.map((c) => c.id)).size, 108);
      const wilds = deck.filter((c) => c.color === 'wild');
      assert.equal(wilds.filter((c) => c.value === 'wild').length, 4);
      assert.equal(wilds.filter((c) => c.value === 'wild4').length, 4);
      const redOnes = deck.filter((c) => c.color === 'red' && c.value === '1');
      assert.equal(redOnes.length, 2);
    });
  }
}

try {
  await socketTests();
  await engineTests();
} catch (e) {
  console.error('FATAL', e);
  process.exitCode = 1;
}
console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures)' : ''}`);
process.exit(process.exitCode ?? 0);

import { useState, type FormEvent } from 'react';
import { useGame } from '../hooks/useGame';
import { api, loadSession, saveSession, socket } from '../lib/socket';
import type { HouseRules } from '../shared/protocol';
import { PlayerAvatar } from './PlayerAvatar';
import { RuleBadges } from './RuleBadges';

const RULE_OPTIONS: { key: keyof HouseRules; label: string; hint: string }[] = [
  { key: 'stacking', label: '+2/+4 Stacking', hint: 'Stack draw cards and pass the penalty along' },
  { key: 'sevenZero', label: '7-0 Rule', hint: '7 = swap hands with a player, 0 = rotate all hands' },
  { key: 'jumpIn', label: 'Jump-In', hint: 'Play out of turn with an exact matching card' },
];

// Host-only house-rule toggles; changes go to the server immediately and
// echo back via gameState.rules for everyone in the lobby.
function HouseRulesPanel({ rules, isHost }: { rules: HouseRules; isHost: boolean }) {
  const { pushToast } = useGame();

  async function toggle(key: keyof HouseRules) {
    const res = await api.updateRules({ [key]: !rules[key] });
    if (!res.ok) pushToast('error', res.error);
  }

  if (!isHost) {
    return (
      <div className="mb-4 flex items-center justify-center gap-2">
        <span className="text-xs font-semibold text-white/40">House rules:</span>
        <RuleBadges rules={rules} />
        {!rules.stacking && !rules.sevenZero && !rules.jumpIn && (
          <span className="text-xs text-white/40">classic</span>
        )}
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl bg-white/5 border border-white/10 p-4">
      <p className="mb-3 text-center text-sm font-black text-white/80">⚙️ House Rules</p>
      <div className="space-y-2.5">
        {RULE_OPTIONS.map(({ key, label, hint }) => (
          <button
            key={key}
            type="button"
            onClick={() => void toggle(key)}
            aria-pressed={rules[key]}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="block text-sm font-bold text-white/90">{label}</span>
              <span className="block text-[0.7rem] text-white/40">{hint}</span>
            </span>
            <span
              className={[
                'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                rules[key] ? 'bg-green-500' : 'bg-neutral-700',
              ].join(' ')}
            >
              <span
                className={[
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                  rules[key] ? 'left-[1.375rem]' : 'left-0.5',
                ].join(' ')}
              />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Landing: create / join a room, then the pre-game lobby view.
export function Lobby() {
  const { gameState } = useGame();

  if (gameState) {
    return <LobbyRoom />;
  }
  return <Landing />;
}

function Landing() {
  const { pushToast, connected } = useGame();
  const [name, setName] = useState(() => localStorage.getItem('uno-party:name') ?? '');
  const [code, setCode] = useState(
    () => new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '',
  );
  const [busy, setBusy] = useState(false);

  const validName = name.trim().length > 0;

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!validName || busy) return;
    setBusy(true);
    const res = await api.createRoom(name.trim());
    setBusy(false);
    if (!res.ok) {
      pushToast('error', res.error);
      return;
    }
    localStorage.setItem('uno-party:name', name.trim());
    saveSession(res.roomCode, { playerId: res.playerId, name: name.trim() });
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    const roomCode = code.trim().toUpperCase();
    if (!validName || roomCode.length !== 6 || busy) return;
    setBusy(true);
    // If we already have a session for this room, prefer rejoin (reconnect flow).
    const existing = loadSession(roomCode);
    const res = existing
      ? await api.rejoinRoom(roomCode, existing.playerId, existing.name)
      : await api.joinRoom(roomCode, name.trim());
    setBusy(false);
    if (!res.ok) {
      pushToast('error', res.error);
      return;
    }
    localStorage.setItem('uno-party:name', name.trim());
    saveSession(res.roomCode, { playerId: res.playerId, name: name.trim() });
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-green-800 via-green-950 to-black p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-5xl font-black italic tracking-tight drop-shadow-lg">
          <span className="text-red-500">U</span>
          <span className="text-yellow-400">N</span>
          <span className="text-green-500">O</span>{' '}
          <span className="text-blue-500">Party</span>
        </h1>
        <p className="mb-8 text-center text-white/60">🎴 Real-time multiplayer UNO</p>

        <div className="rounded-3xl bg-white/5 p-6 shadow-2xl backdrop-blur border border-white/10 space-y-5">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-white/80">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              placeholder="e.g. Amos"
              className="w-full rounded-xl bg-neutral-900/80 border border-white/15 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-yellow-300/70 focus:ring-2 focus:ring-yellow-300/30"
            />
          </label>

          <form onSubmit={handleCreate}>
            <button
              type="submit"
              disabled={!validName || busy || !connected}
              className="w-full rounded-2xl bg-gradient-to-b from-yellow-400 to-amber-500 py-3.5 text-lg font-black text-neutral-900 shadow-lg shadow-amber-900/40 transition active:scale-95 disabled:opacity-40 disabled:active:scale-100"
            >
              🎉 Create Room
            </button>
          </form>

          <div className="flex items-center gap-3 text-white/40 text-xs font-bold">
            <span className="h-px flex-1 bg-white/15" />
            OR JOIN
            <span className="h-px flex-1 bg-white/15" />
          </div>

          <form onSubmit={handleJoin} className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="CODE"
              inputMode="text"
              autoCapitalize="characters"
              className="w-0 flex-1 rounded-xl bg-neutral-900/80 border border-white/15 px-4 py-3 text-center font-mono text-lg tracking-[0.35em] text-white placeholder-white/30 outline-none focus:border-yellow-300/70 focus:ring-2 focus:ring-yellow-300/30"
            />
            <button
              type="submit"
              disabled={!validName || code.length !== 6 || busy || !connected}
              className="rounded-2xl bg-blue-600 px-5 font-black shadow-lg shadow-blue-950/40 transition active:scale-95 disabled:opacity-40 disabled:active:scale-100"
            >
              Join
            </button>
          </form>

          {!connected && (
            <p className="text-center text-xs text-amber-300/90 animate-pulse">
              Connecting to server…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function LobbyRoom() {
  const { gameState, pushToast, leaveAndReset } = useGame();
  const [starting, setStarting] = useState(false);
  if (!gameState) return null;

  const me = gameState.players.find((p) => p.id === gameState.myPlayerId);
  const isHost = me?.isHost ?? gameState.hostId === gameState.myPlayerId;
  const connectedCount = gameState.players.filter((p) => p.connected).length;
  const canStart = isHost && connectedCount >= 2;

  async function copyCode() {
    if (!gameState) return;
    try {
      await navigator.clipboard.writeText(gameState.roomCode);
      pushToast('info', 'Room code copied!');
    } catch {
      pushToast('info', `Room code: ${gameState.roomCode}`);
    }
  }

  async function handleStart() {
    setStarting(true);
    const res = await api.startGame();
    setStarting(false);
    if (!res.ok) pushToast('error', res.error);
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-green-800 via-green-950 to-black p-6">
      <div className="w-full max-w-md rounded-3xl bg-white/5 p-6 shadow-2xl backdrop-blur border border-white/10">
        <p className="text-center text-sm font-semibold text-white/60">Room code</p>
        <button
          type="button"
          onClick={copyCode}
          className="mx-auto mt-1 mb-5 flex items-center gap-3 rounded-2xl bg-neutral-900/80 border border-white/15 px-6 py-3 font-mono text-4xl font-black tracking-[0.3em] text-yellow-300 transition hover:border-yellow-300/50 active:scale-95"
          title="Copy room code"
        >
          {gameState.roomCode}
          <span className="text-xl">📋</span>
        </button>

        <ul className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {gameState.players.map((p) => (
            <li
              key={p.id}
              className="flex flex-col items-center rounded-2xl bg-white/5 border border-white/10 py-3"
            >
              <PlayerAvatar player={p} isCurrentTurn={false} cardCountBadge={false} />
              {p.id === gameState.myPlayerId && (
                <span className="mt-0.5 text-[0.6rem] font-bold text-yellow-300">YOU</span>
              )}
            </li>
          ))}
        </ul>

        <HouseRulesPanel rules={gameState.rules} isHost={isHost} />

        {isHost ? (
          <button
            type="button"
            onClick={handleStart}
            disabled={!canStart || starting}
            className="w-full rounded-2xl bg-gradient-to-b from-green-500 to-green-700 py-3.5 text-lg font-black shadow-lg shadow-green-950/50 transition active:scale-95 disabled:opacity-40 disabled:active:scale-100"
          >
            {canStart ? '🚀 Start Game' : `Waiting for players… (${connectedCount}/2+)`}
          </button>
        ) : (
          <p className="text-center text-white/70 animate-pulse">
            Waiting for the host to start the game…
          </p>
        )}

        <button
          type="button"
          onClick={() => void leaveAndReset()}
          className="mt-3 w-full rounded-2xl border border-white/15 py-2.5 text-sm font-semibold text-white/60 transition hover:bg-white/5"
        >
          Leave room
        </button>

        {!socket.connected && (
          <p className="mt-3 text-center text-xs text-amber-300/90 animate-pulse">
            Connection lost — reconnecting…
          </p>
        )}
      </div>
    </div>
  );
}

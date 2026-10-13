import { useEffect, useState } from 'react';
import { api } from '../lib/socket';
import { useGame } from '../hooks/useGame';

// UNO! button when I'm on 1 card inside the pending window (with a live
// countdown), or a "Caught!" button when someone else missed their window.
export function UnoButton() {
  const { gameState, pushToast } = useGame();
  const [now, setNow] = useState(() => Date.now());

  const pending = gameState?.unoPending ?? null;
  const active = pending !== null;

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [active]);

  if (!gameState || gameState.phase !== 'playing' || !pending) return null;

  const me = gameState.myPlayerId;
  const remainingMs = pending.deadline - now;

  if (pending.playerId === me && gameState.myHand.length === 1) {
    const seconds = Math.max(0, remainingMs / 1000);
    return (
      <button
        type="button"
        onClick={() => void api.callUno().then((r) => !r.ok && pushToast('error', r.error))}
        className="animate-pulse-glow rounded-full bg-gradient-to-b from-red-500 to-red-700 px-8 py-4 text-2xl font-black tracking-wide shadow-xl transition active:scale-90"
      >
        UNO! <span className="tabular-nums text-lg">{seconds.toFixed(1)}s</span>
      </button>
    );
  }

  if (gameState.canCatch && remainingMs <= 0) {
    const target = gameState.players.find((p) => p.id === pending.playerId);
    return (
      <button
        type="button"
        onClick={() =>
          void api.catchPlayer(pending.playerId).then((r) => !r.ok && pushToast('error', r.error))
        }
        className="animate-pop rounded-full bg-gradient-to-b from-amber-400 to-amber-600 px-8 py-4 text-2xl font-black text-neutral-900 shadow-xl transition active:scale-90"
      >
        Caught {target?.name ?? ''}! 😂
      </button>
    );
  }

  return null;
}

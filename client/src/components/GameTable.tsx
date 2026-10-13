import { useEffect, useState } from 'react';
import { api } from '../lib/socket';
import { canPassTurn } from '../lib/rules';
import { isMuted, setMuted } from '../lib/sound';
import { useGame } from '../hooks/useGame';
import { Opponents } from './Opponents';
import { CenterPiles } from './CenterPiles';
import { MyHand } from './MyHand';
import { UnoButton } from './UnoButton';
import { ReactionBar } from './ReactionBar';
import { RuleBadges } from './RuleBadges';

export function GameTable() {
  const { gameState, unoBanner, pushToast, leaveAndReset, connected } = useGame();
  const [bannerId, setBannerId] = useState<number | null>(null);
  const [muted, setMutedState] = useState(isMuted());

  const myUnoPending =
    !!gameState &&
    gameState.unoPending?.playerId === gameState.myPlayerId &&
    gameState.myHand.length === 1;

  useEffect(() => {
    if (!unoBanner) return;
    // toggle through null so repeat UNO calls restart the animations
    setBannerId(null);
    const raf = requestAnimationFrame(() => setBannerId(unoBanner.id));
    const t = setTimeout(() => setBannerId(null), 1500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [unoBanner]);

  if (!gameState) return null;

  async function handlePass() {
    const res = await api.passTurn();
    if (!res.ok) pushToast('error', res.error);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  }

  return (
    <div
      className={[
        'relative flex h-full flex-col overflow-hidden',
        'bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-green-800 via-green-950 to-black',
        myUnoPending ? 'animate-shake-loop' : '',
        bannerId !== null ? 'animate-screen-shake' : '',
      ].join(' ')}
    >
      {/* header */}
      <header className="z-10 flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-neutral-900/70 border border-white/10 px-3 py-1 font-mono text-xs font-bold tracking-widest text-yellow-300">
            {gameState.roomCode}
          </span>
          <RuleBadges rules={gameState.rules} />
        </div>
        <span className="text-xs text-white/50">
          {gameState.deckCount} deck{gameState.deckCount > 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMute}
            title={muted ? 'Unmute sounds' : 'Mute sounds'}
            className="rounded-full border border-white/15 px-2.5 py-1 text-sm transition hover:bg-white/10 active:scale-95"
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button
            type="button"
            onClick={() => void leaveAndReset()}
            className="rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/60 transition hover:bg-white/10"
          >
            Leave
          </button>
        </div>
      </header>

      {!connected && (
        <p className="z-10 text-center text-xs text-amber-300 animate-pulse">
          Reconnecting…
        </p>
      )}

      {/* table area */}
      <main className="relative flex flex-1 flex-col justify-between min-h-0">
        <Opponents />
        <div className="relative z-10 flex flex-1 items-center justify-center">
          <CenterPiles />
        </div>

        {/* controls above the hand */}
        <div className="relative z-10 flex flex-col items-center gap-2 pb-1">
          <UnoButton />
          {canPassTurn(gameState) && (
            <button
              type="button"
              onClick={handlePass}
              className="rounded-full bg-neutral-800 border border-white/20 px-5 py-2 text-sm font-bold transition hover:bg-neutral-700 active:scale-95"
            >
              Pass turn ➡️
            </button>
          )}
          <ReactionBar />
        </div>

        <div className="relative z-10">
          <MyHand />
        </div>
      </main>

      {/* UNO! banner */}
      {bannerId !== null && unoBanner && (
        <div
          key={bannerId}
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
        >
          <div className="animate-banner text-7xl font-black italic text-red-500 drop-shadow-[0_4px_0_rgba(0,0,0,0.5)]">
            🔊 UNO!
          </div>
        </div>
      )}
    </div>
  );
}

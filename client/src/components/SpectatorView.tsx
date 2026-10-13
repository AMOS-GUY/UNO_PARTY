import { useGame } from '../hooks/useGame';
import { CardView } from './CardView';

// Shown in place of my hand once I've finished: my placement banner plus
// every remaining player's hand face-up (server sends visibleHands only to
// finished players).
export function SpectatorView() {
  const { gameState } = useGame();
  if (!gameState) return null;

  const me = gameState.players.find((p) => p.id === gameState.myPlayerId);
  const hands = gameState.visibleHands ?? {};
  const active = gameState.players.filter((p) => p.place === null);

  return (
    <div className="flex flex-col items-center gap-2 px-4 pb-3">
      <p className="rounded-full bg-gradient-to-b from-yellow-400 to-amber-500 px-5 py-1.5 text-sm font-black text-neutral-900 shadow-lg">
        You finished #{me?.place ?? '?'} 🏆
      </p>
      <p className="text-[0.7rem] font-bold uppercase tracking-widest text-white/50">
        👀 Spectating
      </p>
      <div className="hand-scroll flex w-full justify-center gap-4 overflow-x-auto pt-2">
        {active.map((p) => (
          <div key={p.id} className="flex shrink-0 flex-col items-center gap-1" data-spectate-hand={p.id}>
            <span className="text-xs font-semibold text-white/80">
              {p.avatar} {p.name}
            </span>
            <div className="flex">
              {(hands[p.id] ?? []).map((card, i) => (
                <div key={card.id} className={i > 0 ? '-ml-7' : ''}>
                  <CardView card={card} size="sm" dimmed={false} />
                </div>
              ))}
              {(hands[p.id] ?? []).length === 0 && (
                <span className="text-xs text-white/40">—</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

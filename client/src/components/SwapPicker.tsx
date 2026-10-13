import type { PlayerPublic } from '../shared/protocol';

interface Props {
  players: PlayerPublic[]; // everyone except me
  onPick: (playerId: string) => void;
  onCancel: () => void;
}

// 7-0 house rule: modal for choosing whose hand to swap with after playing a 7.
export function SwapPicker({ players, onPick, onCancel }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="rounded-3xl bg-neutral-900/95 border border-white/15 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-4 text-center text-lg font-black text-white">
          🔀 Swap hands with…
        </p>
        <div className="grid max-h-80 grid-cols-3 gap-3 overflow-y-auto">
          {players.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.id)}
              className="flex w-24 flex-col items-center gap-1 rounded-2xl bg-white/5 border border-white/10 py-3 transition hover:border-yellow-300/60 hover:bg-white/10 active:scale-95"
            >
              <span className="text-3xl">{p.avatar}</span>
              <span className="max-w-full truncate text-xs font-bold text-white/80">
                {p.name}
              </span>
              <span className="text-[0.6rem] text-white/40">{p.cardCount} cards</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full rounded-xl border border-white/15 py-2 text-sm font-semibold text-white/60 transition hover:bg-white/5"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

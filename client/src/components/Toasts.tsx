import { useGame } from '../hooks/useGame';

export function Toasts() {
  const { toasts } = useGame();
  return (
    <div className="pointer-events-none fixed top-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            'animate-pop w-fit max-w-full rounded-xl px-4 py-2 text-sm font-semibold shadow-xl border',
            t.kind === 'error'
              ? 'bg-red-600/95 border-red-300/40 text-white'
              : 'bg-neutral-800/95 border-white/20 text-white',
          ].join(' ')}
          role="status"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

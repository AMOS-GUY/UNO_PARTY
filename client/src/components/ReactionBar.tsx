import { useState } from 'react';
import { REACTION_EMOJIS } from '../shared/protocol';
import { api } from '../lib/socket';

// Quick-reaction bar. Server rate-limits to 1/sec; mirror that client-side.
export function ReactionBar() {
  const [cooldown, setCooldown] = useState(false);

  function send(emoji: string) {
    if (cooldown) return;
    setCooldown(true);
    setTimeout(() => setCooldown(false), 1000);
    void api.sendReaction(emoji);
  }

  return (
    <div className="flex items-center gap-1 rounded-full bg-neutral-900/70 border border-white/10 px-2 py-1 backdrop-blur">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => send(emoji)}
          disabled={cooldown}
          className="rounded-full p-1.5 text-xl transition hover:scale-125 active:scale-95 disabled:opacity-40"
          aria-label={`React ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

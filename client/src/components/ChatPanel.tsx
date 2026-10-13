import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/socket';
import { useGame } from '../hooks/useGame';
import type { ChatMessage } from '../shared/protocol';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Bubble({ msg, isMine }: { msg: ChatMessage; isMine: boolean }) {
  if (msg.kind === 'system') {
    return (
      <p className="py-0.5 text-center text-[0.7rem] italic text-white/40">{msg.text}</p>
    );
  }
  return (
    <div className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
      <span className="mt-0.5 text-xl leading-none">{msg.avatar}</span>
      <div className={`max-w-[75%] ${isMine ? 'text-right' : ''}`}>
        <p className="text-[0.65rem] font-semibold text-white/50">
          {isMine ? 'You' : msg.playerName} · {formatTime(msg.ts)}
        </p>
        <p
          className={[
            'inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm text-left',
            isMine
              ? 'bg-gradient-to-b from-yellow-400 to-amber-500 font-semibold text-neutral-900'
              : 'bg-white/10 text-white/90',
          ].join(' ')}
        >
          {msg.text}
        </p>
      </div>
    </div>
  );
}

// Chat drawer: right side on desktop, slide-up sheet on mobile. Rendered
// whenever we're in a room (lobby, game, spectating).
export function ChatPanel() {
  const { chatMessages, chatOpen, setChatOpen, pushToast, gameState } = useGame();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll only when the user is already near the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !chatOpen) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [chatMessages, chatOpen]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const res = await api.sendChat(text);
    if (!res.ok) {
      pushToast('error', res.error);
      setDraft(text); // restore on rejection
    }
  }

  const myId = gameState?.myPlayerId;

  return (
    <>
      {/* backdrop (mobile) */}
      {chatOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setChatOpen(false)}
        />
      )}

      <div
        data-chat-panel
        className={[
          'fixed z-50 flex flex-col bg-neutral-900/95 border-white/15 shadow-2xl backdrop-blur transition-transform duration-300',
          // mobile: slide-up sheet from the bottom
          'inset-x-0 bottom-0 h-[65vh] rounded-t-3xl border-t',
          // desktop: right-side drawer
          'md:inset-x-auto md:right-0 md:top-0 md:h-full md:w-96 md:rounded-none md:border-t-0 md:border-l',
          chatOpen ? 'translate-y-0 md:translate-x-0' : 'translate-y-full md:translate-y-0 md:translate-x-full',
        ].join(' ')}
        aria-hidden={!chatOpen}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <p className="text-sm font-black text-white/80">💬 Room chat</p>
          <button
            type="button"
            onClick={() => setChatOpen(false)}
            className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-white/60 hover:bg-white/10"
          >
            Close ✕
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
          {chatMessages.length === 0 && (
            <p className="pt-8 text-center text-xs text-white/30">
              No messages yet — say hi! 👋
            </p>
          )}
          {chatMessages.map((m) => (
            <Bubble key={m.id} msg={m} isMine={m.playerId !== null && m.playerId === myId} />
          ))}
        </div>

        <form onSubmit={send} className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 200))}
              placeholder="Type a message…"
              maxLength={200}
              enterKeyHint="send"
              className="min-w-0 flex-1 rounded-xl bg-neutral-800 border border-white/15 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-yellow-300/70"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="rounded-xl bg-yellow-400 px-4 py-2.5 text-sm font-black text-neutral-900 transition active:scale-95 disabled:opacity-40"
            >
              Send
            </button>
          </div>
          {draft.length >= 180 && (
            <p className="mt-1 text-right text-[0.65rem] font-semibold text-amber-300 tabular-nums">
              {draft.length}/200
            </p>
          )}
        </form>
      </div>
    </>
  );
}

// 💬 toggle for headers, with an unread badge when the panel is closed.
export function ChatToggle() {
  const { unreadChat, chatOpen, setChatOpen } = useGame();
  return (
    <button
      type="button"
      onClick={() => setChatOpen(!chatOpen)}
      title="Room chat"
      className="relative rounded-full border border-white/15 px-2.5 py-1 text-sm transition hover:bg-white/10 active:scale-95"
    >
      💬
      {!chatOpen && unreadChat > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-4 rounded-full bg-red-600 px-1 text-center text-[0.6rem] font-black leading-4 text-white">
          {unreadChat > 99 ? '99+' : unreadChat}
        </span>
      )}
    </button>
  );
}

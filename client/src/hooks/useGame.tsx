import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  CardPlayedEvent,
  CardDrawnEvent,
  Color,
  EmojiEffectEvent,
  GameOverEvent,
  GameStateForClient,
  PlayerPresenceEvent,
  ToastEvent,
  UnoCalledEvent,
  UnoCaughtEvent,
} from '../shared/protocol';
import {
  api,
  clearCurrentRoom,
  clearSession,
  getCurrentRoom,
  loadSession,
  saveSession,
  setCurrentRoom,
  socket,
} from '../lib/socket';
import { initSoundUnlock, playSound } from '../lib/sound';
import { fireFinish } from '../lib/celebrate';

export interface Toast extends ToastEvent {
  id: number;
}

export interface EmojiEffect extends EmojiEffectEvent {
  id: number;
}

export interface FlyingCard {
  id: number;
  event: CardPlayedEvent;
}

interface GameContextValue {
  connected: boolean;
  gameState: GameStateForClient | null;
  toasts: Toast[];
  /** latest emoji effect per playerId, floats over their avatar */
  effects: Record<string, EmojiEffect>;
  /** incremented to retrigger the full-screen shake + UNO banner */
  unoBanner: (UnoCalledEvent & { id: number }) | null;
  gameOver: (GameOverEvent & { id: number }) | null;
  flyingCard: FlyingCard | null;
  drawnPulse: (CardDrawnEvent & { id: number }) | null;
  /** card currently shaking after a rejected play */
  shakingCardId: string | null;
  pushToast: (kind: ToastEvent['kind'], message: string) => void;
  playCard: (
    cardId: string,
    chosenColor?: Color,
    swapTargetId?: string,
    opts?: { quiet?: boolean },
  ) => Promise<boolean>;
  leaveAndReset: () => Promise<void>;
}

const GameContext = createContext<GameContextValue | null>(null);

let nextId = 1;

export function GameProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(socket.connected);
  const [gameState, setGameState] = useState<GameStateForClient | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [effects, setEffects] = useState<Record<string, EmojiEffect>>({});
  const [unoBanner, setUnoBanner] = useState<GameContextValue['unoBanner']>(null);
  const [gameOver, setGameOver] = useState<GameContextValue['gameOver']>(null);
  const [flyingCard, setFlyingCard] = useState<FlyingCard | null>(null);
  const [drawnPulse, setDrawnPulse] = useState<GameContextValue['drawnPulse']>(null);
  const [shakingCardId, setShakingCardId] = useState<string | null>(null);

  const lastAttemptedCardId = useRef<string | null>(null);
  const roomCodeRef = useRef<string | null>(null);
  const gameStateRef = useRef<GameStateForClient | null>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    roomCodeRef.current = gameState?.roomCode ?? roomCodeRef.current;
    gameStateRef.current = gameState;
  }, [gameState]);

  const pushToast = useCallback((kind: ToastEvent['kind'], message: string) => {
    const id = nextId++;
    setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const shakeCard = useCallback((cardId: string | null) => {
    if (!cardId) return;
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    setShakingCardId(cardId);
    shakeTimer.current = setTimeout(() => setShakingCardId(null), 600);
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      // Reconnect flow: if we hold a session for the current room, rejoin silently.
      // After a full page reload the ref is empty, so fall back to the
      // tab-scoped current-room pointer.
      const code = roomCodeRef.current ?? getCurrentRoom();
      if (code) {
        const session = loadSession(code);
        if (session) {
          void api.rejoinRoom(code, session.playerId, session.name).then((res) => {
            if (!res.ok) {
              clearSession(code);
              clearCurrentRoom();
              pushToast('error', res.error);
            }
          });
        }
      }
    };
    const onDisconnect = () => setConnected(false);
    const onGameState = (state: GameStateForClient) => {
      // Celebrate my own finish exactly once (place transitions null → N).
      const prevMe = gameStateRef.current?.players.find((p) => p.id === state.myPlayerId);
      const nextMe = state.players.find((p) => p.id === state.myPlayerId);
      if (prevMe && prevMe.place === null && nextMe && nextMe.place !== null) {
        fireFinish();
        playSound('fanfare');
      }
      // Play Again resets the room to the lobby — drop any podium overlay.
      if (state.phase === 'lobby') setGameOver(null);
      setGameState(state);
    };
    const onToast = (t: ToastEvent) => {
      pushToast(t.kind, t.message);
      // Protocol: error toasts imply shaking the last attempted card.
      if (t.kind === 'error') shakeCard(lastAttemptedCardId.current);
    };
    const onCardPlayed = (e: CardPlayedEvent) => {
      playSound('whoosh');
      setFlyingCard({ id: nextId++, event: e });
      setTimeout(() => setFlyingCard((f) => (f ? null : f)), 500);
    };
    const onCardDrawn = (e: CardDrawnEvent) => {
      playSound('click');
      setDrawnPulse({ ...e, id: nextId++ });
      setTimeout(() => setDrawnPulse(null), 700);
    };
    const onEmojiEffect = (e: EmojiEffectEvent) => {
      // Laugh along with the 😂 penalty emoji.
      if (e.kind === 'penalty') playSound('laugh');
      const eff = { ...e, id: nextId++ };
      setEffects((prev) => ({ ...prev, [e.playerId]: eff }));
      setTimeout(() => {
        setEffects((prev) => {
          if (prev[e.playerId]?.id !== eff.id) return prev;
          const next = { ...prev };
          delete next[e.playerId];
          return next;
        });
      }, 2100);
    };
    const onUnoCalled = (e: UnoCalledEvent) => {
      playSound('drumroll');
      setUnoBanner({ ...e, id: nextId++ });
    };
    const onUnoCaught = (e: UnoCaughtEvent) => {
      const target = gameStateRef.current?.players.find((p) => p.id === e.targetId);
      if (target) pushToast('info', `${target.name} was caught! +2 cards 😂`);
    };
    const onGameOver = (e: GameOverEvent) => {
      playSound('fanfare');
      setGameOver({ ...e, id: nextId++ });
    };
    const onPresence = (_e: PlayerPresenceEvent) => {
      // gameState follows every state change; presence is also reflected there.
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('gameState', onGameState);
    socket.on('toast', onToast);
    socket.on('cardPlayed', onCardPlayed);
    socket.on('cardDrawn', onCardDrawn);
    socket.on('emojiEffect', onEmojiEffect);
    socket.on('unoCalled', onUnoCalled);
    socket.on('unoCaught', onUnoCaught);
    socket.on('gameOver', onGameOver);
    socket.on('playerPresence', onPresence);

    // Cold-load rejoin: ?room=CODE deep link or prior session restored by App.
    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('gameState', onGameState);
      socket.off('toast', onToast);
      socket.off('cardPlayed', onCardPlayed);
      socket.off('cardDrawn', onCardDrawn);
      socket.off('emojiEffect', onEmojiEffect);
      socket.off('unoCalled', onUnoCalled);
      socket.off('unoCaught', onUnoCaught);
      socket.off('gameOver', onGameOver);
      socket.off('playerPresence', onPresence);
    };
  }, [pushToast, shakeCard]);

  useEffect(() => {
    initSoundUnlock();
  }, []);

  const playCard = useCallback(
    async (
      cardId: string,
      chosenColor?: Color,
      swapTargetId?: string,
      opts?: { quiet?: boolean },
    ): Promise<boolean> => {
      if (!opts?.quiet) lastAttemptedCardId.current = cardId;
      const res = await api.playCard(cardId, { chosenColor, swapTargetId });
      if (!res.ok) {
        // Quiet mode (jump-in attempts): the server rejected the race — no
        // toast, no shake, the gameState echo already reflects reality.
        if (opts?.quiet) return false;
        pushToast('error', res.error);
        shakeCard(cardId);
        return false;
      }
      return true;
    },
    [pushToast, shakeCard],
  );

  const leaveAndReset = useCallback(async () => {
    await api.leaveRoom();
    if (roomCodeRef.current) clearSession(roomCodeRef.current);
    clearCurrentRoom();
    roomCodeRef.current = null;
    setGameState(null);
    setGameOver(null);
    setUnoBanner(null);
    setEffects({});
    setFlyingCard(null);
  }, []);

  // Persist session whenever we learn our identity in a room.
  useEffect(() => {
    if (gameState) {
      const me = gameState.players.find((p) => p.id === gameState.myPlayerId);
      if (me) {
        saveSession(gameState.roomCode, { playerId: me.id, name: me.name });
        setCurrentRoom(gameState.roomCode);
      }
    }
  }, [gameState]);

  const value: GameContextValue = {
    connected,
    gameState,
    toasts,
    effects,
    unoBanner,
    gameOver,
    flyingCard,
    drawnPulse,
    shakingCardId,
    pushToast,
    playCard,
    leaveAndReset,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside <GameProvider>');
  return ctx;
}

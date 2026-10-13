import { GameProvider, useGame } from './hooks/useGame';
import { Lobby } from './components/Lobby';
import { GameTable } from './components/GameTable';
import { WinnerScreen } from './components/WinnerScreen';
import { ChatPanel } from './components/ChatPanel';
import { Toasts } from './components/Toasts';

function Root() {
  const { gameState, gameOver } = useGame();
  const inRoom = gameState !== null;
  const inGame = inRoom && gameState.phase !== 'lobby';

  return (
    <div className="h-full">
      {inGame ? <GameTable /> : <Lobby />}
      {inRoom && <ChatPanel />}
      {gameOver && <WinnerScreen />}
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <GameProvider>
      <Root />
    </GameProvider>
  );
}

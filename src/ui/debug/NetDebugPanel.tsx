// 开发者联机调试面板（开发模式自动显示；正式环境在网址后加 ?debug=1 才显示）
import { useGame } from '../../store/gameStore';
import { serverWsUrl } from '../../net/serverAddress';

const enabled = import.meta.env.DEV || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug'));

export function NetDebugPanel() {
  const conn = useGame((s) => s.conn);
  const room = useGame((s) => s.room);
  const playerId = useGame((s) => s.playerId);
  const latency = useGame((s) => s.latency);
  const view = useGame((s) => s.view);
  if (!enabled) return null;
  const humans = room?.members.filter((m) => !m.isAI) ?? [];
  const rows: [string, string][] = [
    ['Connection', conn === 'connected' ? 'Connected' : conn === 'connecting' ? 'Connecting' : conn === 'disconnected' ? 'Disconnected' : 'Idle'],
    ['Server', serverWsUrl()],
    ['Room', room ? `${room.code}${room.solo ? ' (solo)' : ''}` : '—'],
    ['Status', room?.status ?? '—'],
    ['Player ID', playerId ?? '—'],
    ['Players', room ? `${room.members.length} / ${room.settings.maxPlayers} (${humans.filter((m) => m.connected).length} humans online)` : '—'],
    ['Host', room ? (room.hostId === playerId ? 'Yes' : 'No') : '—'],
    ['Hand', view ? `#${view.handNumber} ${view.phase}` : '—'],
    ['Latency', latency !== null ? `${latency}ms` : '—'],
  ];
  return (
    <div className="net-debug" aria-hidden>
      {rows.map(([k, v]) => (
        <div key={k}>
          <b>{k}:</b> {v}
        </div>
      ))}
    </div>
  );
}

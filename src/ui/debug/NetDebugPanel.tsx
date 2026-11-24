// 开发者联机调试面板：网址后加 ?debug=1 才显示（开发模式也一样，避免挡住游戏界面）
import { useGame } from '../../store/gameStore';
import { serverWsUrl } from '../../net/serverAddress';
import { useEffect, useState } from 'react';
import { sound } from '../../audio/sound';
import { voice } from '../../audio/voice';
import { useSettings } from '../../store/settingsStore';

const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

export function NetDebugPanel() {
  const conn = useGame((s) => s.conn);
  const room = useGame((s) => s.room);
  const playerId = useGame((s) => s.playerId);
  const latency = useGame((s) => s.latency);
  const view = useGame((s) => s.view);
  const st = useSettings();
  // 音频状态不在 React 状态里：调试面板打开时每秒刷新一次
  const [, tick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!enabled) return null;
  const a = sound.debugInfo();
  const pct = (v: number) => `${Math.round(v * 100)}%`;
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
    ['Audio', `${a.status.toUpperCase()} (contexts: ${a.contexts})`],
    ['Context', a.context],
    ['Volumes', `music ${pct(st.musicVolume)} · sfx ${pct(st.sfxVolume)} · ambient ${pct(st.ambientVolume)} · voice ${st.voiceEnabled ? pct(st.voiceVolume) : 'off'}`],
    ['Muted', st.muted ? 'Yes' : 'No'],
    ['BGM', a.bgm ? 'playing' : 'stopped'],
    ['Active Sources', `${a.activeSources}${a.dropped ? ` (dropped ${a.dropped})` : ''}`],
    ['Active Voices', String(voice.activeVoices)],
    ['Audio Unlocked', sound.everReady ? 'Yes' : 'No'],
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

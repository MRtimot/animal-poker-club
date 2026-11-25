// 开发者联机调试面板：网址后加 ?debug=1 才显示（开发模式也一样，避免挡住游戏界面）
import { useGame } from '../../store/gameStore';
import { serverWsUrl } from '../../net/serverAddress';
import { useEffect, useState } from 'react';
import { sound } from '../../audio/sound';
import { voice } from '../../audio/voice';
import { useSettings } from '../../store/settingsStore';
import { useBjCine } from '../../animation/blackjack/cineStore';
import type { ForcedOutcome } from '../../core/blackjack/debug';
import { debugForce } from '../../net/localBlackjack';

/** 强制结果（只在开发模式、本地 21 点的下注阶段）：正式构建里整段会被移除 */
const FORCE: readonly (readonly [ForcedOutcome, string])[] = import.meta.env.DEV
  ? [
      ['blackjack', 'Force Blackjack'],
      ['bust', 'Force Bust'],
      ['push', 'Force Push'],
      ['dealer-blackjack', 'Force Dealer Blackjack'],
      ['win', 'Force Win'],
      ['loss', 'Force Loss'],
      ['split', 'Force Split'],
      ['resplit', 'Force Re-split'],
    ]
  : [];

async function force(kind: ForcedOutcome) {
  if (!import.meta.env.DEV) return;
  useGame.getState().toast(await debugForce(kind), 'info');
}

const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

export function NetDebugPanel() {
  const conn = useGame((s) => s.conn);
  const room = useGame((s) => s.room);
  const playerId = useGame((s) => s.playerId);
  const latency = useGame((s) => s.latency);
  const view = useGame((s) => s.view);
  const bj = useGame((s) => s.bj);
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
  if (bj) {
    const me = bj.players.find((p) => p.id === bj.viewerId);
    const hand = me?.hands.find((h) => h.id === bj.currentHandId) ?? me?.hands[0];
    const cine = useBjCine.getState();
    rows.push(
      ['Mode', `BLACKJACK 21 (${bj.economy}${bj.solo ? ', solo' : ''})`],
      ['Round', `#${bj.round} ${bj.roundId}`],
      ['Phase', bj.phase],
      ['Dealer', `${bj.dealer.value}${bj.dealer.revealed ? '' : ' (hole hidden)'}`],
      ['Player', hand ? `${hand.value}${hand.soft ? ' soft' : ''}${hand.bust ? ' BUST' : ''}${hand.blackjack ? ' BJ' : ''}` : '—'],
      ['Bet / Balance', `${me?.hands.reduce((s, h) => s + h.bet, 0) || me?.bet || 0} / ${me?.balance ?? '—'}`],
      ['Turn', bj.currentPlayerId ?? '—'],
      ['Legal', bj.legal ? (['hit', 'stand', 'double', 'split'] as const).filter((k) => bj.legal![k]).join(' ') : '—'],
      ['Token', String(bj.token)],
      ['Shoe', `${bj.shoe.remaining}/${bj.shoe.size}`],
      ['Cinematic', cine.cine ? `${cine.cine.outcome} · ${cine.cine.phase}` : cine.paidRound === bj.roundId ? 'paid' : 'idle'],
    );
  }
  return (
    <div className="net-debug" aria-hidden>
      {rows.map(([k, v]) => (
        <div key={k}>
          <b>{k}:</b> {v}
        </div>
      ))}
      {import.meta.env.DEV && bj?.phase === 'betting' && !room && (
        <div className="net-debug-force">
          {FORCE.map(([kind, label]) => (
            <button key={kind} type="button" tabIndex={-1} onClick={() => void force(kind)}>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

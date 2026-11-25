// 21 点设置（扑克大厅）：牌桌限额、庄家、同桌动物 → 入座。登录玩家在服务器上开局（押账号的虚拟筹码），游客在本机开局（押本机金币）
import { useRef, useState } from 'react';
import type { AIPersonality } from '../../core/ai/ai';
import { PERSONALITIES } from '../../core/ai/ai';
import { DEALERS, type DealerChoice } from '../../core/blackjack/dealers';
import { REFILL_CHIPS, TABLE_TIERS } from '../../core/blackjack/rules';
import { blackjackWinRate } from '../../progress/blackjackStats';
import { SPECIES_MAP } from '../../core/player/profile';
import { BLIND_OPTIONS, CHIP_OPTIONS } from '../../core/protocol';
import { startLocalBlackjack } from '../../net/localBlackjack';
import { net } from '../../net/netClient';
import { useAccount } from '../../store/accountStore';
import { useGame } from '../../store/gameStore';
import { useProfile } from '../../store/profileStore';
import { enterOnEntryGesture } from '../../display/fullscreen';
import { formatChips } from '../../utils/format';
import { Btn, Seg } from '../common/ui';
import { BlackjackRulesModal } from './BlackjackRules';

const COMPANIONS: AIPersonality[] = ['luckyRabbit', 'aggressiveFox', 'cautiousPanda'];

export function BlackjackSetup() {
  const setScreen = useGame((s) => s.setScreen);
  const toast = useGame((s) => s.toast);
  const set = useGame((s) => s.set);
  const chips = useProfile((s) => s.chips);
  const stats = useProfile((s) => s.stats.blackjack);
  const signedIn = useAccount((s) => s.status === 'signedIn');
  const cached = useAccount((s) => s.cached);
  const [tier, setTier] = useState<string>('low');
  const [dealer, setDealer] = useState<DealerChoice>('auto');
  const [mates, setMates] = useState(1);
  const [starting, setStarting] = useState(false);
  const [rules, setRules] = useState(false);
  const lock = useRef(false);
  const t = TABLE_TIERS.find((x) => x.id === tier) ?? TABLE_TIERS[0];
  const d = dealer === 'auto' ? null : DEALERS.find((x) => x.species === dealer);

  const start = async () => {
    if (lock.current) return;
    lock.current = true;
    enterOnEntryGesture();
    const companions = COMPANIONS.slice(0, mates);
    try {
      if (signedIn && !cached) {
        setStarting(true);
        const ok = await net.startSolo({
          opponents: companions.map((personality) => ({ personality, difficulty: 'normal' as const })),
          startingChips: CHIP_OPTIONS[0],
          smallBlind: BLIND_OPTIONS[0][0],
          bigBlind: BLIND_OPTIONS[0][1],
          blackjack: { dealer, tier },
        });
        setStarting(false);
        if (ok) return;
        if (useGame.getState().screen !== 'quick') return;
        toast('服务器暂时无法同步你的资料。本局为练习桌，不影响账号筹码。', 'error');
      }
      startLocalBlackjack({ dealer, tier, companions });
      setScreen('game');
    } finally {
      setStarting(false);
      lock.current = false;
    }
  };

  return (
    <div className="mode-card bj-setup">
      <div className="bj-setup-head">
        <span className="bj-setup-suit" aria-hidden>
          ♠
        </span>
        <div className="grow">
          <h3>BLACKJACK 21</h3>
          <div className="small muted">读懂庄家，打好手牌，别超过 21。</div>
        </div>
        <button type="button" className="bj-link" onClick={() => setRules(true)}>
          规则
        </button>
      </div>
      <div className="bj-purse">
        <span>{signedIn ? '我的虚拟筹码' : '我的金币'}</span>
        <b>🪙 {formatChips(chips)}</b>
      </div>
      <div className="field">
        <label>牌桌</label>
        <Seg options={TABLE_TIERS.map((x) => ({ value: x.id, label: `${x.name} ${x.minBet}–${formatChips(x.maxBet)}` }))} value={tier} onChange={setTier} />
        {chips < t.minBet && (
          <div className="small err-text" style={{ marginTop: 6 }}>
            金币不够这张桌的最低下注（{t.minBet}）。入座后可以领取俱乐部补给（{REFILL_CHIPS}，免费的虚拟金币）。
          </div>
        )}
      </div>
      <div className="field">
        <label>庄家</label>
        <div className="bj-dealers">
          <button type="button" className={dealer === 'auto' ? 'on' : ''} aria-pressed={dealer === 'auto'} onClick={() => setDealer('auto')}>
            <span aria-hidden>🎲</span>
            随机
          </button>
          {DEALERS.map((x) => (
            <button key={x.species} type="button" className={dealer === x.species ? 'on' : ''} aria-pressed={dealer === x.species} onClick={() => setDealer(x.species)} title={x.trait}>
              <span aria-hidden>{SPECIES_MAP[x.species].emoji}</span>
              {x.name}
            </button>
          ))}
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          {d ? d.trait : '随机一位庄家'} · 性格只影响台词和动作，不影响牌。
        </div>
      </div>
      <div className="field">
        <label>同桌动物</label>
        <Seg options={[0, 1, 2, 3].map((n) => ({ value: n, label: n === 0 ? '只有我' : `${n} 位` }))} value={mates} onChange={setMates} />
        {mates > 0 && (
          <div className="small muted" style={{ marginTop: 6 }}>
            {COMPANIONS.slice(0, mates)
              .map((p) => PERSONALITIES[p].name)
              .join('、')}
            ：各自和庄家对局，不影响你的结果。
          </div>
        )}
      </div>
      <Btn kind="pink" size="lg" block onClick={start} disabled={starting}>
        {starting ? '正在入座……' : '♠ PLAY BLACKJACK'}
      </Btn>
      <div className="bj-mini-stats" aria-label="21 点战绩">
        <span>
          <b>{stats.rounds}</b>局
        </span>
        <span>
          <b>{stats.wins}</b>胜
        </span>
        <span>
          <b>{stats.blackjacks}</b>黑杰克
        </span>
        <span>
          <b>{blackjackWinRate(stats)}</b>胜率
        </span>
      </div>
      <button
        type="button"
        className="bj-link"
        onClick={() => {
          set({ onlineTab: 'create' });
          setScreen('online');
        }}
      >
        和朋友开一桌在线 21 点 →
      </button>
      {rules && <BlackjackRulesModal rules={undefined} onClose={() => setRules(false)} />}
    </div>
  );
}

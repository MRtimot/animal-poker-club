// 百家乐设置（扑克大厅）：牌桌限额、动物庄家、同桌动物、外观 → 入座。登录玩家在服务器上开局（押账号的虚拟筹码），游客在本机开局（押本机金币）
import { REFILLS_PER_DAY } from '../../core/refill';
import { useRef, useState } from 'react';
import type { AIPersonality } from '../../core/ai/ai';
import { PERSONALITIES } from '../../core/ai/ai';
import { DEALERS, type DealerChoice } from '../../core/character/dealers';
import { BAC_TIERS } from '../../core/baccarat/rules';
import { REFILL_CHIPS } from '../../core/blackjack/rules';
import { baccaratRates } from '../../progress/baccaratStats';
import { SPECIES_MAP } from '../../core/player/profile';
import { BLIND_OPTIONS, CHIP_OPTIONS } from '../../core/protocol';
import { startLocalBaccarat } from '../../net/localBaccarat';
import { net } from '../../net/netClient';
import { useAccount } from '../../store/accountStore';
import { useGame } from '../../store/gameStore';
import { useProfile } from '../../store/profileStore';
import { enterOnEntryGesture } from '../../display/fullscreen';
import { formatChips } from '../../utils/format';
import { Btn, Seg } from '../common/ui';
import { BaccaratRulesModal } from './BaccaratRules';
import { BacCosmetics } from './Cosmetics';

const COMPANIONS: AIPersonality[] = ['smartCat', 'crazyFrog', 'aggressiveFox'];

export function BaccaratSetup() {
  const setScreen = useGame((s) => s.setScreen);
  const toast = useGame((s) => s.toast);
  const set = useGame((s) => s.set);
  const chips = useProfile((s) => s.chips);
  const stats = useProfile((s) => s.stats.baccarat);
  const signedIn = useAccount((s) => s.status === 'signedIn');
  const cached = useAccount((s) => s.cached);
  const [tier, setTier] = useState<string>('low');
  const [dealer, setDealer] = useState<DealerChoice>('auto');
  const [mates, setMates] = useState(2);
  const [starting, setStarting] = useState(false);
  const [rules, setRules] = useState(false);
  const [look, setLook] = useState(false);
  const lock = useRef(false);
  const t = BAC_TIERS.find((x) => x.id === tier) ?? BAC_TIERS[0];
  const d = dealer === 'auto' ? null : DEALERS.find((x) => x.species === dealer);
  const r = baccaratRates(stats);

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
          baccarat: { dealer, tier },
        });
        setStarting(false);
        if (ok) return;
        if (useGame.getState().screen !== 'quick') return;
        toast('服务器暂时无法同步你的资料。本局为练习桌，不影响账号筹码。', 'error');
      }
      startLocalBaccarat({ dealer, tier, companions });
      setScreen('game');
    } finally {
      setStarting(false);
      lock.current = false;
    }
  };

  return (
    <div className="mode-card bj-setup bac-setup">
      <div className="bj-setup-head">
        <span className="bj-setup-suit bac-suit" aria-hidden>
          ♦
        </span>
        <div className="grow">
          <h3>BACCARAT</h3>
          <div className="small muted">经典 Punto Banco · 闲与庄，谁更接近 9。</div>
          <div className="mode-virtual"><span>VIRTUAL GAME · PLAYER vs BANKER</span> · <span>仅限虚拟金币 · 不涉及真钱赌博</span></div>
        </div>
        <button type="button" className="bj-link" onClick={() => setRules(true)}>
          规则
        </button>
      </div>
      <div className="bac-odds" aria-label="赔率">
        <span>
          <b>闲</b> 1:1
        </span>
        <span>
          <b>庄</b> 1:1 · 抽 5%
        </span>
        <span>
          <b>和</b> 8:1
        </span>
      </div>
      <div className="bj-purse">
        <span>{signedIn ? '我的虚拟筹码' : '我的金币'}</span>
        <b>🪙 {formatChips(chips)}</b>
      </div>
      <div className="field">
        <label>牌桌（每个区的限额）</label>
        <Seg options={BAC_TIERS.map((x) => ({ value: x.id, label: `${x.name} ${x.minBet}–${formatChips(x.maxBet)}` }))} value={tier} onChange={setTier} />
        {chips < t.minBet && (
          <div className="small err-text" style={{ marginTop: 6 }}>
            金币不够这张桌的最低下注（{t.minBet}）。入座后可以领取俱乐部补给（{REFILL_CHIPS}，免费的虚拟金币，每天 {REFILLS_PER_DAY} 次）。
          </div>
        )}
      </div>
      <div className="field">
        <label>动物庄家</label>
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
            ：同一副牌、同一个结果，各自下注。
          </div>
        )}
      </div>
      <div className="field">
        <button type="button" className="bj-link" onClick={() => setLook((x) => !x)} aria-expanded={look}>
          🎨 牌桌外观 {look ? '▲' : '▼'}
        </button>
        {look && <BacCosmetics />}
      </div>
      <Btn kind="pink" size="lg" block onClick={start} disabled={starting}>
        {starting ? '正在入座……' : '♦ PLAY BACCARAT'}
      </Btn>
      <div className="bj-mini-stats" aria-label="百家乐战绩">
        <span>
          <b>{stats.rounds}</b>局
        </span>
        <span>
          <b>{r.winRate}</b>胜率
        </span>
        <span>
          <b>{stats.tieBetWins}</b>押中和
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
        和朋友开一桌在线百家乐 →
      </button>
      {rules && <BaccaratRulesModal onClose={() => setRules(false)} />}
    </div>
  );
}

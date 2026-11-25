import { useRef, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { useProfile } from '../../store/profileStore';
import { AIDifficulty, AIPersonality, DIFFICULTY_NAME, PERSONALITIES } from '../../core/ai/ai';
import { BLIND_OPTIONS, CHIP_OPTIONS } from '../../core/protocol';
import { startLocalGame } from '../../net/localHost';
import { net } from '../../net/netClient';
import { useAccount } from '../../store/accountStore';
import { Avatar, BackButton, Btn, LevelBar, Seg } from '../common/ui';
import { formatChips, timeAgo } from '../../utils/format';
import { SPECIES_MAP } from '../../core/player/profile';
import { enterOnEntryGesture } from '../../display/fullscreen';

const P_KEYS = Object.keys(PERSONALITIES) as AIPersonality[];
const DIFFS: AIDifficulty[] = ['easy', 'normal', 'hard', 'expert'];

/** 扑克大厅：与 AI 对战 / 在线房间 / 个人数据 */
export function HubScreen() {
  const setScreen = useGame((s) => s.setScreen);
  const set = useGame((s) => s.set);
  const toast = useGame((s) => s.toast);
  const name = useProfile((s) => s.name);
  const animal = useProfile((s) => s.animal);
  const stats = useProfile((s) => s.stats);
  const recent = useProfile((s) => s.recent);
  const achievements = useProfile((s) => s.achievements);

  const [count, setCount] = useState(4);
  const [difficulty, setDifficulty] = useState<AIDifficulty>('easy');
  const [chips, setChips] = useState(1000);
  const [blinds, setBlinds] = useState(0);
  const characters = useProfile((s) => s.characters);
  const [picked, setPicked] = useState<(string | undefined)[]>([]);
  const [mix, setMix] = useState<AIPersonality[]>(['aggressiveFox', 'cautiousPanda', 'crazyFrog', 'smartCat', 'luckyRabbit', 'smartCat', 'aggressiveFox']);

  const signedIn = useAccount((s) => s.status === 'signedIn');
  const cached = useAccount((s) => s.cached);
  const [starting, setStarting] = useState(false);
  // ref 立即生效：同一瞬间的连续点击只开始一局（状态还没来得及更新时 disabled 拦不住）
  const startLock = useRef(false);

  const start = async () => {
    if (startLock.current) return;
    startLock.current = true;
    // 手机 / 平板：按全屏偏好进入全屏（在点击里同步调用，之后才开始准备对局）
    enterOnEntryGesture();
    try {
      await doStart();
    } finally {
      startLock.current = false;
    }
  };
  const doStart = async () => {
    const [sb, bb] = BLIND_OPTIONS[blinds];
    const settings = {
      opponents: mix.slice(0, count).map((p, i) => {
        const c = characters.find((x) => x.id === picked[i]);
        return { personality: p, difficulty, ...(c ? { character: { name: c.name, animal: c.animal } } : {}) };
      }),
      startingChips: chips,
      smallBlind: sb,
      bigBlind: bb,
    };
    // 登录玩家：对局在服务器上运行，奖励由服务器计算并自动保存
    if (signedIn && !cached) {
      setStarting(true);
      const ok = await net.startSolo(settings);
      setStarting(false);
      if (ok) return;
      // 等待期间玩家已经离开了大厅：不要再把玩家拉进离线对局
      if (useGame.getState().screen !== 'quick') return;
      toast('服务器暂时无法同步你的资料。本局为离线对局，不计入云端存档。', 'error');
    }
    startLocalGame(settings);
    setScreen('game');
  };

  return (
    <div className="screen side-screen">
      <BackButton onClick={() => setScreen('home')} label="首页" />
      <div className="panel side-panel">
        <div className="panel-head">
          <Avatar animal={animal} />
          <div className="grow">
            <h2>扑克大厅</h2>
            <div className="small muted">
              {name} · {SPECIES_MAP[animal.species].name}
            </div>
          </div>
          <Btn kind="ghost" size="sm" onClick={() => setScreen('creator')}>
            换装
          </Btn>
        </div>
        <LevelBar />

        <div className="card-grid" style={{ marginTop: 16 }}>
          <div className="mode-card">
            <h3>🤖 与 AI 对战</h3>
            <div className="small muted" style={{ marginBottom: 12 }}>
              {signedIn ? '对局结果由服务器结算，经验、筹码和成就自动保存到云端。' : '游客模式：AI 在你的电脑上运行，进度只保存在本机。'}
            </div>
            <div className="field">
              <label>对手数量</label>
              <Seg options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: n }))} value={count} onChange={setCount} />
            </div>
            <div className="field">
              <label>AI 难度</label>
              <Seg options={DIFFS.map((d) => ({ value: d, label: DIFFICULTY_NAME[d] }))} value={difficulty} onChange={setDifficulty} />
            </div>
            <div className="field">
              <label>对手性格</label>
              {mix.slice(0, count).map((p, i) => (
                <div className="ai-row" key={i}>
                  <span style={{ fontSize: 22 }}>{SPECIES_MAP[PERSONALITIES[p].species].emoji}</span>
                  <select
                    className="select grow"
                    value={p}
                    onChange={(e) => {
                      const m = [...mix];
                      m[i] = e.target.value as AIPersonality;
                      setMix(m);
                    }}
                  >
                    {P_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {PERSONALITIES[k].name} — {PERSONALITIES[k].desc}
                      </option>
                    ))}
                  </select>
                  {characters.length > 0 && (
                    <select
                      className="select"
                      value={picked[i] ?? ''}
                      title="使用你在动物创建器中保存的角色（外观、声音、口头禅）"
                      onChange={(e) => {
                        const next = [...picked];
                        next[i] = e.target.value || undefined;
                        setPicked(next);
                      }}
                    >
                      <option value="">随机动物</option>
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {SPECIES_MAP[c.animal.species].emoji} {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
              {characters.length > 0 && <div className="small muted">可以让你保存的角色作为 AI 对手出场，它们会用自己的声音和口头禅说话。</div>}
            </div>
            <div className="field">
              <label>初始筹码</label>
              <Seg options={CHIP_OPTIONS.map((c) => ({ value: c, label: formatChips(c) }))} value={chips} onChange={setChips} />
            </div>
            <div className="field">
              <label>盲注</label>
              <Seg options={BLIND_OPTIONS.map(([s, b], i) => ({ value: i, label: `${s} / ${b}` }))} value={blinds} onChange={setBlinds} />
            </div>
            <Btn kind="pink" size="lg" block onClick={start} disabled={starting}>
              {starting ? '正在进入牌桌……' : '🃏 开始对局'}
            </Btn>
          </div>

          <div className="mode-card">
            <h3>🌏 在线多人</h3>
            <div className="small muted" style={{ marginBottom: 12 }}>
              和不同城市、不同国家的朋友进入同一个房间一起玩。
            </div>
            <div className="row">
              <Btn
                kind="cyan"
                className="grow"
                onClick={() => {
                  set({ onlineTab: 'create' });
                  setScreen('online');
                }}
              >
                创建房间
              </Btn>
              <Btn
                kind="cyan"
                className="grow"
                onClick={() => {
                  set({ onlineTab: 'join' });
                  setScreen('online');
                }}
              >
                加入房间
              </Btn>
            </div>
          </div>

          <div className="mode-card">
            <h3>📊 游戏统计</h3>
            <div className="stat-grid">
              <div className="stat">
                <b>{stats.handsPlayed}</b>
                <span>完成局数</span>
              </div>
              <div className="stat">
                <b>{stats.handsWon}</b>
                <span>获胜局数</span>
              </div>
              <div className="stat">
                <b>{stats.handsPlayed ? Math.round((stats.handsWon / stats.handsPlayed) * 100) : 0}%</b>
                <span>胜率</span>
              </div>
              <div className="stat">
                <b>{stats.bestStreak}</b>
                <span>最高连胜</span>
              </div>
              <div className="stat">
                <b>{Object.keys(achievements).length}</b>
                <span>成就</span>
              </div>
              <div className="stat">
                <b>{stats.gamesWon}</b>
                <span>冠军次数</span>
              </div>
            </div>
            <Btn kind="ghost" size="sm" block className="" onClick={() => setScreen('collection')}>
              查看收藏与成就 →
            </Btn>
          </div>

          <div className="mode-card">
            <h3>🕘 最近游戏</h3>
            {recent.length === 0 && <div className="small muted">还没有完成的比赛，快去开一局吧！</div>}
            {recent.slice(0, 5).map((r, i) => (
              <div key={i} className="row small" style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span>{r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : `第${r.place}名`}</span>
                <span className="grow">
                  {r.mode === 'online' ? '在线房间' : 'AI 对战'} · {r.players} 人 · {r.hands} 手
                </span>
                <span className="muted">{timeAgo(r.time)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

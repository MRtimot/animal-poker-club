// 账号界面：登录页、玩家资料加载、首次创建玩家档案、玩家档案、同步状态
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { useProfile } from '../../store/profileStore';
import {
  LOAD_STEPS,
  chooseGuest,
  deleteAccount,
  signInDev,
  signInWithGoogle,
  signOut,
  submitProfile,
  useAccount,
} from '../../store/accountStore';
import { accountApi } from '../../account/api';
import { NICKNAME_MAX, nicknameError } from '../../core/account/types';
import { FUR_COLORS, HATS, OUTFITS, SPECIES, SPECIES_MAP, type AnimalConfig } from '../../core/player/profile';
import { ACHIEVEMENTS, MAX_LEVEL } from '../../progress/progression';
import { HAND_NAME } from '../../core/poker/handEvaluator';
import { Avatar, BackButton, Btn, LevelBar, Modal } from '../common/ui';
import { formatChips } from '../../utils/format';
import { sound } from '../../audio/sound';

// ───────────── Google 登录按钮（Google Identity Services，标准 OpenID Connect） ─────────────

declare global {
  interface Window {
    google?: any;
  }
}

let gsiPromise: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gsiPromise) {
    gsiPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gsiPromise = null;
        reject(new Error('gsi'));
      };
      document.head.appendChild(s);
    });
  }
  return gsiPromise;
}

function GoogleButton({ clientId }: { clientId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const status = useAccount((s) => s.status);
  const loginError = useAccount((s) => s.loginError);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const busy = status === 'signingIn' || status === 'loading';

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        await loadGsi();
        // 每次登录使用新的一次性 nonce（防止令牌被重放）
        const { nonce } = await accountApi.nonce();
        if (cancelled || !ref.current) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          nonce,
          callback: (r: { credential?: string }) => {
            if (r?.credential) void signInWithGoogle(r.credential);
          },
          ux_mode: 'popup',
          auto_select: false,
          cancel_on_tap_outside: true,
          itp_support: true,
          use_fedcm_for_button: true,
        });
        ref.current.innerHTML = '';
        window.google.accounts.id.renderButton(ref.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          logo_alignment: 'left',
          locale: 'zh-CN',
          width: 300,
        });
        setState('ready');
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, loginError]);

  return (
    <div className="gbtn-wrap">
      <div ref={ref} className="gbtn-host" style={{ visibility: state === 'ready' && !busy ? 'visible' : 'hidden' }} />
      {(state !== 'ready' || busy) && (
        <div className={`gbtn-fake ${busy ? 'busy' : ''}`}>
          <GoogleG />
          {busy ? '正在验证……' : state === 'failed' ? '无法连接 Google，请检查网络' : '使用 Google 登录'}
        </div>
      )}
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.8-6z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

// ───────────── 登录页 ─────────────

export function LoginScreen() {
  const setScreen = useGame((s) => s.setScreen);
  const config = useAccount((s) => s.config);
  const status = useAccount((s) => s.status);
  const loginError = useAccount((s) => s.loginError);
  const [devName, setDevName] = useState('测试玩家');
  const busy = status === 'signingIn' || status === 'loading';

  useEffect(() => {
    if (status === 'signedIn') setScreen('home');
  }, [status, setScreen]);

  return (
    <div className="screen login-screen">
      <div className="login-card panel">
        <div className="login-crest" aria-hidden>
          ♠ ♥ ♣ ♦
        </div>
        <h1 className="login-title">动物扑克俱乐部</h1>
        <p className="login-sub">登录以保存你的游戏进度</p>
        <ul className="login-perks">
          <li>等级、经验、筹码与成就永久保存</li>
          <li>换电脑、换手机，进度都在</li>
          <li>你的动物和外观跟着你走</li>
        </ul>

        {config?.googleClientId ? (
          <GoogleButton clientId={config.googleClientId} />
        ) : (
          <div className="gbtn-wrap">
            <div className="gbtn-fake disabled">
              <GoogleG />
              Google 登录暂未开放
            </div>
            {import.meta.env.DEV && <div className="small muted" style={{ marginTop: 6 }}>开发提示：服务器未设置 GOOGLE_CLIENT_ID</div>}
          </div>
        )}
        {loginError && <div className="login-error">{loginError}</div>}

        {config?.devLogin && (
          <div className="dev-login">
            <div className="small muted">开发环境测试登录（正式环境不可用）</div>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" value={devName} maxLength={24} onChange={(e) => setDevName(e.target.value)} />
              <Btn kind="ghost" size="sm" disabled={busy || !devName.trim()} onClick={() => signInDev(devName.trim())}>
                测试登录
              </Btn>
            </div>
          </div>
        )}

        <div className="login-or">
          <span>或</span>
        </div>
        <Btn
          kind="ghost"
          block
          disabled={busy}
          onClick={() => {
            chooseGuest();
            setScreen('home');
          }}
        >
          以游客身份继续
        </Btn>
        <p className="login-note">
          由 Google 验证你的身份，我们不会看到或保存你的 Google 密码。
          <br />
          只使用虚拟筹码，没有任何真钱交易。
        </p>
      </div>
    </div>
  );
}

// ───────────── 正在加载玩家资料 ─────────────

export function ProfileLoading() {
  const step = useAccount((s) => s.loadStep);
  const account = useAccount((s) => s.account);
  const status = useAccount((s) => s.status);
  if (status !== 'loading' && step < 0) return null;
  if (step < 0) {
    return (
      <div className="profile-loading">
        <div className="pl-card panel">
          <div className="pl-spinner" />
          <div className="pl-title">正在验证……</div>
        </div>
      </div>
    );
  }
  return (
    <div className="profile-loading">
      <div className="pl-card panel">
        {account && (
          <div className="pl-avatar">
            <Avatar animal={account.animal} src={account.avatarUrl} size="lg" />
          </div>
        )}
        <div className="pl-title">正在加载玩家资料……</div>
        <ol className="pl-steps">
          {LOAD_STEPS.map((s, i) => (
            <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''}>
              <span className="pl-dot" />
              {s}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** 登录完成后的欢迎提示（克制的顶部横幅，不是弹窗） */
export function WelcomeBanner() {
  const welcome = useAccount((s) => s.welcome);
  const account = useAccount((s) => s.account);
  useEffect(() => {
    if (welcome) sound.play('unlock', 0.3);
  }, [welcome]);
  if (!welcome || !account) return null;
  return (
    <div className="welcome-banner" key={welcome}>
      <Avatar animal={account.animal} src={account.avatarUrl} />
      <div>
        <div className="wb-text">{welcome}</div>
        <div className="wb-sub">
          Lv.{account.level} · 🪙 {formatChips(account.chips)}
        </div>
      </div>
    </div>
  );
}

/** 自动保存状态：正在同步 / 已保存 / 同步失败，正在重试 */
export function SyncBadge() {
  const sync = useAccount((s) => s.sync);
  const cached = useAccount((s) => s.cached);
  const status = useAccount((s) => s.status);
  if (status !== 'signedIn') return null;
  const label =
    sync === 'syncing'
      ? '正在同步……'
      : sync === 'saved'
        ? '✓ 已保存'
        : sync === 'retrying'
          ? '同步失败，正在重试'
          : sync === 'offline' || cached
            ? '离线 · 恢复网络后自动同步'
            : null;
  if (!label) return null;
  return <div className={`sync-badge ${sync}`}>{label}</div>;
}

// ───────────── 首页右上角：玩家身份 ─────────────

export function AccountChip() {
  const setScreen = useGame((s) => s.setScreen);
  const status = useAccount((s) => s.status);
  const account = useAccount((s) => s.account);
  const name = useProfile((s) => s.name);
  const animal = useProfile((s) => s.animal);
  const stats = useProfile((s) => s.stats);

  if (status === 'signedIn' && account) {
    return (
      <button className="panel profile-chip account-chip" onClick={() => setScreen('profile')} title="查看玩家档案">
        <Avatar animal={animal} src={account.avatarUrl} />
        <div className="grow" style={{ textAlign: 'left' }}>
          <div className="ac-name">{name}</div>
          <div className="ac-meta">
            <span className="gold">🪙 {formatChips(account.chips)} 筹码</span>
          </div>
          <LevelBar />
        </div>
      </button>
    );
  }
  return (
    <div className="panel profile-chip">
      <Avatar animal={animal} />
      <div className="grow">
        <div style={{ fontWeight: 800 }}>
          {name} <span className="muted small">· 游客</span>
        </div>
        <LevelBar />
        <div className="small muted" style={{ marginTop: 4 }}>
          已玩 {stats.handsPlayed} 局 · 赢 {stats.handsWon} 局
        </div>
        <button className="guest-save" onClick={() => setScreen('login')} disabled={status === 'checking'}>
          登录以保存游戏进度 →
        </button>
      </div>
    </div>
  );
}

// ───────────── 首次登录：创建玩家档案 ─────────────

const STYLE_PRESETS: { id: string; name: string; patch: Partial<AnimalConfig> }[] = [
  { id: 'gent', name: '绅士', patch: { outfit: 'suit', hat: 'tophat', glasses: 'none', outfitColor: '#1f2a44' } },
  { id: 'casual', name: '休闲', patch: { outfit: 'hoodie', hat: 'cap', glasses: 'none', outfitColor: '#3f6e9a' } },
  { id: 'cool', name: '酷酷', patch: { outfit: 'denim', hat: 'none', glasses: 'shades', outfitColor: '#2f4d6e' } },
  { id: 'royal', name: '贵族', patch: { outfit: 'gown', hat: 'crown', glasses: 'gold', outfitColor: '#6b1f3a' } },
  { id: 'racer', name: '赛车手', patch: { outfit: 'racer', hat: 'none', glasses: 'round', outfitColor: '#b8322e' } },
];

export function OnboardingScreen() {
  const setScreen = useGame((s) => s.setScreen);
  const account = useAccount((s) => s.account);
  const animal = useProfile((s) => s.animal);
  const setAnimal = useProfile((s) => s.setAnimal);
  const [step, setStep] = useState(0);
  const [nick, setNick] = useState(account?.nickname ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const unlocked = new Set(account?.unlockedAnimals ?? ['cat']);
  const localErr = nicknameError(nick);

  const finish = async () => {
    setSaving(true);
    setErr(null);
    const e = await submitProfile({ nickname: nick, animal, onboarded: true });
    setSaving(false);
    if (e) {
      setErr(e);
      if (e.includes('昵称')) setStep(0);
      return;
    }
    sound.play('unlock', 0.4);
    useAccount.getState().set({ welcome: `欢迎来到动物扑克俱乐部，${nick.trim()}` });
    setTimeout(() => useAccount.getState().set({ welcome: null }), 3600);
    setScreen('home');
  };

  return (
    <div className="screen side-screen onboarding">
      <div className="panel side-panel">
        <div className="ob-steps">
          {['昵称', '动物', '风格'].map((s, i) => (
            <span key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
              {i + 1}. {s}
            </span>
          ))}
        </div>
        {step === 0 && (
          <>
            <h2>欢迎来到动物扑克俱乐部</h2>
            <p className="muted small" style={{ marginBottom: 16 }}>
              先给自己取一个游戏昵称。昵称会显示在牌桌上，和你的 Google 账号名称分开。
            </p>
            <div className="field">
              <label>游戏昵称</label>
              <input className="input" value={nick} maxLength={NICKNAME_MAX + 4} onChange={(e) => setNick(e.target.value)} placeholder="例如：狐狸先生" />
              <div className={`small ${localErr || err ? 'err-text' : 'muted'}`} style={{ marginTop: 6 }}>
                {err ?? localErr ?? `${[...nick.trim()].length}/${NICKNAME_MAX} · 中文、字母、数字均可`}
              </div>
            </div>
            <div className="grow" />
            <Btn block disabled={!!localErr} onClick={() => (setErr(null), setStep(1))}>
              下一步
            </Btn>
          </>
        )}
        {step === 1 && (
          <>
            <h2>选择你的动物</h2>
            <p className="muted small" style={{ marginBottom: 12 }}>
              更多动物会随着等级和成就解锁。
            </p>
            <div className="ob-species">
              {SPECIES.map((s) => {
                const ok = unlocked.has(s.id);
                return (
                  <button
                    key={s.id}
                    className={`ob-sp ${animal.species === s.id ? 'on' : ''}`}
                    disabled={!ok}
                    onClick={() => {
                      setAnimal({ ...animal, species: s.id, furColor: 'default' });
                      sound.play('pop');
                    }}
                    title={ok ? s.desc : '尚未解锁'}
                  >
                    <span className="e">{ok ? s.emoji : '🔒'}</span>
                    <span>{s.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="grow" />
            <div className="row" style={{ gap: 10 }}>
              <Btn kind="ghost" onClick={() => setStep(0)}>
                上一步
              </Btn>
              <Btn className="grow" onClick={() => setStep(2)}>
                下一步
              </Btn>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>外观与初始风格</h2>
            <div className="field">
              <label>初始风格</label>
              <div className="ob-presets">
                {STYLE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className={`ob-preset ${animal.outfit === p.patch.outfit && animal.hat === p.patch.hat ? 'on' : ''}`}
                    onClick={() => {
                      setAnimal({ ...animal, ...p.patch } as AnimalConfig);
                      sound.play('pop');
                    }}
                  >
                    <b>{p.name}</b>
                    <span className="small muted">
                      {OUTFITS.find((o) => o.id === p.patch.outfit)?.name} · {HATS.find((h) => h.id === p.patch.hat)?.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>毛色</label>
              <div className="ob-colors">
                {FUR_COLORS.map((f) => (
                  <button
                    key={f.id}
                    className={`ob-color ${animal.furColor === f.id ? 'on' : ''}`}
                    style={{ background: f.hex || SPECIES_MAP[animal.species].color }}
                    title={f.name}
                    onClick={() => setAnimal({ ...animal, furColor: f.id })}
                  />
                ))}
              </div>
            </div>
            <p className="small muted">之后可以随时在「动物创建器」里调整更多细节。</p>
            {err && <div className="login-error">{err}</div>}
            <div className="grow" />
            <div className="row" style={{ gap: 10 }}>
              <Btn kind="ghost" onClick={() => setStep(1)} disabled={saving}>
                上一步
              </Btn>
              <Btn kind="pink" className="grow" onClick={finish} disabled={saving}>
                {saving ? '正在保存……' : '创建玩家档案'}
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────── 玩家档案 ─────────────

export function ProfileScreen() {
  const setScreen = useGame((s) => s.setScreen);
  const account = useAccount((s) => s.account);
  const cached = useAccount((s) => s.cached);
  const status = useAccount((s) => s.status);
  const animal = useProfile((s) => s.animal);
  const [editing, setEditing] = useState(false);
  const [nick, setNick] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status !== 'signedIn') setScreen('home');
  }, [status, setScreen]);
  if (!account) return null;

  const s = account.stats;
  const winRate = s.handsPlayed ? Math.round((s.handsWon / s.handsPlayed) * 100) + '%' : '0%';
  const grid: [string, string | number][] = [
    ['游戏场次', s.gamesPlayed],
    ['冠军次数', s.gamesWon],
    ['完成手数', s.handsPlayed],
    ['胜利次数', s.handsWon],
    ['胜率', winRate],
    ['弃牌次数', s.folds],
    ['全押次数', s.allIns],
    ['最大底池', formatChips(s.biggestPot)],
    ['最大单局盈利', formatChips(s.biggestProfit)],
    ['最佳牌型', s.bestHand >= 0 ? HAND_NAME[s.bestHand as 0] : '—'],
    ['总下注', formatChips(s.totalBet)],
    ['总赢取筹码', formatChips(s.totalWinnings)],
    ['成就', `${Object.keys(account.achievements).length}/${ACHIEVEMENTS.length}`],
    ['已解锁动物', `${account.unlockedAnimals.length}/${SPECIES.length}`],
    ['最高连胜', s.bestStreak],
    ['在线局数', s.onlineHands],
  ];

  const saveNick = async () => {
    setBusy(true);
    const e = await submitProfile({ nickname: nick });
    setBusy(false);
    if (e) setErr(e);
    else {
      setEditing(false);
      setErr(null);
    }
  };

  return (
    <div className="screen side-screen profile-screen">
      <BackButton onClick={() => setScreen('home')} label="首页" />
      <div className="panel side-panel">
        <div className="pf-head">
          <Avatar animal={animal} src={account.avatarUrl} size="lg" />
          <div className="grow">
            {editing ? (
              <>
                <div className="row" style={{ gap: 8 }}>
                  <input className="input" autoFocus value={nick} maxLength={NICKNAME_MAX + 4} onChange={(e) => (setNick(e.target.value), setErr(null))} onKeyDown={(e) => e.key === 'Enter' && saveNick()} />
                  <Btn size="sm" onClick={saveNick} disabled={busy || !!nicknameError(nick)}>
                    保存
                  </Btn>
                  <Btn size="sm" kind="ghost" onClick={() => (setEditing(false), setErr(null))}>
                    取消
                  </Btn>
                </div>
                <div className={`small ${err || nicknameError(nick) ? 'err-text' : 'muted'}`} style={{ marginTop: 4 }}>
                  {err ?? nicknameError(nick) ?? '昵称会显示在牌桌和房间里'}
                </div>
              </>
            ) : (
              <h2 className="pf-name">
                {account.nickname}
                <button className="pf-edit" onClick={() => (setNick(account.nickname), setEditing(true))} title="修改游戏昵称" disabled={cached}>
                  ✎
                </button>
              </h2>
            )}
            <div className="small muted">
              {SPECIES_MAP[animal.species].emoji} {SPECIES_MAP[animal.species].name} · 加入于 {new Date(account.createdAt).toLocaleDateString('zh-CN')}
            </div>
          </div>
        </div>
        <div className="pf-top">
          <div>
            <div className="pf-lv">Lv. {account.level}</div>
            <div className="small muted">{account.level >= MAX_LEVEL ? '已达最高等级' : `经验值 ${formatChips(account.xp)}`}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="pf-chips">🪙 {formatChips(account.chips)}</div>
            <div className="small muted">虚拟筹码（不是真钱）</div>
          </div>
        </div>
        <LevelBar />
        {cached && <div className="pf-cached">正在显示离线缓存 · 等级、筹码与经验以服务器数据为准</div>}

        <div className="stat-grid" style={{ margin: '16px 0' }}>
          {grid.map(([k, v]) => (
            <div className="stat" key={k}>
              <b>{v}</b>
              <span>{k}</span>
            </div>
          ))}
        </div>

        <div className="row wrap" style={{ gap: 10 }}>
          <Btn kind="ghost" onClick={() => setScreen('collection')}>
            📚 收藏与成就
          </Btn>
          <Btn kind="ghost" onClick={() => setScreen('creator')}>
            🐾 修改外观
          </Btn>
        </div>

        <div className="pf-account">
          <div className="small muted">已绑定 Google 账号 · 进度自动保存到云端，换设备登录同一账号即可恢复</div>
          <div className="row wrap" style={{ gap: 10, marginTop: 10 }}>
            <Btn kind="ghost" onClick={() => signOut()}>
              退出登录
            </Btn>
            <Btn kind="red" size="sm" onClick={() => (setTyped(''), setConfirm(true))} disabled={cached}>
              删除账号
            </Btn>
          </div>
        </div>
      </div>

      {confirm && (
        <Modal
          title="⚠️ 删除账号"
          onClose={() => setConfirm(false)}
          actions={
            <>
              <Btn kind="ghost" onClick={() => setConfirm(false)} disabled={busy}>
                取消
              </Btn>
              <Btn
                kind="red"
                disabled={typed.trim() !== '删除账号' || busy}
                onClick={async () => {
                  setBusy(true);
                  const ok = await deleteAccount();
                  setBusy(false);
                  if (ok) setConfirm(false);
                }}
              >
                {busy ? '正在删除……' : '永久删除'}
              </Btn>
            </>
          }
        >
          <p>
            这会<b>永久删除</b>你的玩家档案：等级、经验、虚拟筹码、成就、解锁的动物、保存的角色、统计和设置，全部无法恢复。
          </p>
          <p className="muted small">只是想暂时离开？使用「退出登录」即可，数据会保留在云端。</p>
          <div className="field">
            <label>请输入「删除账号」以确认</label>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="删除账号" />
          </div>
        </Modal>
      )}
    </div>
  );
}

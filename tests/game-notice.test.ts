// 游戏说明（虚拟娱乐游戏提示）：存档迁移、只显示一次、绝不阻塞加载；全站没有真钱相关的界面文字
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const g = globalThis as any;
g.window ??= globalThis;
g.addEventListener ??= () => {};
g.removeEventListener ??= () => {};
const mem = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
};

async function load(saved: string | null) {
  vi.resetModules();
  g.localStorage = mem();
  if (saved !== null) g.localStorage.setItem('apc-game-notice', saved);
  return import('../src/privacy/gameNotice');
}

describe('游戏说明：存档与显示时机', () => {
  it('旧玩家 / 新玩家没有这个字段：undefined → false → 显示', async () => {
    const m = await load(null);
    expect(m.useGameNotice.getState().acknowledged).toBe(false);
  });

  it('损坏、旧版本、字段类型不对都按“还没确认”处理，不抛错', async () => {
    for (const raw of ['{', 'null', '123', '{"version":1}', '{"version":1,"gameNoticeAcknowledged":"yes"}', '{"version":0,"gameNoticeAcknowledged":true}']) {
      const m = await load(raw);
      expect(m.useGameNotice.getState().acknowledged).toBe(false);
    }
  });

  it('点继续 → true，写入本机；重新打开（刷新）后不再显示', async () => {
    const m = await load(null);
    m.acknowledgeGameNotice();
    expect(m.useGameNotice.getState().acknowledged).toBe(true);
    const raw = g.localStorage.getItem('apc-game-notice');
    expect(JSON.parse(raw)).toMatchObject({ version: 1, gameNoticeAcknowledged: true });
    // 模拟刷新：重新载入模块，读取同一份存储
    vi.resetModules();
    const again = await import('../src/privacy/gameNotice');
    expect(again.useGameNotice.getState().acknowledged).toBe(true);
    expect(again.shouldShowGameNotice({ acknowledged: true, loaderGone: true }, 'home')).toBe(false);
  });

  it('存储不可用：点继续不会报错，本次打开期间不再出现', async () => {
    const m = await load(null);
    g.localStorage.setItem = () => {
      throw new Error('QuotaExceeded');
    };
    expect(() => m.acknowledgeGameNotice()).not.toThrow();
    expect(m.useGameNotice.getState().acknowledged).toBe(true);
  });

  it('只在加载页退场后、首页 / 模式选择 / 在线入口出现；牌局、房间、登录、建角色时不打断', async () => {
    const m = await load(null);
    const s = { acknowledged: false, loaderGone: false };
    expect(m.shouldShowGameNotice(s, 'home')).toBe(false);
    const gone = { acknowledged: false, loaderGone: true };
    for (const sc of ['home', 'quick', 'online']) expect(m.shouldShowGameNotice(gone, sc)).toBe(true);
    for (const sc of ['game', 'room', 'login', 'onboarding', 'creator', 'settings']) expect(m.shouldShowGameNotice(gone, sc)).toBe(false);
    m.markLoaderGone();
    m.markLoaderGone();
    expect(m.useGameNotice.getState().loaderGone).toBe(true);
  });
});

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('游戏说明：不阻塞加载、与加载页衔接', () => {
  it('启动步骤（boot.ts）与加载流程不等待说明；说明只在加载页退场后出现', () => {
    expect(read('src/boot/boot.ts')).not.toMatch(/gameNotice/);
    const flow = read('src/ui/boot/useLoaderFlow.ts');
    expect(flow).toMatch(/phase === 'gone'\) markLoaderGone\(\)/);
    // 说明不参与“就绪”的判断
    expect(flow).not.toMatch(/acknowledged/);
  });

  it('电脑版与手机版加载页（静态 index.html 与 React 接管后）都有虚拟游戏提示', () => {
    const html = read('index.html');
    expect(html).toContain('class="apl-notice"');
    expect(html).toContain('class="apm-notice"');
    for (const f of ['index.html', 'src/ui/boot/PremiumLoader.tsx', 'src/ui/boot/MobileLoader.tsx']) {
      const s = read(f);
      expect(s).toContain('VIRTUAL GAME • FOR ENTERTAINMENT ONLY');
      expect(s).toContain('不涉及真钱赌博');
    }
  });

  it('各模式与在线房间页面都有虚拟游戏标识', () => {
    expect(read('src/ui/home/HubScreen.tsx')).toMatch(/<VirtualTag/);
    expect(read('src/ui/home/HubScreen.tsx')).toMatch(/TEXAS HOLD&rsquo;EM · VIRTUAL GAME/);
    expect(read('src/ui/blackjack/BlackjackSetup.tsx')).toMatch(/VIRTUAL GAME · PLAYER vs DEALER/);
    expect(read('src/ui/lobby/OnlineScreen.tsx')).toMatch(/<OnlineVirtualNote/);
    expect(read('src/ui/lobby/RoomLobby.tsx')).toMatch(/<VirtualTag/);
  });
});

describe('没有真钱相关的界面文字', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx|ts|html)$/.test(e.name)) files.push(p);
    }
  };
  walk('src');
  files.push('index.html');

  it('界面不出现现实货币符号、充值 / 提现 / 兑换 / 赚钱等字样（“不提供……”这类否定说明除外）', () => {
    const bad: string[] = [];
    const patterns = [/\bRM\s?\d/, /\bMYR\b/, /\bUSD\b/, /[¥￥]/, /\$\s?\d/, /Cash Prize|Win (Real )?Cash|Win Money|Earn Money|Make Money|Deposit now|Real Casino|Guaranteed Win|Easy Money/i, /赚钱|现金奖励|充值送|立即充值|提现到|兑换现金|赌场/];
    for (const f of files) {
      const lines = read(f).split('\n');
      lines.forEach((l, i) => {
        // 代码注释与“没有 / 不提供 / 不涉及 / 不能”这类否定说明不算
        const text = l.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        if (/没有|不提供|不涉及|不能|不是|无真钱|does not provide|No real-money/i.test(text)) return;
        for (const p of patterns) if (p.test(text)) bad.push(`${f}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('协议里没有玩家之间转让金币、充值、提现或兑换的消息', () => {
    const proto = read('src/core/protocol.ts');
    expect(proto).not.toMatch(/t: '(transfer|gift|deposit|withdraw|cashout|exchange|purchase|buy)/i);
  });
});

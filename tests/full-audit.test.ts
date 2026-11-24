// 全项目深度审计（第二轮）回归测试：每一项对应本轮发现并修复的问题
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { createServer } from '../server/index';
import type { ServerMessage, RoomInfo } from '../src/core/protocol';
import type { TableView } from '../src/core/game/view';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';
import { BrowserVoiceEngine } from '../src/audio/voice';
import { resolveVoiceProfile } from '../src/core/character/voice';

async function until(cond: () => boolean, ms = 8000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

class P {
  ws!: WebSocket;
  msgs: ServerMessage[] = [];
  playerId = '';
  room: RoomInfo | null = null;
  view: TableView | null = null;
  errors: string[] = [];
  constructor(public name: string) {}
  async connect(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}/api/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.msgs.push(m);
      if (m.t === 'welcome') this.playerId = m.playerId;
      if (m.t === 'room') this.room = m.room;
      if (m.t === 'state' && !m.view.eventsDelta) this.view = m.view;
      if (m.t === 'error') this.errors.push(m.message);
    });
    await new Promise<void>((r) => this.ws.on('open', () => r()));
    this.send({ t: 'hello', profile: { name: this.name, animal: DEFAULT_ANIMAL } });
    await until(() => !!this.playerId);
  }
  send(m: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  close() {
    this.ws.close();
  }
}

const settings = { maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 };
let srv: Awaited<ReturnType<typeof createServer>>;
beforeAll(async () => {
  srv = await createServer(0, { pace: 0.02, turnTimeMs: 2000, connLimits: { perIp: 1000, perMinute: 10000 } });
});
afterAll(async () => {
  await srv.close();
});

describe('AUD2-01 AI 性格 / 难度只接受真实存在的选项（原型链上的名字不算）', () => {
  it('添加 AI 时性格写成 constructor / toString / __proto__：使用默认性格加入，不会让服务器处理失败', async () => {
    const p = new P('房主');
    await p.connect(srv.port);
    p.send({ t: 'createRoom', settings });
    await until(() => !!p.room);
    for (const personality of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) p.send({ t: 'addAI', personality, difficulty: 'valueOf' });
    await until(() => (p.room?.members.length ?? 0) === 5);
    expect(p.errors).toEqual([]);
    for (const m of p.room!.members.filter((x) => x.isAI)) {
      expect(m.aiPersonality).toBe('smartCat');
      expect(m.aiDifficulty).toBe('normal');
      expect(typeof m.profile.name).toBe('string');
    }
    p.close();
  });

  it('开始 AI 对局时对手性格写成原型链上的名字：照常开始，对手使用默认性格', async () => {
    const p = new P('玩家');
    await p.connect(srv.port);
    p.send({ t: 'startSolo', settings: { opponents: [{ personality: 'constructor', difficulty: 'toString' }, { personality: '__proto__' }], startingChips: 1000, smallBlind: 10, bigBlind: 20 } });
    await until(() => !!p.room && !!p.view);
    expect(p.errors).toEqual([]);
    expect(p.room!.solo).toBe(true);
    expect(p.room!.members.filter((m) => m.isAI).every((m) => m.aiPersonality === 'smartCat')).toBe(true);
    p.close();
  });
});

/** 假的语音环境：可以控制“有没有中文语音”，记录播放了哪些句子 */
function fakeVoiceEnv() {
  const spoken: string[] = [];
  let voices: { name: string; lang: string; localService: boolean; voiceURI: string; default: boolean }[] = [{ name: 'Tingting', lang: 'zh-CN', localService: true, voiceURI: 't', default: true }];
  class U {
    voice: unknown = null;
    lang = '';
    pitch = 1;
    rate = 1;
    volume = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onboundary: (() => void) | null = null;
    constructor(public text: string) {}
  }
  const synth = {
    getVoices: () => voices,
    speak(u: U) {
      spoken.push(u.text);
      setTimeout(() => {
        u.onstart?.();
        setTimeout(() => u.onend?.(), 5);
      }, 1);
    },
    cancel() {},
    pause() {},
    resume() {},
  };
  return {
    spoken,
    setVoices(v: typeof voices) {
      voices = v;
    },
    env: { synth, Utterance: U, canAutoplay: () => true } as unknown as ConstructorParameters<typeof BrowserVoiceEngine>[0],
  };
}

describe('AUD2-03 角色语音队列：排队的一句无法播放时，后面的台词不会卡住', () => {
  it('排队中的一句没有可以朗读的内容（被跳过）：下一句照常播放', async () => {
    const f = fakeVoiceEnv();
    const v = new BrowserVoiceEngine(f.env);
    const prof = resolveVoiceProfile(DEFAULT_ANIMAL);
    const results: string[] = [];
    const a = v.speak('第一句', prof, { plan: { leadInMs: 0, segments: [{ text: '第一句', kind: 'normal', pitch: 1, rate: 1, volume: 1, pauseAfterMs: 0 }] } as never });
    // 第二句没有任何可以朗读的段落（例如只有表情）：只显示字幕
    const b = v.speak('🙂', prof, { plan: { leadInMs: 0, segments: [] } as never });
    const c = v.speak('第三句', prof, { plan: { leadInMs: 0, segments: [{ text: '第三句', kind: 'normal', pitch: 1, rate: 1, volume: 1, pauseAfterMs: 0 }] } as never });
    void a.then((r) => results.push('a:' + r));
    void b.then((r) => results.push('b:' + r));
    void c.then((r) => results.push('c:' + r));
    await until(() => results.length === 3, 2000);
    expect(results).toEqual(['a:spoken', 'b:text-only', 'c:spoken']);
    expect(f.spoken).toEqual(['第一句', '第三句']);
    expect(v.speaking).toBe(false);
    v.dispose();
  });
});

describe('AUD2-04 游客昵称不合规时的替代名字：同一名玩家每次重连都一样', () => {
  it('昵称只有一个字：服务器改用替代名字；刷新（同一会话重连）后名字不变，房间里不会一会儿一个名字', async () => {
    const hello = async (sessionId?: string) => {
      const ws = new WebSocket(`ws://localhost:${srv.port}/api/ws`);
      const msgs: ServerMessage[] = [];
      ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
      await new Promise<void>((r) => ws.on('open', () => r()));
      ws.send(JSON.stringify({ t: 'hello', sessionId, profile: { name: '甲', animal: DEFAULT_ANIMAL } }));
      await until(() => msgs.some((m) => m.t === 'welcome'));
      return { ws, msgs, welcome: msgs.find((m) => m.t === 'welcome') as Extract<ServerMessage, { t: 'welcome' }> };
    };
    const a = await hello();
    a.ws.send(JSON.stringify({ t: 'createRoom', settings }));
    await until(() => a.msgs.some((m) => m.t === 'room' && m.room));
    const nameOf = (msgs: ServerMessage[]) => {
      const r = [...msgs].reverse().find((m) => m.t === 'room' && m.room) as Extract<ServerMessage, { t: 'room' }>;
      return r.room!.members[0].profile.name;
    };
    const first = nameOf(a.msgs);
    expect(first).toMatch(/^玩家\d{4}$/);
    a.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    const b = await hello(a.welcome.sessionId);
    expect(b.welcome.playerId).toBe(a.welcome.playerId);
    await until(() => b.msgs.some((m) => m.t === 'room' && m.room));
    expect(nameOf(b.msgs)).toBe(first);
    // 资料更新（例如换了外观）也保持同一个替代名字
    b.ws.send(JSON.stringify({ t: 'updateProfile', profile: { name: '乙', animal: DEFAULT_ANIMAL } }));
    await new Promise((r) => setTimeout(r, 300));
    expect(nameOf(b.msgs)).toBe(first);
    b.ws.close();
  });
});

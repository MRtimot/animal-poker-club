// 动物角色语音系统：声音档案、性格、台词导演（冷却 / 上限 / 优先级）、牌局触发、在线同步、语音管理器
import { describe, it, expect, afterAll, vi } from 'vitest';
import WebSocket from 'ws';
import { SPECIES, DEFAULT_ANIMAL, sanitizeAnimal } from '../src/core/player/profile';
import { VOICE_PROFILES, PERSONALITIES_BY_SPECIES, resolveVoiceProfile, sanitizeVoiceSettings, type AnimalVoiceProfile } from '../src/core/character/voice';
import { DIALOGUE, DialogueDirector, dialogueById, pickLine, type DialogueEvent } from '../src/core/character/dialogue';
import { planSpeech, planTimeline, splitPhrases } from '../src/core/character/prosody';
import { GameController } from '../src/core/game/controller';
import type { SeatConfig } from '../src/core/game/view';
import { seededRandom } from '../src/core/utils/random';
import { VoiceManager, estimateSpeechMs, mergeStutters, type VoiceEnv } from '../src/audio/voice';
import { createServer } from '../server/index';
import type { ServerMessage, ChatMessage } from '../src/core/protocol';

describe('角色声音与性格', () => {
  it('每种动物都有声音档案和性格，声音参数互不相同', () => {
    const combos = new Set<string>();
    for (const s of SPECIES) {
      const v = VOICE_PROFILES[s.id];
      const p = PERSONALITIES_BY_SPECIES[s.id];
      expect(v, s.id).toBeTruthy();
      expect(p, s.id).toBeTruthy();
      expect(v.pitch).toBeGreaterThan(0);
      expect(v.pitch).toBeLessThanOrEqual(2);
      expect(p.catchphrases.length).toBeGreaterThan(0);
      combos.add(`${v.pitch}|${v.speed}`);
    }
    expect(combos.size).toBe(SPECIES.length);
    // 题目里的声音方向
    expect(VOICE_PROFILES.wolf.pitch).toBeLessThan(VOICE_PROFILES.cat.pitch);
    expect(VOICE_PROFILES.rabbit.pitch).toBeGreaterThan(VOICE_PROFILES.dog.pitch);
    expect(VOICE_PROFILES.bear.speed).toBeLessThan(VOICE_PROFILES.monkey.speed);
  });

  it('每种说话风格都有主要牌局事件的台词，台词 ID 可以还原', () => {
    const events: DialogueEvent[] = ['greet', 'raise', 'allin', 'call', 'fold', 'react_raise', 'react_allin', 'win', 'win_big', 'bluff_win', 'lose', 'big_hand'];
    for (const [style, table] of Object.entries(DIALOGUE)) {
      for (const e of events) expect(table[e]?.length, `${style}.${e}`).toBeGreaterThan(0);
    }
    const l = pickLine({ id: 'x', species: 'wolf', isAI: true }, 'react_allin', () => 0)!;
    expect(dialogueById(l.ref.id)!.text).toBe(l.text);
  });

  it('自定义声音：预设 + 微调；非法值被修正；口头禅过滤不当内容', () => {
    const v = resolveVoiceProfile({ species: 'cat', voice: { preset: 'deep', pitch: 0.1, rate: 0 } });
    expect(v.pitch).toBeCloseTo(0.65);
    expect(v.style).toBe('cool');
    expect(sanitizeVoiceSettings({ preset: 'laser', pitch: 99, rate: NaN })).toEqual({ preset: 'auto', pitch: 0.5, rate: 0 });
    const a = sanitizeAnimal({ ...DEFAULT_ANIMAL, catchphrase: '<b>来吧</b>' + 'x'.repeat(40), voice: { preset: 'villain', pitch: -0.2, rate: 0.1 } });
    expect(a.catchphrase).not.toContain('<');
    expect([...a.catchphrase!].length).toBeLessThanOrEqual(24);
    expect(a.voice).toEqual({ preset: 'villain', pitch: -0.2, rate: 0.1 });
    expect(sanitizeAnimal({ ...DEFAULT_ANIMAL, catchphrase: '你是傻逼' }).catchphrase).toBeUndefined();
  });
});

describe('台词导演：不会疯狂讲话', () => {
  const ai = (id: string) => ({ id, species: 'wolf' as const, isAI: true });
  it('普通台词有 5 秒冷却；每手最多 3 句（重大事件可多 1 句）', () => {
    const d = new DialogueDirector(() => 0);
    let t = 0;
    expect(d.consider(ai('a'), 'raise', 1, t)).not.toBeNull();
    expect(d.consider(ai('b'), 'call', 1, (t += 1000))).toBeNull(); // 冷却中
    expect(d.consider(ai('b'), 'call', 1, (t += 5000))).not.toBeNull();
    expect(d.consider(ai('c'), 'fold', 1, (t += 6000))).not.toBeNull();
    expect(d.consider(ai('d'), 'call', 1, (t += 6000))).toBeNull(); // 已经 3 句
    expect(d.consider(ai('d'), 'react_allin', 1, (t += 100))).not.toBeNull(); // 重大事件多 1 句
    expect(d.consider(ai('e'), 'react_allin', 1, (t += 100))).toBeNull();
    expect(d.consider(ai('a'), 'raise', 2, (t += 6000))).not.toBeNull(); // 新的一手重新计数
  });

  it('同花顺之后不再说普通台词；真人玩家的动物只在重大时刻开口；状态可以保存恢复', () => {
    const d = new DialogueDirector(() => 0);
    expect(d.consider(ai('a'), 'big_hand', 1, 0)).not.toBeNull();
    expect(d.consider(ai('b'), 'win', 1, 99999)).toBeNull();
    const human = { id: 'h', species: 'cat' as const, isAI: false };
    expect(d.consider(human, 'raise', 2, 200000)).toBeNull();
    expect(d.consider(human, 'allin', 2, 200000)).not.toBeNull();
    const restored = new DialogueDirector(() => 0, undefined, JSON.parse(JSON.stringify(d.toState())));
    expect(restored.consider(ai('z'), 'call', 2, 200500)).toBeNull(); // 冷却延续
  });
});

describe('牌局 → 台词（AI 模式）', () => {
  it('AI 对局中动物会说话：台词合法、带情绪，且频率受限', async () => {
    const seats: SeatConfig[] = ['wolf', 'cat', 'rabbit', 'fox'].map((sp, i) => ({
      id: 'p' + i,
      profile: { name: sp, animal: { ...DEFAULT_ANIMAL, species: sp as any } },
      chips: 1000,
      // 第一个座位是真人（超时自动过牌 / 弃牌）：全是 AI 的牌桌会在第一手后结束
      isAI: i > 0,
      aiPersonality: 'smartCat',
      aiDifficulty: 'normal',
    }));
    const c = new GameController(seats, { smallBlind: 10, bigBlind: 20, pace: 0.01, turnTimeMs: 20, aiRng: seededRandom(7) });
    const said: { id: string; text: string; ref: any; hand: number; at: number }[] = [];
    c.onChat = (id, kind, text, ref) => {
      if (ref) said.push({ id, text, ref, hand: c.engine.handNumber, at: Date.now() });
    };
    c.start();
    await new Promise<void>((r) => {
      const t = setInterval(() => {
        if (c.isGameOver() || c.engine.handNumber >= 25) {
          clearInterval(t);
          r();
        }
      }, 20);
    });
    c.stop();
    expect(said.length).toBeGreaterThan(3);
    const perHand = new Map<string, number>();
    for (const s of said) {
      expect(s.ref.id === 'custom.catchphrase' || dialogueById(s.ref.id)?.text === s.text).toBe(true);
      expect(s.ref.emotion).toBeTruthy();
      const k = s.ref.event === 'think' ? `${s.hand}:think` : `${s.hand}`;
      perHand.set(k, (perHand.get(k) ?? 0) + 1);
    }
    // 普通台词每手最多 3 句（重大事件 +1）；思考台词另算，每手最多 1 句
    for (const [k, n] of perHand) expect(n, k).toBeLessThanOrEqual(k.endsWith(':think') ? 1 : 4);
  }, 30000);
});

describe('在线同步：服务器决定台词，客户端只播放', () => {
  let srv: Awaited<ReturnType<typeof createServer>>;
  afterAll(async () => srv && (await srv.close()));

  it('两个客户端收到同一条台词事件（同一个 ID、情绪），不包含音频数据', async () => {
    srv = await createServer(0, { pace: 0.02, turnTimeMs: 300, connLimits: { perIp: 100, perMinute: 1000 } });
    const mk = () => {
      const ws = new WebSocket(`ws://localhost:${srv.port}/api/ws`);
      const msgs: ServerMessage[] = [];
      ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
      return { ws, msgs, open: new Promise<void>((r) => ws.on('open', () => r())) };
    };
    const a = mk();
    const b = mk();
    await Promise.all([a.open, b.open]);
    const send = (c: typeof a, m: unknown) => c.ws.send(JSON.stringify(m));
    send(a, { t: 'hello', profile: { name: '甲', animal: DEFAULT_ANIMAL } });
    send(b, { t: 'hello', profile: { name: '乙', animal: DEFAULT_ANIMAL } });
    const until = async (f: () => boolean, ms = 20000) => {
      const t = Date.now();
      while (!f()) {
        if (Date.now() - t > ms) throw new Error('等待超时');
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    await until(() => a.msgs.some((m) => m.t === 'welcome') && b.msgs.some((m) => m.t === 'welcome'));
    send(a, { t: 'createRoom', settings: { maxPlayers: 6, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 } });
    await until(() => a.msgs.some((m) => m.t === 'room' && m.room));
    const code = (a.msgs.find((m) => m.t === 'room' && m.room) as any).room.code;
    for (const p of ['aggressiveFox', 'crazyFrog', 'luckyRabbit']) send(a, { t: 'addAI', personality: p, difficulty: 'normal' });
    send(b, { t: 'joinRoom', code });
    send(b, { t: 'ready', ready: true });
    await until(() => (a.msgs.filter((m) => m.t === 'room').at(-1) as any)?.room?.members.length === 5);
    await new Promise((r) => setTimeout(r, 100));
    send(a, { t: 'startGame' });
    const dialogues = (c: typeof a) => c.msgs.filter((m) => m.t === 'chat' && m.message.dialogue).map((m) => (m as { message: ChatMessage }).message);
    await until(() => dialogues(a).length >= 2 && dialogues(b).length >= 2, 40000);
    const da = dialogues(a);
    const db = dialogues(b);
    for (const m of da.slice(0, 2)) {
      const same = db.find((x) => x.id === m.id)!;
      expect(same).toBeTruthy();
      expect(same.dialogue).toEqual(m.dialogue);
      expect(same.text).toBe(m.text);
      expect(JSON.stringify(m).length).toBeLessThan(500); // 只有台词事件，没有音频
    }
    a.ws.close();
    b.ws.close();
  }, 60000);
});

// ───────────── 语音管理器（使用假的浏览器语音合成） ─────────────

class FakeUtterance {
  voice: any = null;
  lang = '';
  pitch = 1;
  rate = 1;
  volume = 1;
  onstart: any;
  onend: any;
  onerror: any;
  onboundary: any;
  constructor(public text: string) {}
}

function fakeEnv(voices: { name: string; lang: string; localService?: boolean }[], opts: { autoplay?: boolean } = {}) {
  const spoken: FakeUtterance[] = [];
  let cancelled = 0;
  const env: VoiceEnv = {
    synth: {
      getVoices: () => voices as any,
      speak: (u: any) => {
        spoken.push(u);
        setTimeout(() => u.onstart?.(), 1);
      },
      cancel: () => {
        cancelled++;
      },
      pause: () => {},
      resume: () => {},
    },
    Utterance: FakeUtterance as any,
    canAutoplay: () => opts.autoplay ?? true,
  };
  return { env, spoken, cancelled: () => cancelled };
}

const wolf: AnimalVoiceProfile = VOICE_PROFILES.wolf;
const rabbit: AnimalVoiceProfile = VOICE_PROFILES.rabbit;

describe('语音管理器（VoiceManager）', () => {
  it('不支持 / 没有中文语音 / 浏览器限制自动播放：只显示字幕，不会出错', async () => {
    expect(await new VoiceManager(null).speak('你好', wolf)).toBe('text-only');
    expect(new VoiceManager(null).status()).toBe('unsupported');
    const en = fakeEnv([{ name: 'Samantha', lang: 'en-US' }]);
    const m = new VoiceManager(en.env);
    expect(m.status()).toBe('no-chinese-voice');
    expect(await m.speak('你好', wolf)).toBe('text-only');
    expect(en.spoken).toHaveLength(0);
    const blocked = fakeEnv([{ name: 'Tingting', lang: 'zh-CN' }], { autoplay: false });
    expect(await new VoiceManager(blocked.env).speak('你好', wolf)).toBe('text-only');
  });

  it('动态挑选中文语音：男声 / 女声偏好，不同动物声音参数不同，参数被缓存', () => {
    const f = fakeEnv([
      { name: 'Samantha', lang: 'en-US' },
      { name: 'Tingting', lang: 'zh-CN', localService: true },
      { name: 'Microsoft Kangkang', lang: 'zh-CN' },
      { name: 'Sinji', lang: 'zh-HK' },
    ]);
    const m = new VoiceManager(f.env);
    expect(m.status()).toBe('ok');
    expect(m.pickVoice(wolf)!.name).toBe('Microsoft Kangkang');
    expect(m.pickVoice(rabbit)!.name).toBe('Tingting');
    const r1 = m.resolve(wolf, 'confident');
    expect(m.resolve(wolf, 'confident')).toBe(r1);
    const r2 = m.resolve(rabbit, 'nervous');
    expect(r2.pitch).toBeGreaterThan(r1.pitch);
    expect(r2.rate).toBeGreaterThan(r1.rate);
  });

  it('播放、结束回调；重要台词打断普通台词；队列最多 2 句', async () => {
    const f = fakeEnv([{ name: 'Tingting', lang: 'zh-CN' }]);
    const m = new VoiceManager(f.env);
    const ends: string[] = [];
    const flat = { natural: false };
    const p1 = m.speak('我跟。', wolf, { ...flat, priority: 1, onEnd: () => ends.push('1') });
    const p2 = m.speak('过。', wolf, { ...flat, priority: 0 });
    const p3 = m.speak('过牌～', rabbit, { ...flat, priority: 0 });
    const p4 = m.speak('过过～', rabbit, { ...flat, priority: 0 });
    expect(await p4).toBe('skipped'); // 队列已满
    const big = m.speak('全部压上来了？有意思。', wolf, { ...flat, priority: 3 });
    expect(await p1).toBe('interrupted');
    expect(await p2).toBe('skipped');
    expect(await p3).toBe('skipped');
    expect(f.cancelled()).toBeGreaterThan(0);
    const u = f.spoken.at(-1)!;
    expect(u.text).toBe('全部压上来了？有意思。');
    expect(u.lang).toBe('zh-CN');
    u.onend();
    expect(await big).toBe('spoken');
    expect(ends).toEqual(['1']);
    expect(m.speaking).toBe(false);
    m.stop();
  });

  it('估算朗读时间：字越多越长，语速越快越短', () => {
    expect(estimateSpeechMs('全部压上来了？有意思。')).toBeGreaterThan(estimateSpeechMs('我跟。'));
    expect(estimateSpeechMs('全部压上来了？有意思。', 2)).toBeLessThan(estimateSpeechMs('全部压上来了？有意思。', 1));
  });
});

// ───────────── 自然说话：语调规划 / 分段播放 / 情境台词 ─────────────

const mid = () => 0.5; // 没有随机抖动，方便比较

describe('语调规划（不让声音像念稿）', () => {
  it('只在省略号、破折号、结巴和句与句之间分段；逗号留在句子里，绝不逐字切', () => {
    expect(splitPhrases('我跟。').map((p) => p.text)).toEqual(['我跟。']);
    expect(splitPhrases('嗯……让我想想。').map((p) => p.text)).toEqual(['嗯', '让我想想。']);
    expect(splitPhrases('等等——你真的要全押？').map((p) => [p.text, p.brk])).toEqual([['等等', 'dash'], ['你真的要全押？', 'end']]);
    expect(splitPhrases('等、等一下！你真的要全押吗？！').map((p) => p.text)).toEqual(['等', '等一下！', '你真的要全押吗？！']);
    expect(splitPhrases('呜呜……没关系，下一局！').map((p) => p.text)).toEqual(['呜呜', '没关系，下一局！']);
    const lead = splitPhrases('……我跟。');
    expect(lead.map((p) => p.text)).toEqual(['我跟。']);
    expect(lead[0].leading).toBe(true);
    // 台词库里每一句：段数不多、没有空段、逗号不会被切开
    for (const table of Object.values(DIALOGUE))
      for (const lines of Object.values(table))
        for (const l of lines!) {
          const parts = splitPhrases(l.text);
          expect(parts.length, l.text).toBeGreaterThan(0);
          expect(parts.length, l.text).toBeLessThanOrEqual(4);
          for (const p of parts) expect(p.text.replace(/[，。！？、]/g, '').length, l.text).toBeGreaterThan(0);
        }
  });

  it('问句尾音上扬；犹豫词更轻更慢、后面停得久；自信短句更慢更重', () => {
    const q = planSpeech('你真的要跟？', wolf, 'neutral', mid).segments[0];
    const e = planSpeech('你真的要跟！', wolf, 'neutral', mid).segments[0];
    expect(q.pitch).toBeGreaterThan(e.pitch);
    expect(e.volume).toBeGreaterThanOrEqual(q.volume);
    const h = planSpeech('嗯……我跟。', wolf, 'confident', mid);
    expect(h.segments.map((x) => x.kind)).toEqual(['hesitation', 'phrase']);
    expect(h.segments[0].volume).toBeLessThan(h.segments[1].volume);
    expect(h.segments[0].pauseAfterMs).toBeGreaterThan(400);
    expect(h.segments[1].pauseAfterMs).toBe(0);
    const short = planSpeech('跟。', wolf, 'confident', mid).segments[0];
    const long = planSpeech('我想看看你的牌。', wolf, 'confident', mid).segments[0];
    expect(short.rate).toBeLessThan(long.rate);
  });

  it('同一只狼：自信 vs 紧张明显不同；不同动物的节奏不同', () => {
    const c = planSpeech('……你在赌命。', wolf, 'confident', mid);
    const n = planSpeech('……你在赌命。', wolf, 'nervous', mid);
    expect(n.segments[0].pitch).toBeGreaterThan(c.segments[0].pitch);
    expect(n.segments[0].rate).toBeGreaterThan(c.segments[0].rate);
    expect(n.leadInMs).toBeGreaterThan(c.leadInMs);
    const wolfPause = planSpeech('嗯……跟。', wolf, 'neutral', mid).segments[0].pauseAfterMs;
    const rabbitPause = planSpeech('嗯……跟。', rabbit, 'neutral', mid).segments[0].pauseAfterMs;
    expect(wolfPause).not.toBe(rabbitPause);
    expect(VOICE_PROFILES.rabbit.natural.pitch.variation).toBeGreaterThan(VOICE_PROFILES.wolf.natural.pitch.variation);
  });

  it('每次播放有轻微自然变化，但不会超出角色范围；“平直”对比模式与机器人预设没有变化', () => {
    const rng = seededRandom(7);
    const pitches = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const s = planSpeech('全部压上来了？有意思。', wolf, 'surprised', rng);
      for (const g of s.segments) {
        pitches.add(g.pitch);
        expect(g.pitch).toBeGreaterThan(0.1);
        expect(g.pitch).toBeLessThanOrEqual(2);
        expect(g.rate).toBeGreaterThanOrEqual(0.5);
        expect(g.volume).toBeLessThanOrEqual(1);
        expect(Math.abs(g.pitch / wolf.pitch - 1)).toBeLessThan(0.3); // 变化很轻，不是变声
      }
    }
    expect(pitches.size).toBeGreaterThan(5);
    const flat = planSpeech('嗯……我跟。', wolf, 'confident', rng, { natural: false });
    expect(flat.segments).toHaveLength(1);
    expect(flat.leadInMs).toBe(0);
    const robot = resolveVoiceProfile({ species: 'wolf', voice: { preset: 'robot', pitch: 0, rate: 0 } });
    expect(planSpeech('嗯……我跟。', robot, 'confident', rng).natural).toBe(false);
  });

  it('时间轴：说话段之间有停顿（口型在停顿时闭嘴）', () => {
    const plan = planSpeech('嗯……那我就……跟。', wolf, 'confident', mid);
    const { windows, totalMs } = planTimeline(plan);
    expect(windows).toHaveLength(3);
    for (let i = 1; i < windows.length; i++) expect(windows[i][0]).toBeGreaterThan(windows[i - 1][1] + 200);
    expect(totalMs).toBeGreaterThan(windows.at(-1)![1] - 1);
  });
});

describe('情境台词与不重复', () => {
  it('同一个事件：牌好 / 牌差 / 诈唬说的话不一样；没有情境时不会乱说情境台词', () => {
    const wolfSp = { id: 'w', species: 'wolf' as const, isAI: true };
    expect(pickLine(wolfSp, 'react_allin', () => 0, { strength: 'strong' })!.text).toBe('终于忍不住了？');
    expect(pickLine(wolfSp, 'react_allin', () => 0, { strength: 'weak' })!.text).toBe('……这下难办了。');
    expect(pickLine(wolfSp, 'raise', () => 0, { bluff: true })!.text).toBe('来啊。');
    const rng = seededRandom(3);
    for (let i = 0; i < 200; i++) {
      const l = pickLine(wolfSp, 'react_allin', rng)!;
      expect(dialogueById(l.ref.id)!.when).toBeUndefined();
    }
  });

  it('同一只动物不会连着重复同一句', () => {
    const d = new DialogueDirector(() => 0, { minIntervalMs: 0, perSpeakerMs: 0, maxPerHand: 99 });
    const said: string[] = [];
    for (let i = 0; i < 4; i++) said.push(d.consider({ id: 'w', species: 'wolf', isAI: true }, 'react_allin', i, i * 100000)!.text);
    expect(new Set(said).size).toBe(4);
    // 状态可以保存 / 恢复（在线房间存 Redis）
    const again = new DialogueDirector(() => 0, { minIntervalMs: 0, perSpeakerMs: 0, maxPerHand: 99 }, JSON.parse(JSON.stringify(d.toState())));
    // 4 句普通台词都说过了：第 5 次选最久以前说的那句，绝不连着重复
    const fifth = again.consider({ id: 'w', species: 'wolf', isAI: true }, 'react_allin', 9, 1e7)!.text;
    expect(fifth).toBe(said[0]);
    expect(fifth).not.toBe(said.at(-1));
  });

  it('思考台词（“嗯……让我想想”）有独立冷却：每手最多一句，不占普通台词名额', () => {
    const d = new DialogueDirector(() => 0);
    const sp = { id: 'f', species: 'fox' as const, isAI: true };
    expect(d.consider(sp, 'think', 1, 100000)?.ref.event).toBe('think');
    expect(d.consider(sp, 'think', 1, 200000)).toBeNull(); // 同一手
    expect(d.consider(sp, 'think', 2, 105000)).toBeNull(); // 20 秒冷却
    expect(d.consider(sp, 'raise', 2, 106000)).not.toBeNull(); // 普通台词不受影响
    expect(d.consider({ ...sp, isAI: false }, 'think', 3, 999999)).toBeNull(); // 真人玩家的动物不会自己“想”
  });

  it('台词是口语，不是书面语', () => {
    const formal = /(根据|认为|策略|采取|因此|然而|鉴于|局势|分析)/;
    for (const table of Object.values(DIALOGUE)) for (const lines of Object.values(table)) for (const l of lines!) expect(l.text, l.text).not.toMatch(formal);
  });
});

describe('分段播放（假的浏览器语音合成）', () => {
  it('开口前停顿 → 第一段 → 停顿 → 第二段，每段参数不同；回调顺序正确', async () => {
    vi.useFakeTimers();
    try {
      const f = fakeEnv([{ name: 'Reed', lang: 'zh-CN' }]);
      const m = new VoiceManager(f.env);
      const plan = planSpeech('嗯……我跟。', wolf, 'confident', mid);
      const log: string[] = [];
      const done = m.speak('嗯……我跟。', wolf, {
        emotion: 'confident',
        plan,
        onStart: () => log.push('start'),
        onSegment: (i) => log.push(`seg${i}`),
        onPause: (i, ms) => log.push(`pause${i}:${ms}`),
        onEnd: () => log.push('end'),
      });
      expect(f.spoken).toHaveLength(0); // 还在“吸气”
      await vi.advanceTimersByTimeAsync(plan.leadInMs + 5);
      expect(f.spoken.map((u) => u.text)).toEqual(['嗯']);
      f.spoken[0].onend();
      expect(f.spoken).toHaveLength(1); // 停顿中
      await vi.advanceTimersByTimeAsync(plan.segments[0].pauseAfterMs + 5);
      expect(f.spoken.map((u) => u.text)).toEqual(['嗯', '我跟。']);
      expect(f.spoken[0].pitch).not.toBe(f.spoken[1].pitch);
      expect(f.spoken[0].volume).toBeLessThan(f.spoken[1].volume);
      f.spoken[1].onend();
      expect(await done).toBe('spoken');
      expect(log).toEqual(['start', 'seg0', `pause0:${plan.segments[0].pauseAfterMs}`, 'seg1', 'end']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('停顿中被全押打断：旧台词立刻停止，剩下的半句不会再说', async () => {
    vi.useFakeTimers();
    try {
      const f = fakeEnv([{ name: 'Reed', lang: 'zh-CN' }]);
      const m = new VoiceManager(f.env);
      const plan = planSpeech('我觉得你这次……在诈唬。', wolf, 'confident', mid);
      const old = m.speak('我觉得你这次……在诈唬。', wolf, { plan, priority: 1 });
      await vi.advanceTimersByTimeAsync(plan.leadInMs + 5);
      f.spoken[0].onend(); // 进入停顿
      const react = m.speak('……什么？', wolf, { emotion: 'surprised', priority: 3, natural: false });
      expect(await old).toBe('interrupted');
      await vi.advanceTimersByTimeAsync(3000);
      expect(f.spoken.map((u) => u.text)).toEqual(['我觉得你这次', '什么？']);
      f.spoken[1].onend();
      expect(await react).toBe('spoken');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('设备句尾静音补偿', () => {
  it('结巴段可以合回一句（句尾静音很长的设备上，分开读会变成停顿）', () => {
    const plan = planSpeech('等、等一下！你真的要全押吗？！', rabbit, 'surprised', mid);
    expect(plan.segments.map((x) => x.kind)).toEqual(['stutter', 'phrase', 'phrase']);
    expect(mergeStutters(plan.segments).map((x) => x.text)).toEqual(['等、等一下！', '你真的要全押吗？！']);
    expect(mergeStutters(planSpeech('我跟。', wolf, 'neutral', mid).segments).map((x) => x.text)).toEqual(['我跟。']);
  });
});

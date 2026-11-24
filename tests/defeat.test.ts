// 失败演出：触发条件（只读真实结果）、时间表、转头顺序、去重、桌面反应、设备档位、动画
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import {
  COLLAPSE_BY_SPECIES,
  FULL_TIMELINE,
  PHASE_ORDER,
  REALIZE_BY_SPECIES,
  REALIZE_BY_TEMPERAMENT,
  WINNER_LINE,
  defeatTemperament,
  BYSTANDER_REACTION,
  SHORT_MIN_MS,
  buildTimeline,
  defeatProfile,
  defeatVerdict,
  lookOrder,
  phaseAt,
  phaseEnd,
  winnerStyle,
  WINNER_REACTION,
  DECAP_CUT_MS,
  EXECUTION_REACTION,
  HEADLESS_COLLAPSE,
  LAST_WORDS,
} from '../src/animation/defeat/defeatRules';
import { headLaunch, sampleHeadFall, simulateHeadFall } from '../src/animation/defeat/decapitation';
import { CHAIR_LAND_S, beginDefeat, chairJolt, endDefeat, resetDefeatForTest, tableJolt, useDefeat, type DefeatSequence } from '../src/animation/defeat/defeatStore';
import { animatePose, basePose } from '../src/animation/animalAnimations';
import { ANIM_DURATION, type AnimName } from '../src/store/fxStore';
import type { TableView } from '../src/core/game/view';
import type { Species } from '../src/core/player/profile';

const ALL_SPECIES: Species[] = ['cat', 'dog', 'fox', 'panda', 'rabbit', 'bear', 'raccoon', 'frog', 'lion', 'tiger', 'koala', 'monkey', 'penguin', 'wolf', 'dragon'];

function seat(id: string, o: Record<string, unknown> = {}) {
  return { id, name: id, seat: 0, chips: 0, bet: 0, totalBet: 0, folded: false, allIn: false, inHand: true, sittingOut: false, busted: false, isAI: id !== 'me', connected: true, profile: { animal: { species: 'cat' } }, lastAction: null, hole: [], ...o };
}
function view(players: ReturnType<typeof seat>[], events: unknown[] = [], bigBlind = 20): TableView {
  return { viewerId: 'me', handNumber: 5, phase: 'complete', board: [], potCollected: 0, potTotal: 0, pots: [], currentBet: 0, currentPlayerId: null, dealerId: null, sbId: null, bbId: null, smallBlind: bigBlind / 2, bigBlind, players, legal: null, turnDeadline: null, turnTotalMs: 0, events, summary: null, gameOver: null, nextHandAt: null, serverTime: 0, paused: false } as unknown as TableView;
}

beforeEach(() => resetDefeatForTest());

describe('触发条件：只读取真实的牌局结果', () => {
  it('DEF-01 摊牌输光 → 完整版；输掉一半以上（且至少 10 个大盲）→ 简短版；小额输 / 弃牌 / 无人跟注 / 赢了任意一个池 → 不演', () => {
    // 输光
    expect(defeatVerdict(view([seat('me', { chips: 0, totalBet: 1000 }), seat('a', { chips: 2000 })]), ['a'], false)).toEqual({ cut: 'full', lost: 1000, ratio: 1 });
    // 输掉 600 / 1000
    const heavy = defeatVerdict(view([seat('me', { chips: 400, totalBet: 600 }), seat('a')]), ['a'], false);
    expect(heavy?.cut).toBe('short');
    expect(heavy?.ratio).toBeCloseTo(0.6);
    // 只输 30%
    expect(defeatVerdict(view([seat('me', { chips: 700, totalBet: 300 }), seat('a')]), ['a'], false)).toBeNull();
    // 输了一半以上，但金额不到 10 个大盲（很小的筹码量）→ 不演
    expect(defeatVerdict(view([seat('me', { chips: 50, totalBet: 150 }), seat('a')]), ['a'], false)).toBeNull();
    // 弃牌、没有摊牌
    expect(defeatVerdict(view([seat('me', { chips: 0, totalBet: 1000, folded: true }), seat('a')]), ['a'], false)).toBeNull();
    expect(defeatVerdict(view([seat('me', { chips: 0, totalBet: 1000 }), seat('a')]), ['a'], true)).toBeNull();
    // 赢了边池（即使主池输了）→ 不算失败
    expect(defeatVerdict(view([seat('me', { chips: 0, totalBet: 1000 }), seat('a')]), ['a', 'me'], false)).toBeNull();
    // 本手没参与
    expect(defeatVerdict(view([seat('me', { chips: 0, inHand: false }), seat('a')]), ['a'], false)).toBeNull();
  });

  it('DEF-02 退回的多余下注不算输掉', () => {
    // 下注 1000，退回 600（对手筹码不够），实际只输 400 / 1000 → 不演
    const v = view([seat('me', { chips: 600, totalBet: 1000 }), seat('a')], [{ seq: 9, type: 'refund', playerId: 'me', amount: 600 }]);
    expect(defeatVerdict(v, ['a'], false)).toBeNull();
    // 退回 200：实际输 800 / 1000 → 简短版
    const v2 = view([seat('me', { chips: 200, totalBet: 1000 }), seat('a')], [{ seq: 9, type: 'refund', playerId: 'me', amount: 200 }]);
    expect(defeatVerdict(v2, ['a'], false)).toMatchObject({ cut: 'short', lost: 800 });
  });
});

describe('时间表', () => {
  it('DEF-03 完整版（出局处决）：阶段按顺序推进，最后是“出局”画面；处决前有一段完全安静', () => {
    const tl = buildTimeline('full', null)!;
    let last = -1;
    for (const ph of PHASE_ORDER) {
      const t = tl.times[ph];
      if (t === undefined) continue;
      expect(t).toBeGreaterThan(last);
      last = t;
    }
    expect(FULL_TIMELINE.impact! - FULL_TIMELINE.silence!).toBeGreaterThanOrEqual(150);
    expect(FULL_TIMELINE.impact! - FULL_TIMELINE.silence!).toBeLessThanOrEqual(400);
    expect(phaseAt(tl.times, 0)).toBe('result');
    expect(phaseAt(tl.times, FULL_TIMELINE.impact! + 1)).toBe('impact');
    expect(phaseAt(tl.times, 99999)).toBe('defeated');
    // 顺序：输家先意识到 → 赢家反应 → 所有人转头 → 灯光变暗 → 最后一句话 → 处决准备 → 眼睛特写 → 静止
    //       → 处决（切开）→ 头部落入画面 → 身体倒下 → 余波 → 黑屏 → 出局
    const order = ['realize', 'winner', 'reaction', 'tension', 'lastword', 'prep', 'ecu', 'silence', 'impact', 'headfall', 'collapse', 'aftermath', 'blackout', 'defeated'] as const;
    for (let i = 1; i < order.length; i++) expect(FULL_TIMELINE[order[i]]!).toBeGreaterThan(FULL_TIMELINE[order[i - 1]]!);
    // 不赶：冲击前至少 8 秒的铺垫，余波至少 2 秒，黑屏不超过 1 秒
    expect(FULL_TIMELINE.impact!).toBeGreaterThanOrEqual(8000);
    expect(FULL_TIMELINE.blackout! - FULL_TIMELINE.aftermath!).toBeGreaterThanOrEqual(2000);
    expect(FULL_TIMELINE.defeated! - FULL_TIMELINE.blackout!).toBeLessThanOrEqual(1000);
    expect(phaseEnd(tl.times, 'defeated')).toBe(Infinity);
    // 镜头切开（桌面）的时间足够让头部在切回之前离开身体；切回时头部还在空中
    expect(DECAP_CUT_MS).toBeLessThan(FULL_TIMELINE.headfall! - FULL_TIMELINE.impact!);
    expect(FULL_TIMELINE.headfall! - FULL_TIMELINE.impact! - DECAP_CUT_MS).toBeLessThan(500);
    // 完整版没有旧的“环境特写”；简短版（还没出局）没有处决
    expect(FULL_TIMELINE.insert).toBeUndefined();
    const short = buildTimeline('short', null)!.times;
    for (const ph of ['lastword', 'prep', 'headfall', 'collapse'] as const) expect(short[ph]).toBeUndefined();
  });

  it('DEF-04 简短版必须在下一手开始前演完：按剩余时间压缩，时间不够就不演（不拖延牌局）', () => {
    const tl = buildTimeline('short', 3400)!;
    expect(tl.scale).toBeLessThan(1);
    expect(Math.max(...Object.values(tl.times) as number[])).toBeLessThanOrEqual(3400);
    expect(buildTimeline('short', SHORT_MIN_MS - 1)).toBeNull();
    expect(buildTimeline('short', 99999)!.scale).toBe(1);
  });

  it('DEF-05 其他动物一个接一个看向输家：赢家最先，间隔 0.15~0.35 秒，不包括输家和已出局的玩家', () => {
    const players = [seat('me'), seat('a'), seat('w'), seat('b'), seat('gone', { busted: true })];
    const order = lookOrder(players as never, 'me', 'w', () => 0.5);
    expect(order.map((o) => o.id)).toEqual(['w', 'a', 'b']);
    expect(order[0].delay).toBe(0);
    for (let i = 1; i < order.length; i++) {
      const gap = order[i].delay - order[i - 1].delay;
      expect(gap).toBeGreaterThanOrEqual(150);
      expect(gap).toBeLessThanOrEqual(350);
    }
  });
});

describe('演出状态', () => {
  const seq = (key: string): DefeatSequence => ({
    key,
    hand: 1,
    cut: 'full',
    loserId: 'me',
    winnerId: 'a',
    at: { result: 1000, impact: 2000 },
    lookers: {},
    origin: [0, 4],
    lost: 100,
    ratio: 1,
    profile: defeatProfile({ mobile: false, quality: 'high', reduced: false }),
    reduced: false,
  });

  it('DEF-06 同一个结果（手数 + 事件序号）只演一次：重复事件不会造成重复演出', () => {
    expect(beginDefeat(seq('5:30'))).toBe(true);
    expect(beginDefeat(seq('5:30'))).toBe(false);
    endDefeat('5:30');
    expect(useDefeat.getState().seq).toBeNull();
    expect(beginDefeat(seq('5:30'))).toBe(false);
    expect(beginDefeat(seq('6:41'))).toBe(true);
    // 记录只保留最近的一部分，不会无限增长
    for (let i = 0; i < 60; i++) {
      endDefeat();
      beginDefeat(seq(`k${i}`));
    }
    expect(useDefeat.getState().played.length).toBeLessThanOrEqual(24);
  });

  it('DEF-07 桌面反应只是画面偏移：冲击前、远处、1.8 秒后都为 0，离冲击中心越近越大', () => {
    expect(tableJolt(0, 4, 2300).lift).toBe(0); // 没有演出
    beginDefeat(seq('j'));
    expect(tableJolt(0, 4, 1999).lift).toBe(0); // 冲击前
    const near = tableJolt(0, 3.6, 2300, 1);
    const far = tableJolt(0, 0.5, 2300, 1);
    expect(near.lift).toBeGreaterThan(0);
    expect(far.lift).toBeLessThan(near.lift);
    expect(tableJolt(0, -4, 2300).lift).toBe(0); // 桌子另一边
    expect(tableJolt(0, 3.6, 2000 + 1900)).toEqual({ lift: 0, rx: 0, rz: 0, dx: 0, dz: 0 }); // 已恢复
    // 环境特写里随心跳轻轻颤动；静止的 0.18 秒完全不动
    endDefeat('j');
    beginDefeat({ ...seq('j2'), at: { result: 0, insert: 1000, silence: 1600, impact: 1780 } });
    let maxLift = 0;
    for (let t = 1000; t < 1600; t += 5) maxLift = Math.max(maxLift, tableJolt(0, 3.6, t, 1).lift);
    expect(maxLift).toBeGreaterThan(0);
    expect(maxLift).toBeLessThan(0.01);
    for (let t = 1600; t < 1780; t += 5) expect(tableJolt(0, 3.6, t, 1).lift).toBe(0);
  });
});

describe('角色与设备', () => {
  it('DEF-08 每种动物都有“意识到输了”、倒下、旁观反应；规格里列出的动物倒下方式各不相同', () => {
    for (const sp of ALL_SPECIES) {
      expect(REALIZE_BY_SPECIES[sp]).toBeTruthy();
      expect(COLLAPSE_BY_SPECIES[sp]).toBeTruthy();
      expect(BYSTANDER_REACTION[sp]).toBeTruthy();
    }
    const listed: Species[] = ['cat', 'fox', 'rabbit', 'bear', 'tiger', 'monkey', 'lion'];
    expect(new Set(listed.map((s) => COLLAPSE_BY_SPECIES[s])).size).toBe(listed.length);
    // 规格里的例子：狮子输了也保持尊严、老虎愤怒但克制、熊猫沉重地趴下
    expect(COLLAPSE_BY_SPECIES.lion).toBe('collapseDignified');
    expect(COLLAPSE_BY_SPECIES.tiger).toBe('collapseSeethe');
    expect(COLLAPSE_BY_SPECIES.panda).toBe('collapseSlump');
    // 赢家按 AI 性格优先，其次按动物
    expect(winnerStyle({ aiPersonality: 'aggressiveFox', profile: { animal: { species: 'panda' } } } as never)).toBe('cocky');
    expect(winnerStyle({ profile: { animal: { species: 'wolf' } } } as never)).toBe('ruthless');
    expect(Object.keys(WINNER_REACTION).sort()).toEqual(['calm', 'cocky', 'elegant', 'playful', 'ruthless']);
    expect(Object.keys(WINNER_LINE).sort()).toEqual(['calm', 'cocky', 'elegant', 'playful', 'ruthless']);
    // 规格：优雅的慢慢收筹码、嚣张的往后靠、冷静的把牌拢过来
    expect(WINNER_REACTION.elegant.anim).toBe('stackChips');
    expect(WINNER_REACTION.cocky.anim).toBe('leanBack');
    expect(WINNER_REACTION.calm.anim).toBe('gatherCards');
  });

  it('DEF-12 “意识到输了”取决于性格：来自项目里的动物性格数据，AI 性格优先；七种性格动作各不相同', () => {
    expect(defeatTemperament('rabbit')).toBe('nervous'); // 紧张
    expect(defeatTemperament('tiger')).toBe('aggressive'); // 急躁
    expect(defeatTemperament('lion')).toBe('elegant'); // 威严
    expect(defeatTemperament('penguin')).toBe('elegant'); // 绅士
    expect(defeatTemperament('cat')).toBe('arrogant'); // 傲娇
    expect(defeatTemperament('monkey')).toBe('playful'); // 调皮
    expect(defeatTemperament('panda')).toBe('calm'); // 佛系
    expect(defeatTemperament('wolf')).toBe('confident'); // 自信
    expect(defeatTemperament('panda', 'aggressiveFox')).toBe('aggressive');
    for (const sp of ALL_SPECIES) expect(REALIZE_BY_SPECIES[sp]).toBe(REALIZE_BY_TEMPERAMENT[defeatTemperament(sp)].anim);
    const anims = Object.values(REALIZE_BY_TEMPERAMENT).map((r) => r.anim);
    expect(new Set(anims).size).toBe(7);
    // 至少用到了五种以上不同的性格（不是所有动物都一样）
    expect(new Set(ALL_SPECIES.map((sp) => defeatTemperament(sp))).size).toBeGreaterThanOrEqual(6);
  });

  it('DEF-13 输家的椅子：冲击后滑出、翘起再落回；只影响输家；跳过 / 演出结束后归零', () => {
    const s: DefeatSequence = {
      key: 'c',
      hand: 1,
      cut: 'full',
      loserId: 'me',
      winnerId: 'a',
      at: { result: 0, impact: 1000 },
      lookers: {},
      origin: [0, 4],
      lost: 1,
      ratio: 1,
      profile: defeatProfile({ mobile: false, quality: 'high', reduced: false }),
      reduced: false,
    };
    beginDefeat(s);
    expect(chairJolt('me', 999, false)).toEqual({ push: 0, tilt: 0 });
    expect(chairJolt('a', 1150, false)).toEqual({ push: 0, tilt: 0 });
    const up = chairJolt('me', 1150, false);
    expect(up.tilt).toBeGreaterThan(0.1);
    expect(up.push).toBeGreaterThan(0.1);
    expect(chairJolt('me', 1150, true).tilt).toBeGreaterThan(up.tilt); // 重的动物椅子反应更大
    expect(chairJolt('me', 1000 + CHAIR_LAND_S * 1000 + 400, false).tilt).toBe(0); // 已经落回地面
    useDefeat.setState({ skipped: true });
    expect(chairJolt('me', 1150, false)).toEqual({ push: 0, tilt: 0 });
    endDefeat('c');
    expect(chairJolt('me', 1150, false)).toEqual({ push: 0, tilt: 0 });
  });

  it('DEF-09 新动画：每一帧的姿态都是有限数值；倒下后保持倒下（不会自己弹回坐姿），直到演出结束', () => {
    const names: AnimName[] = [
      'realizeDisbelief', 'realizePanic', 'realizeFade', 'realizeAccept', 'realizeAnger', 'realizeRecheck', 'realizeDeflate', 'realizeDignity',
      'collapseSlump', 'collapseFaint', 'collapseDignified', 'collapseSeethe', 'collapseDrama', 'collapseAnnoyed', 'collapseEmbarrassed',
      'dread', 'defeatRecoil', 'stackChips', 'leanBack', 'gatherCards', 'stare', 'lookAway', 'whisper', 'shrug', 'uneasy', 'flinch',
      'headlessJolt', 'headlessSlump', 'headlessTopple', 'headlessToppleR', 'composedShock', 'fearFrozen', 'backAway', 'lookDown', 'freeze', 'gravePause',
    ];
    for (const n of names) {
      expect(ANIM_DURATION[n]).toBeGreaterThan(0);
      for (let t = 0; t < Math.min(ANIM_DURATION[n], 6); t += 0.05) {
        const p = animatePose(basePose(t, 1, true, false, false, 'cat'), n, t, true);
        for (const [k, v] of Object.entries(p)) if (k !== 'face') expect(Number.isFinite(v as number)).toBe(true);
      }
    }
    // 熊趴到桌上：10 秒后仍然前倾很多
    const slumped = animatePose(basePose(10, 1, true, false, false, 'bear'), 'collapseSlump', 10, true);
    expect(slumped.lean).toBeGreaterThan(0.6);
    // 兔子向后晕倒
    expect(animatePose(basePose(10, 1, true, false, false, 'rabbit'), 'collapseFaint', 10, true).lean).toBeLessThan(-0.4);
    // 失去头部的身体：倒下后一直保持（向前倒在桌上 / 歪倒在扶手上）
    expect(animatePose(basePose(10, 1, true, false, false, 'bear'), 'headlessSlump', 10, true).lean).toBeGreaterThan(0.8);
    expect(animatePose(basePose(10, 1, true, false, false, 'cat'), 'headlessTopple', 10, true).roll).toBeGreaterThan(0.8);
    expect(animatePose(basePose(10, 1, true, false, false, 'cat'), 'headlessToppleR', 10, true).roll).toBeLessThan(-0.8);
  });

  it('DEF-14 头部掉落：轨迹有限、不会穿过地面、一定会停住；落地有声音时刻；不会飞到别的座位', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const dir: [number, number] = [Math.sin(a), Math.cos(a)];
      const side: [number, number] = [-dir[1], dir[0]];
      const { vel, spin } = headLaunch(dir, side, rand);
      const start: [number, number, number] = [dir[0] * 4.15, 1.6 + rand() * 0.5, dir[1] * 4.15];
      const r = 0.25 + rand() * 0.2;
      const fall = simulateHeadFall({ start, vel, spin, radius: r, floorY: 0.01 });
      expect(fall.restAt).toBeLessThanOrEqual(3.2);
      expect(fall.contacts.length).toBeGreaterThan(0);
      // 第一次落地最重，之后的弹跳越来越轻
      for (let i = 1; i < fall.contacts.length; i++) expect(fall.contacts[i].speed).toBeLessThan(fall.contacts[i - 1].speed);
      for (const sm of fall.samples) {
        for (const v of [...sm.p, ...sm.q]) expect(Number.isFinite(v)).toBe(true);
        expect(sm.p[1]).toBeGreaterThanOrEqual(0.01 + r - 1e-6);
        expect(Math.abs(Math.hypot(...sm.q) - 1)).toBeLessThan(1e-6);
      }
      const end = sampleHeadFall(fall, 99);
      const travel = Math.hypot(end.p[0] - start[0], end.p[2] - start[2]);
      // 落在椅子旁边：至少离开身体 0.8 米，不超过 3 米（8 人桌相邻座位约 3.2 米）
      expect(travel).toBeGreaterThan(0.8);
      expect(travel).toBeLessThan(3);
      // 停在地上
      expect(end.p[1]).toBeCloseTo(0.01 + r, 5);
      // 时间在两个样本之间：插值结果在两端之间
      const mid = sampleHeadFall(fall, fall.contacts[0].t / 2);
      expect(mid.p[1]).toBeGreaterThan(0.01 + r);
    }
  });

  it('DEF-15 出局处决：每种动物都有最后一句话、倒下方式、处决后的反应；规格里列出的反应', () => {
    for (const sp of ALL_SPECIES) {
      expect(LAST_WORDS[sp].text.length).toBeGreaterThan(0);
      expect([...LAST_WORDS[sp].text].length).toBeLessThanOrEqual(12); // 很短
      expect(['headlessSlump', 'headlessTopple']).toContain(HEADLESS_COLLAPSE[sp]);
      expect(EXECUTION_REACTION[sp].anim).toBeTruthy();
    }
    expect(LAST_WORDS.wolf.text).toContain('结束');
    expect(LAST_WORDS.rabbit.text).toContain('等');
    expect(LAST_WORDS.fox.text).toContain('不');
    expect(EXECUTION_REACTION.cat.anim).toBe('composedShock');
    expect(EXECUTION_REACTION.rabbit.anim).toBe('fearFrozen');
    expect(EXECUTION_REACTION.fox.anim).toBe('backAway');
    expect(EXECUTION_REACTION.bear.anim).toBe('lookDown');
    expect(EXECUTION_REACTION.panda.anim).toBe('freeze');
    expect(EXECUTION_REACTION.monkey.anim).toBe('freeze');
    expect(EXECUTION_REACTION.tiger.anim).toBe('stare');
    expect(EXECUTION_REACTION.wolf.anim).toBe('stare');
    expect(EXECUTION_REACTION.lion.anim).toBe('gravePause');
  });

  it('DEF-10 手机档位：粒子更少、镜头震动更小；减少动态效果：不震动、闪光很弱、镜头几乎不动', () => {
    const desk = defeatProfile({ mobile: false, quality: 'high', reduced: false });
    const phone = defeatProfile({ mobile: true, quality: 'high', reduced: false });
    const calm = defeatProfile({ mobile: true, quality: 'high', reduced: true });
    expect(phone.smoke).toBeLessThan(desk.smoke);
    expect(phone.debris).toBeLessThan(desk.debris);
    expect(phone.shake).toBeLessThan(desk.shake);
    expect(calm.shake).toBe(0);
    expect(calm.flash).toBeLessThanOrEqual(0.3);
    expect(calm.move).toBeLessThan(0.3);
    // 手机：烟雾贴图分辨率更低、碎片不投射阴影，火星更少
    expect(phone.smokeRes).toBeLessThan(desk.smokeRes);
    expect(phone.shadows).toBe(false);
    expect(phone.sparks).toBeLessThanOrEqual(desk.sparks);
    // 节奏不变：时间表与设备无关
    expect(buildTimeline('full', null)!.times).toEqual(FULL_TIMELINE);
  });

  it('DEF-11 演出只是画面表现：不发送任何网络消息、不修改牌局；风格化，没有写实的血腥元素', () => {
    const read = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    const director = read('../src/animation/defeat/useDefeatDirector.ts');
    expect(director).not.toMatch(/net\.|session\.(action|chat|start)|\.send\(/);
    for (const f of ['../src/animation/defeat/defeatRules.ts', '../src/animation/defeat/defeatStore.ts', '../src/three/effects/DefeatFX.tsx', '../src/ui/game/hud/DefeatOverlay.tsx']) {
      const src = read(f);
      expect(src).not.toMatch(/blood|gore|wound|血液喷|伤口特写/i);
      expect(src).not.toMatch(/location\.reload/);
    }
  });
});

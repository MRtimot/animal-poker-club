// 失败演出的规则（纯函数，不碰界面 / 3D / 声音，便于测试）
// · 什么时候演：牌局结果完全来自服务器 / 本地引擎（win 事件与座位筹码），这里只“读”结果，不改变任何牌局状态
// · 演多久：每个阶段的时间表（完整版：出局；简短版：大额失利但还有筹码，必须在下一手开始前演完，不拖延牌局）
// · 谁怎么反应：按动物种类与 AI 性格选择不同的动作
import type { TableView, SeatView } from '../../core/game/view';
import type { Species } from '../../core/player/profile';
import type { AIPersonality } from '../../core/ai/ai';
import { PERSONALITIES_BY_SPECIES } from '../../core/character/voice';
import type { AnimalEmotion } from '../../core/character/voice';
import type { AnimName, MoodFace } from '../../store/fxStore';

/**
 * full：出局（筹码输光）——完整的电影化演出，最后是“出局”画面，由玩家决定继续
 * short：一手牌输掉了一半以上的筹码（还没出局）——压缩版，在下一手开始前结束
 */
export type DefeatCut = 'full' | 'short';

/** 简短版的触发条件：输掉本手开始时筹码的这个比例以上，并且至少这么多个大盲 */
export const HEAVY_LOSS_RATIO = 0.5;
export const HEAVY_LOSS_MIN_BB = 10;

export interface DefeatVerdict {
  cut: DefeatCut;
  /** 本手实际输掉的筹码（已扣除退回的多余下注） */
  lost: number;
  /** 输掉的筹码占本手开始时筹码的比例 0~1 */
  ratio: number;
}

/**
 * 根据一手牌的真实结果判断观看者（自己）是否需要失败演出。
 * 只在摊牌后才可能触发（对手弃牌让你赢 / 你自己弃牌都不算），赢得任何一个池（包括边池）也不算失败。
 */
export function defeatVerdict(view: TableView, winnerIds: Iterable<string>, uncontested: boolean): DefeatVerdict | null {
  if (uncontested) return null;
  const me = view.players.find((p) => p.id === view.viewerId);
  if (!me || !me.inHand || me.folded) return null;
  const winners = new Set(winnerIds);
  if (winners.has(me.id)) return null;
  // 多余的下注会退回（refund 事件，筹码已经加回），不算输掉
  let refund = 0;
  for (const e of view.events) if (e.type === 'refund' && e.playerId === me.id) refund += e.amount;
  const lost = Math.max(0, me.totalBet - refund);
  const startStack = me.chips + lost;
  if (lost <= 0 || startStack <= 0) return null;
  const ratio = lost / startStack;
  if (me.chips === 0) return { cut: 'full', lost, ratio: 1 };
  if (ratio >= HEAVY_LOSS_RATIO && lost >= HEAVY_LOSS_MIN_BB * view.bigBlind) return { cut: 'short', lost, ratio };
  return null;
}

// ───────────────────────── 时间表 ─────────────────────────

/** 演出阶段（与镜头分镜一一对应） */
export type DefeatPhase =
  | 'result' // 结果揭晓：全景（赢家演出仍在显示），房间声音开始被“抽走”
  | 'realize' // 输家特写：意识到输了（缓慢推近），倒吸一口气、心跳开始
  | 'winner' // 赢家特写：赢家按性格反应
  | 'reaction' // 反应镜头：其他动物一个接一个转头看向输家（跟焦）
  | 'tension' // 过肩镜头：灯光变暗、深红的点缀光，所有人都盯着输家
  | 'lastword' // （完整版）输家特写：最后一句很短的话（字幕 + 角色语音）
  | 'prep' // （完整版）处决准备：镜头从中景慢慢推到近景，输家看向处决者（赢家），心跳越来越响
  | 'ecu' // 极近特写：输家的眼睛，心跳与呼吸占满声音
  | 'insert' // （简短版不用；保留给旧的环境特写）
  | 'silence' // 一切突然停止（完全安静）
  | 'impact' // 冲击。完整版：处决的一瞬间——镜头切开到桌面、刀光一闪、闪光、重击声，头部在这一刻脱离身体
  | 'headfall' // （完整版）镜头切回：头部正落入画面，翻滚、落地、弹一下、滚动、停住
  | 'collapse' // （完整版）失去头部的身体失去支撑，倒下
  | 'aftermath' // 余波：死寂、镜头慢慢后退、散落的牌与筹码、灯光闪烁、所有人僵住
  | 'blackout' // 黑屏
  | 'defeated' // “出局”画面（等待玩家）/ 简短版的字幕
  | 'recover'; // 恢复：镜头、灯光、声音回到牌桌

export const PHASE_ORDER: DefeatPhase[] = ['result', 'realize', 'winner', 'reaction', 'tension', 'lastword', 'prep', 'ecu', 'insert', 'silence', 'impact', 'headfall', 'collapse', 'aftermath', 'blackout', 'defeated', 'recover'];

/** 完整版：每个阶段的开始时间（毫秒，从赢家演出开始算起）；defeated 之后等玩家选择 */
export const FULL_TIMELINE: Partial<Record<DefeatPhase, number>> = {
  result: 0,
  realize: 1300,
  winner: 3000,
  reaction: 4200,
  tension: 5600,
  lastword: 6900,
  prep: 8700,
  ecu: 9900,
  silence: 11100,
  impact: 11350,
  headfall: 11700,
  collapse: 12700,
  aftermath: 13900,
  blackout: 17000,
  defeated: 17800,
};

/** 处决：头部在冲击开始后多久脱离身体（与重击声、闪光的峰值对齐；这时镜头正切开到桌面） */
export const DECAP_CUT_MS = 90;

/** 简短版（基准时间，会按下一手开始前剩余的时间压缩）：没有赢家特写、过肩、极近特写与环境特写，没有黑屏 */
export const SHORT_TIMELINE: Partial<Record<DefeatPhase, number>> = {
  result: 0,
  realize: 900,
  reaction: 1700,
  silence: 2400,
  impact: 2540,
  aftermath: 3000,
  defeated: 3150,
  recover: 4300,
};
/** 简短版至少需要的时间：不够就不演（不为了演出拖延下一手） */
export const SHORT_MIN_MS = 2600;
const SHORT_BASE_MS = 4300;
/** 简短版最多压缩到这个比例（再短就看不清了，直接不演） */
const SHORT_MIN_SCALE = 0.62;

/** 计算这一次演出的时间表；返回 null 表示时间不够、不演 */
export function buildTimeline(cut: DefeatCut, availableMs: number | null): { times: Partial<Record<DefeatPhase, number>>; scale: number } | null {
  if (cut === 'full') return { times: { ...FULL_TIMELINE }, scale: 1 };
  const avail = availableMs ?? SHORT_BASE_MS;
  if (avail < SHORT_MIN_MS) return null;
  const scale = Math.min(1, avail / SHORT_BASE_MS);
  if (scale < SHORT_MIN_SCALE) return null;
  const times: Partial<Record<DefeatPhase, number>> = {};
  for (const [k, v] of Object.entries(SHORT_TIMELINE)) times[k as DefeatPhase] = Math.round((v as number) * scale);
  return { times, scale };
}

/** 某一时刻所处的阶段（times 为相对时间） */
export function phaseAt(times: Partial<Record<DefeatPhase, number>>, t: number): DefeatPhase {
  let cur: DefeatPhase = 'result';
  for (const ph of PHASE_ORDER) {
    const at = times[ph];
    if (at !== undefined && t >= at) cur = ph;
  }
  return cur;
}

/** 某个阶段的结束时间（下一个存在的阶段开始的时刻）；最后一个阶段返回 Infinity */
export function phaseEnd(times: Partial<Record<DefeatPhase, number>>, ph: DefeatPhase): number {
  const i = PHASE_ORDER.indexOf(ph);
  for (let k = i + 1; k < PHASE_ORDER.length; k++) {
    const at = times[PHASE_ORDER[k]];
    if (at !== undefined) return at;
  }
  return Infinity;
}

/** 其他动物一个接一个转头看向输家：每个间隔 0.15~0.35 秒（赢家最先） */
export function lookOrder(players: SeatView[], loserId: string, winnerId: string | null, rand: () => number = Math.random, scale = 1): { id: string; delay: number }[] {
  const others = players.filter((p) => p.id !== loserId && !p.busted && !p.sittingOut);
  others.sort((a, b) => (a.id === winnerId ? -1 : b.id === winnerId ? 1 : 0));
  let t = 0;
  return others.map((p, i) => {
    if (i > 0) t += (150 + rand() * 200) * scale;
    return { id: p.id, delay: Math.round(t) };
  });
}

// ───────────────────────── 角色反应 ─────────────────────────

/**
 * 输家的性格（决定“意识到输了”的方式），来自项目里每种动物的性格数据（PERSONALITIES_BY_SPECIES 的性格标签），
 * AI 玩家优先使用 AI 性格。
 */
export type DefeatTemperament = 'confident' | 'arrogant' | 'nervous' | 'calm' | 'aggressive' | 'playful' | 'elegant';

/** 性格标签 → 性格（按顺序匹配，越靠前越优先） */
const TRAIT_TEMPERAMENT: [string, DefeatTemperament][] = [
  ['紧张', 'nervous'],
  ['急躁', 'aggressive'],
  ['威严', 'elegant'],
  ['绅士', 'elegant'],
  ['傲娇', 'arrogant'],
  ['狡猾', 'arrogant'],
  ['小心', 'nervous'],
  ['调皮', 'playful'],
  ['疯狂', 'playful'],
  ['热情', 'playful'],
  ['佛系', 'calm'],
  ['稳重', 'calm'],
  ['温和', 'calm'],
  ['自信', 'confident'],
  ['强大', 'confident'],
];
const TEMPERAMENT_BY_AI: Record<AIPersonality, DefeatTemperament> = {
  aggressiveFox: 'aggressive',
  cautiousPanda: 'calm',
  crazyFrog: 'playful',
  smartCat: 'arrogant',
  luckyRabbit: 'nervous',
};

export function defeatTemperament(species: Species, aiPersonality?: AIPersonality | null): DefeatTemperament {
  if (aiPersonality && TEMPERAMENT_BY_AI[aiPersonality]) return TEMPERAMENT_BY_AI[aiPersonality];
  const p = PERSONALITIES_BY_SPECIES[species];
  if (!p) return 'calm';
  for (const [trait, t] of TRAIT_TEMPERAMENT) if (p.personalityTraits.includes(trait)) return t;
  if (p.aggression >= 0.8) return 'aggressive';
  if (p.confidence >= 0.8) return 'confident';
  if (p.humor >= 0.8) return 'playful';
  return 'calm';
}

/**
 * 输家“意识到输了”：自信的自信慢慢泄掉、傲慢的低头再看一遍牌、紧张的立刻慌张、冷静的慢慢接受、
 * 好斗的明显恼火、爱玩的笑容消失、优雅的努力保持体面
 */
export const REALIZE_BY_TEMPERAMENT: Record<DefeatTemperament, { anim: AnimName; face: MoodFace; emoji: string }> = {
  confident: { anim: 'realizeDeflate', face: 'wide', emoji: '😶' },
  arrogant: { anim: 'realizeRecheck', face: 'doubt', emoji: '🤨' },
  nervous: { anim: 'realizePanic', face: 'wide', emoji: '😨' },
  calm: { anim: 'realizeAccept', face: 'sad', emoji: '😔' },
  aggressive: { anim: 'realizeAnger', face: 'angry', emoji: '😠' },
  playful: { anim: 'realizeFade', face: 'wide', emoji: '😶' },
  elegant: { anim: 'realizeDignity', face: 'normal', emoji: '😐' },
};

/** 冲击前（灯光变暗到极近特写）输家脸上的表情：害怕 / 恼火 / 难过 */
export const DREAD_FACE: Record<DefeatTemperament, MoodFace> = {
  confident: 'wide',
  arrogant: 'doubt',
  nervous: 'wide',
  calm: 'sad',
  aggressive: 'angry',
  playful: 'wide',
  elegant: 'sad',
};

/** 每种动物（没有 AI 性格时）的“意识到输了”动作 */
export const REALIZE_BY_SPECIES = Object.fromEntries(
  (Object.keys(PERSONALITIES_BY_SPECIES) as Species[]).map((sp) => [sp, REALIZE_BY_TEMPERAMENT[defeatTemperament(sp)].anim]),
) as Record<Species, AnimName>;

/** 冲击后的倒下方式：每种动物不同（夸张的喜剧式倒下，没有任何伤口或血腥画面） */
export const COLLAPSE_BY_SPECIES: Record<Species, AnimName> = {
  cat: 'collapseAnnoyed', // 先不相信，然后恼火地瞪着，慢慢滑下去
  fox: 'collapseEmbarrassed', // 先震惊，然后尴尬地笑着滑下椅子
  raccoon: 'collapseEmbarrassed',
  rabbit: 'collapseFaint', // 明显惊慌，向后晕倒在椅背上
  frog: 'collapseFaint',
  penguin: 'collapseFaint',
  dog: 'collapseFaint',
  bear: 'collapseSlump', // 沉重地倒向椅子 / 趴到桌上
  panda: 'collapseSlump', // 慢慢趴下
  koala: 'collapseSlump',
  tiger: 'collapseSeethe', // 愤怒但克制：双拳压在桌上发抖、盯着赢家，慢慢低头
  wolf: 'collapseDignified',
  dragon: 'collapseDignified',
  monkey: 'collapseDrama', // 极其夸张地抱头，摇晃后侧倒
  lion: 'collapseDignified', // 输了也要保持尊严：后仰一下，然后慢慢低头闭眼，仍然坐直
};

/** 赢家的性格：优雅 / 嚣张 / 冷酷 / 爱玩 / 冷静 */
export type WinnerStyle = 'elegant' | 'cocky' | 'ruthless' | 'playful' | 'calm';

const STYLE_BY_PERSONALITY: Record<AIPersonality, WinnerStyle> = {
  aggressiveFox: 'cocky',
  cautiousPanda: 'calm',
  crazyFrog: 'playful',
  smartCat: 'elegant',
  luckyRabbit: 'playful',
};
const STYLE_BY_SPECIES: Record<Species, WinnerStyle> = {
  cat: 'elegant',
  fox: 'cocky',
  raccoon: 'cocky',
  wolf: 'ruthless',
  tiger: 'ruthless',
  dragon: 'ruthless',
  lion: 'elegant',
  frog: 'playful',
  monkey: 'playful',
  rabbit: 'playful',
  dog: 'playful',
  panda: 'calm',
  bear: 'calm',
  koala: 'calm',
  penguin: 'calm',
};

export function winnerStyle(p: Pick<SeatView, 'aiPersonality' | 'profile'>): WinnerStyle {
  if (p.aiPersonality && STYLE_BY_PERSONALITY[p.aiPersonality]) return STYLE_BY_PERSONALITY[p.aiPersonality];
  return STYLE_BY_SPECIES[p.profile.animal.species] ?? 'elegant';
}

/** 赢家反应：优雅的浅浅一笑、慢慢收好筹码；嚣张的往后一靠看着输家；冷酷的面无表情；爱玩的庆祝；冷静的只是把牌拢过来 */
export const WINNER_REACTION: Record<WinnerStyle, { anim: AnimName; face: MoodFace; emoji: string }> = {
  elegant: { anim: 'stackChips', face: 'smug', emoji: '🙂' },
  cocky: { anim: 'leanBack', face: 'smug', emoji: '😏' },
  ruthless: { anim: 'stare', face: 'doubt', emoji: '😐' },
  playful: { anim: 'clap', face: 'happy', emoji: '😆' },
  calm: { anim: 'gatherCards', face: 'normal', emoji: '😌' },
};

/** 余波里赢家的一句很短的话（使用现有的角色语音与优先级队列；同一时间只有一个角色说话） */
export const WINNER_LINE: Record<WinnerStyle, { text: string; emotion: AnimalEmotion }> = {
  elegant: { text: '承让了。', emotion: 'confident' },
  cocky: { text: '就这？', emotion: 'sarcastic' },
  ruthless: { text: '……下一个。', emotion: 'neutral' },
  playful: { text: '哈哈哈！', emotion: 'excited' },
  calm: { text: '嗯。', emotion: 'neutral' },
};

/** 旁观者的反应：笑、倒吸一口气、盯着看、移开视线、小声议论、耸肩、坐立不安 */
export const BYSTANDER_REACTION: Record<Species, { anim: AnimName; face: MoodFace; emoji: string }> = {
  frog: { anim: 'laugh', face: 'happy', emoji: '🤭' },
  monkey: { anim: 'laugh', face: 'happy', emoji: '🙊' },
  raccoon: { anim: 'whisper', face: 'smug', emoji: '🤫' },
  rabbit: { anim: 'shock', face: 'wide', emoji: '😱' },
  dog: { anim: 'uneasy', face: 'wide', emoji: '😨' },
  penguin: { anim: 'lookAway', face: 'normal', emoji: '😶' },
  koala: { anim: 'surprised', face: 'wide', emoji: '😳' },
  wolf: { anim: 'stare', face: 'doubt', emoji: '😐' },
  tiger: { anim: 'stare', face: 'doubt', emoji: '😐' },
  dragon: { anim: 'stare', face: 'smug', emoji: '😏' },
  cat: { anim: 'stare', face: 'smug', emoji: '😼' },
  lion: { anim: 'stare', face: 'normal', emoji: '😶' },
  fox: { anim: 'shrug', face: 'smug', emoji: '🤷' },
  panda: { anim: 'lookAway', face: 'sad', emoji: '😶' },
  bear: { anim: 'uneasy', face: 'sad', emoji: '😟' },
};

// ───────────────────────── 出局处决（完整版） ─────────────────────────

/**
 * 输家最后一句很短的话（按动物的性格）：知道自己马上就要死了。
 * 只在本机显示字幕、播放这只动物的声音，不发送任何消息。
 */
export const LAST_WORDS: Record<Species, { text: string; emotion: AnimalEmotion }> = {
  wolf: { text: '……原来是这样结束的。', emotion: 'sad' },
  cat: { text: '……真的假的？', emotion: 'surprised' },
  rabbit: { text: '等、等一下……', emotion: 'nervous' },
  fox: { text: '……不。', emotion: 'sad' },
  tiger: { text: '我早就知道会这样。', emotion: 'neutral' },
  lion: { text: '……来吧。', emotion: 'confident' },
  bear: { text: '……', emotion: 'sad' },
  panda: { text: '……唉。', emotion: 'sad' },
  monkey: { text: '……一点都不好玩了。', emotion: 'sad' },
  frog: { text: '呱……？', emotion: 'surprised' },
  dog: { text: '……对不起。', emotion: 'sad' },
  penguin: { text: '……好冷。', emotion: 'nervous' },
  koala: { text: '……让我再睡一会儿。', emotion: 'sad' },
  raccoon: { text: '……别这样。', emotion: 'nervous' },
  dragon: { text: '……哼。', emotion: 'angry' },
};

/** 失去头部的身体怎么倒下：重的动物向前倒在桌上，其他动物歪倒在椅子扶手上 */
export const HEADLESS_COLLAPSE: Record<Species, AnimName> = {
  bear: 'headlessSlump',
  panda: 'headlessSlump',
  koala: 'headlessSlump',
  lion: 'headlessSlump',
  dragon: 'headlessSlump',
  tiger: 'headlessSlump',
  cat: 'headlessTopple',
  fox: 'headlessTopple',
  raccoon: 'headlessTopple',
  rabbit: 'headlessTopple',
  frog: 'headlessTopple',
  penguin: 'headlessTopple',
  dog: 'headlessTopple',
  wolf: 'headlessTopple',
  monkey: 'headlessTopple',
};

/**
 * 处决之后旁观者的反应（按性格，所有人都不说话）：
 * 猫先震惊再强行冷静、兔子明显恐惧僵住、狐狸慢慢后退、熊低头看着、狼冷静但眼神变了、
 * 熊猫完全停住、老虎冷冷看着、狮子保持威严短暂沉默、猴子完全不说话。
 */
export const EXECUTION_REACTION: Record<Species, { anim: AnimName; face: MoodFace }> = {
  cat: { anim: 'composedShock', face: 'doubt' },
  rabbit: { anim: 'fearFrozen', face: 'wide' },
  fox: { anim: 'backAway', face: 'doubt' },
  bear: { anim: 'lookDown', face: 'sad' },
  wolf: { anim: 'stare', face: 'doubt' },
  panda: { anim: 'freeze', face: 'wide' },
  tiger: { anim: 'stare', face: 'normal' },
  lion: { anim: 'gravePause', face: 'normal' },
  monkey: { anim: 'freeze', face: 'wide' },
  frog: { anim: 'freeze', face: 'wide' },
  dog: { anim: 'fearFrozen', face: 'wide' },
  penguin: { anim: 'lookAway', face: 'sad' },
  koala: { anim: 'freeze', face: 'wide' },
  raccoon: { anim: 'backAway', face: 'doubt' },
  dragon: { anim: 'stare', face: 'normal' },
};

// ───────────────────────── 设备档位 ─────────────────────────

/** 不同设备的演出档位：手机不是“低质量版”，而是保留节奏、反应与声音，减少粒子与镜头震动 */
export interface DefeatProfile {
  smoke: number;
  debris: number;
  fragments: number;
  looseChips: number;
  shake: number;
  flash: number;
  /** 镜头在一个分镜内的移动幅度（减少动态效果时几乎不动） */
  move: number;
  /** 烟雾贴图分辨率（手机更低） */
  smokeRes: number;
  /** 碎片 / 筹码是否投射阴影（手机与低画质关闭） */
  shadows: boolean;
  /** 冲击时的火星数量（很少、很短） */
  sparks: number;
}

export function defeatProfile(o: { mobile: boolean; quality: 'low' | 'medium' | 'high' | 'ultra'; reduced: boolean }): DefeatProfile {
  const tier = o.quality === 'ultra' || o.quality === 'high' ? 2 : o.quality === 'medium' ? 1 : 0;
  const base: DefeatProfile = [
    { smoke: 12, debris: 28, fragments: 10, looseChips: 5, shake: 0.05, flash: 0.75, move: 1, smokeRes: 64, shadows: false, sparks: 6 },
    { smoke: 18, debris: 46, fragments: 16, looseChips: 7, shake: 0.06, flash: 0.82, move: 1, smokeRes: 128, shadows: true, sparks: 10 },
    { smoke: 28, debris: 80, fragments: 26, looseChips: 10, shake: 0.07, flash: 0.88, move: 1, smokeRes: 128, shadows: true, sparks: 16 },
  ][tier];
  const p = { ...base };
  if (o.mobile) {
    p.smoke = Math.min(p.smoke, 16);
    p.debris = Math.min(p.debris, 36);
    p.fragments = Math.min(p.fragments, 12);
    p.looseChips = Math.min(p.looseChips, 6);
    p.sparks = Math.min(p.sparks, 8);
    p.smokeRes = 64;
    p.shadows = false;
    p.shake *= 0.6;
  }
  if (o.reduced) {
    p.smoke = Math.ceil(p.smoke * 0.5);
    p.debris = Math.ceil(p.debris * 0.35);
    p.fragments = Math.ceil(p.fragments * 0.4);
    p.looseChips = Math.ceil(p.looseChips * 0.5);
    p.sparks = Math.ceil(p.sparks * 0.4);
    p.shake = 0;
    p.flash = 0.3;
    p.move = 0.15;
  }
  return p;
}

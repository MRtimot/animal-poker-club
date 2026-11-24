// 失败演出的规则（纯函数，不碰界面 / 3D / 声音，便于测试）
// · 什么时候演：牌局结果完全来自服务器 / 本地引擎（win 事件与座位筹码），这里只“读”结果，不改变任何牌局状态
// · 演多久：每个阶段的时间表（完整版：出局；简短版：大额失利但还有筹码，必须在下一手开始前演完，不拖延牌局）
// · 谁怎么反应：按动物种类与 AI 性格选择不同的动作
import type { TableView, SeatView } from '../../core/game/view';
import type { Species } from '../../core/player/profile';
import type { AIPersonality } from '../../core/ai/ai';
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
  | 'result' // 结果揭晓：全景（赢家演出仍在显示），声音开始降低
  | 'winner' // 赢家特写：赢家按性格反应
  | 'realize' // 输家特写：意识到输了（缓慢推近），呼吸、心跳开始
  | 'reaction' // 反应镜头：其他动物一个接一个转头看向输家，灯光变暗
  | 'tension' // 过肩镜头：红色轮廓光，心跳加快
  | 'insert' // 环境特写：桌上的筹码与牌，最后一声重心跳
  | 'silence' // 一切突然停止（0.1~0.2 秒的完全安静）
  | 'impact' // 冲击：闪光 + 震动 + 低频 + 烟雾 + 粒子 + 桌面反应，输家倒下
  | 'aftermath' // 余波：烟雾散去、牌落下、筹码停稳、房间安静
  | 'blackout' // 黑屏
  | 'defeated' // “出局”画面（等待玩家）/ 简短版的字幕
  | 'recover'; // 恢复：镜头、灯光、声音回到牌桌

export const PHASE_ORDER: DefeatPhase[] = ['result', 'winner', 'realize', 'reaction', 'tension', 'insert', 'silence', 'impact', 'aftermath', 'blackout', 'defeated', 'recover'];

/** 完整版：每个阶段的开始时间（毫秒，从赢家演出开始算起）；defeated 之后等玩家选择 */
export const FULL_TIMELINE: Partial<Record<DefeatPhase, number>> = {
  result: 0,
  winner: 1400,
  realize: 2400,
  reaction: 4100,
  tension: 5400,
  insert: 6500,
  silence: 7100,
  impact: 7280,
  aftermath: 7900,
  blackout: 9800,
  defeated: 10500,
};

/** 简短版（基准时间，会按下一手开始前剩余的时间压缩）：没有赢家特写、过肩与环境特写，没有黑屏 */
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

/** 输家“意识到输了”：自信的突然失去自信、傲慢的不相信、紧张的立刻慌张、爱玩的笑容慢慢消失、冷静的接受、好斗的愤怒 */
export const REALIZE_BY_SPECIES: Record<Species, AnimName> = {
  cat: 'realizeDisbelief',
  lion: 'realizeAnger',
  dragon: 'realizeDisbelief',
  wolf: 'realizeDisbelief',
  tiger: 'realizeAccept',
  rabbit: 'realizePanic',
  dog: 'realizePanic',
  koala: 'realizePanic',
  monkey: 'realizePanic',
  penguin: 'realizePanic',
  fox: 'realizeFade',
  frog: 'realizeFade',
  raccoon: 'realizeFade',
  panda: 'realizeAccept',
  bear: 'realizeAccept',
};

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
  tiger: 'collapseDignified', // 保持尊严：后仰一下，然后慢慢低头闭眼，仍然坐直
  wolf: 'collapseDignified',
  dragon: 'collapseDignified',
  monkey: 'collapseDrama', // 极其夸张地抱头，摇晃后侧倒
  lion: 'collapseRage', // 愤怒地站起来，然后重重地坐回去
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

/** 赢家反应：优雅地微笑、嚣张地整理筹码、冷静地盯着输家、爱玩地庆祝、平静地继续整理牌 */
export const WINNER_REACTION: Record<WinnerStyle, { anim: AnimName; face: MoodFace; emoji: string }> = {
  elegant: { anim: 'cool', face: 'smug', emoji: '🙂' },
  cocky: { anim: 'stackChips', face: 'smug', emoji: '😏' },
  ruthless: { anim: 'stare', face: 'doubt', emoji: '😐' },
  playful: { anim: 'clap', face: 'happy', emoji: '😆' },
  calm: { anim: 'think', face: 'normal', emoji: '😌' },
};

/** 旁观者转头时的反应：笑、倒吸一口气、盯着看、移开视线、耸肩 */
export const BYSTANDER_REACTION: Record<Species, { anim: AnimName; face: MoodFace; emoji: string }> = {
  frog: { anim: 'laugh', face: 'happy', emoji: '🤭' },
  monkey: { anim: 'laugh', face: 'happy', emoji: '🙊' },
  raccoon: { anim: 'smug', face: 'smug', emoji: '😏' },
  rabbit: { anim: 'shock', face: 'wide', emoji: '😱' },
  dog: { anim: 'nervous', face: 'wide', emoji: '😨' },
  penguin: { anim: 'surprised', face: 'wide', emoji: '😮' },
  koala: { anim: 'surprised', face: 'wide', emoji: '😳' },
  wolf: { anim: 'stare', face: 'doubt', emoji: '😐' },
  tiger: { anim: 'stare', face: 'doubt', emoji: '😐' },
  dragon: { anim: 'stare', face: 'smug', emoji: '😏' },
  cat: { anim: 'stare', face: 'smug', emoji: '😼' },
  lion: { anim: 'stare', face: 'normal', emoji: '😶' },
  fox: { anim: 'smug', face: 'smug', emoji: '🤷' },
  panda: { anim: 'lookAway', face: 'sad', emoji: '😶' },
  bear: { anim: 'lookAway', face: 'sad', emoji: '😶' },
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
}

export function defeatProfile(o: { mobile: boolean; quality: 'low' | 'medium' | 'high' | 'ultra'; reduced: boolean }): DefeatProfile {
  const tier = o.quality === 'ultra' || o.quality === 'high' ? 2 : o.quality === 'medium' ? 1 : 0;
  const base: DefeatProfile = [
    { smoke: 12, debris: 28, fragments: 10, looseChips: 5, shake: 0.05, flash: 0.75, move: 1 },
    { smoke: 18, debris: 46, fragments: 16, looseChips: 7, shake: 0.06, flash: 0.82, move: 1 },
    { smoke: 28, debris: 80, fragments: 26, looseChips: 10, shake: 0.07, flash: 0.88, move: 1 },
  ][tier];
  const p = { ...base };
  if (o.mobile) {
    p.smoke = Math.min(p.smoke, 16);
    p.debris = Math.min(p.debris, 36);
    p.fragments = Math.min(p.fragments, 12);
    p.looseChips = Math.min(p.looseChips, 6);
    p.shake *= 0.6;
  }
  if (o.reduced) {
    p.smoke = Math.ceil(p.smoke * 0.5);
    p.debris = Math.ceil(p.debris * 0.35);
    p.fragments = Math.ceil(p.fragments * 0.4);
    p.looseChips = Math.ceil(p.looseChips * 0.5);
    p.shake = 0;
    p.flash = 0.3;
    p.move = 0.15;
  }
  return p;
}

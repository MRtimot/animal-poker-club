import { Card } from '../cards/card';
import { LegalActions, Phase, PlayerAction } from '../table/types';
import { RNG } from '../utils/random';
import { estimateEquity, preflopStrength } from './equity';
import type { Species } from '../player/profile';

export type AIPersonality = 'aggressiveFox' | 'cautiousPanda' | 'crazyFrog' | 'smartCat' | 'luckyRabbit';
export type AIDifficulty = 'easy' | 'normal' | 'hard' | 'expert';

export interface PersonalityInfo {
  id: AIPersonality;
  name: string;
  species: Species;
  desc: string;
  /** 加注倾向 0~1 */
  aggression: number;
  /** 诈唬概率 0~1 */
  bluff: number;
  /** 入池门槛偏移（越大越紧） */
  tightness: number;
  /** 决策随机性 0~1 */
  randomness: number;
}

export const PERSONALITIES: Record<AIPersonality, PersonalityInfo> = {
  aggressiveFox: { id: 'aggressiveFox', name: '激进狐狸', species: 'fox', desc: '经常加注，压力拉满。', aggression: 0.78, bluff: 0.22, tightness: -0.04, randomness: 0.1 },
  cautiousPanda: { id: 'cautiousPanda', name: '保守熊猫', species: 'panda', desc: '只玩强牌，很少诈唬。', aggression: 0.35, bluff: 0.03, tightness: 0.13, randomness: 0.04 },
  crazyFrog: { id: 'crazyFrog', name: '疯狂青蛙', species: 'frog', desc: '随机性很高，经常让人摸不着头脑。', aggression: 0.6, bluff: 0.3, tightness: -0.08, randomness: 0.45 },
  smartCat: { id: 'smartCat', name: '聪明猫', species: 'cat', desc: '根据概率与牌型冷静决策。', aggression: 0.55, bluff: 0.1, tightness: 0.03, randomness: 0.04 },
  luckyRabbit: { id: 'luckyRabbit', name: '幸运兔', species: 'rabbit', desc: '行为难以预测，偶尔神来一笔。', aggression: 0.5, bluff: 0.16, tightness: 0, randomness: 0.32 },
};

export const DIFFICULTY_NAME: Record<AIDifficulty, string> = { easy: '简单', normal: '普通', hard: '困难', expert: '专家' };

const DIFFICULTY: Record<AIDifficulty, { iterations: number; noise: number; potOddsSkill: number }> = {
  easy: { iterations: 60, noise: 0.18, potOddsSkill: 0.3 },
  normal: { iterations: 160, noise: 0.08, potOddsSkill: 0.65 },
  hard: { iterations: 320, noise: 0.03, potOddsSkill: 0.9 },
  expert: { iterations: 650, noise: 0, potOddsSkill: 1 },
};

export interface AIContext {
  hole: Card[];
  board: Card[];
  phase: Phase;
  /** 底池总额（含本轮所有下注） */
  pot: number;
  legal: LegalActions;
  chips: number;
  myBet: number;
  currentBet: number;
  bigBlind: number;
  opponents: number;
  /** 本轮之前是否有人加注（用于判断对手牌力范围） */
  facingRaise: boolean;
  rng: RNG;
}

export interface AIDecision {
  action: PlayerAction;
  equity: number;
  mood: 'confident' | 'nervous' | 'neutral' | 'bluffing';
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** 本地 AI 决策：蒙特卡洛胜率 + 底池赔率 + 性格参数。完全本地运行。 */
export function decideAction(ctx: AIContext, personality: AIPersonality, difficulty: AIDifficulty): AIDecision {
  const P = PERSONALITIES[personality];
  const D = DIFFICULTY[difficulty];
  const { legal, rng } = ctx;

  let equity =
    ctx.phase === 'preflop' && difficulty === 'easy'
      ? preflopStrength(ctx.hole) * 0.8 + 0.1
      : estimateEquity(ctx.hole, ctx.board, Math.max(1, ctx.opponents), D.iterations, rng);
  equity = clamp(equity + (rng() * 2 - 1) * D.noise, 0, 1);

  // 多人底池时“公平份额”更低；以此衡量相对牌力
  const fair = 1 / (ctx.opponents + 1);
  const relative = equity / fair; // 1 = 平均水平
  const toCall = legal.toCall;
  const potOdds = toCall > 0 ? toCall / (ctx.pot + toCall) : 0;
  const randomness = P.randomness;
  const roll = rng();

  // 随机“发疯”：小概率无视牌力
  if (rng() < randomness * 0.18) {
    const r = rng();
    if (r < 0.35 && legal.canRaise) return raise(ctx, P, 0.5 + rng(), equity, 'bluffing');
    if (r < 0.45 && legal.canAllIn && personality !== 'cautiousPanda' && rng() < 0.3) return allin(legal, equity, 'bluffing');
    if (legal.canCheck) return { action: { type: 'check' }, equity, mood: 'neutral' };
    if (r < 0.8 && legal.canCall) return { action: { type: 'call' }, equity, mood: 'neutral' };
  }

  const strongLine = 1.55 + P.tightness * 2;
  const playLine = 0.9 + P.tightness * 3;

  // 很强：价值下注 / 加注
  if (relative >= strongLine || equity > 0.8) {
    if (legal.canRaise && roll < 0.55 + P.aggression * 0.45) {
      const big = equity > 0.88 && rng() < 0.35 + P.aggression * 0.3;
      if (big && ctx.chips < ctx.pot * 1.2 && legal.canAllIn) return allin(legal, equity, 'confident');
      return raise(ctx, P, big ? 1 : 0.55 + rng() * 0.4, equity, 'confident');
    }
    if (legal.canCheck) return { action: { type: 'check' }, equity, mood: 'confident' };
    if (legal.canCall) return { action: { type: 'call' }, equity, mood: 'confident' };
    return allin(legal, equity, 'confident');
  }

  // 中等：根据赔率跟注，偶尔加注
  const margin = (1 - D.potOddsSkill) * 0.15; // 难度越低，算赔率越粗糙
  const callable = equity + margin >= potOdds * (1 + P.tightness) && relative >= playLine * 0.75;
  if (relative >= playLine) {
    if (legal.canRaise && roll < P.aggression * 0.45) return raise(ctx, P, 0.4 + rng() * 0.35, equity, 'confident');
    if (legal.canCheck) return { action: { type: 'check' }, equity, mood: 'neutral' };
    if (callable || toCall <= ctx.bigBlind) return callOrAllin(legal, equity, ctx);
  }

  // 弱：诈唬 / 过牌 / 弃牌
  const bluffChance = P.bluff * (ctx.opponents <= 2 ? 1.2 : 0.6) * (ctx.phase === 'preflop' ? 0.6 : 1);
  if (legal.canRaise && rng() < bluffChance && !ctx.facingRaise) return raise(ctx, P, 0.5 + rng() * 0.5, equity, 'bluffing');
  if (legal.canCheck) return { action: { type: 'check' }, equity, mood: 'nervous' };

  // 便宜的跟注（例如大盲位被补盲）
  const cheap = toCall <= ctx.bigBlind && ctx.phase === 'preflop' && relative > 0.7;
  if (callable || cheap) return callOrAllin(legal, equity, ctx);
  return { action: { type: 'fold' }, equity, mood: 'nervous' };
}

function callOrAllin(legal: LegalActions, equity: number, ctx: AIContext): AIDecision {
  // 跟注需要投入大部分筹码时，考虑是否值得
  if (legal.callAmount >= ctx.chips * 0.85 && equity < 0.45) return { action: { type: 'fold' }, equity, mood: 'nervous' };
  return { action: { type: 'call' }, equity, mood: 'neutral' };
}

function allin(legal: LegalActions, equity: number, mood: AIDecision['mood']): AIDecision {
  if (!legal.canAllIn) return { action: { type: legal.canCheck ? 'check' : 'call' }, equity, mood };
  return { action: { type: 'allin' }, equity, mood };
}

function raise(ctx: AIContext, P: PersonalityInfo, potFraction: number, equity: number, mood: AIDecision['mood']): AIDecision {
  const { legal } = ctx;
  if (!legal.canRaise) return { action: { type: legal.canCheck ? 'check' : 'call' }, equity, mood };
  const potAfterCall = ctx.pot + legal.toCall;
  let to = ctx.currentBet + Math.round(potAfterCall * potFraction * (0.8 + P.aggression * 0.4));
  // 翻牌前标准开池 2.5~3.5 BB
  if (ctx.phase === 'preflop' && ctx.currentBet <= ctx.bigBlind) {
    to = Math.round(ctx.bigBlind * (2.5 + potFraction * 1.5));
  }
  to = roundTo(to, ctx.bigBlind >= 50 ? 5 : 1);
  to = clamp(to, legal.minRaiseTo, legal.maxRaiseTo);
  if (to >= legal.maxRaiseTo * 0.8 && legal.canAllIn) return { action: { type: 'allin' }, equity, mood };
  return { action: { type: 'raise', amount: to }, equity, mood };
}

function roundTo(v: number, step: number) {
  return Math.round(v / step) * step;
}

// ───────────── AI 名字与台词 ─────────────

export const AI_NAMES: Record<AIPersonality, string[]> = {
  aggressiveFox: ['狐狸先生', '火狐', '狐小狡', '赤尾'],
  cautiousPanda: ['熊猫阿宝', '团团', '圆仔', '竹子君'],
  crazyFrog: ['青蛙哥', '呱呱', '蹦蹦蛙', '疯蛙'],
  smartCat: ['聪明猫', '喵博士', '小橘', '算牌猫'],
  luckyRabbit: ['幸运兔', '疯狂兔', '跳跳', '萝卜头'],
};

export const AI_LINES = {
  raise: ['我加注！', '跟得起吗？', '这把我要了。', '来点刺激的！', '筹码就是用来推的~'],
  allin: ['全押！', '梭哈了！', '要么赢，要么回家！', '我不信你能跟！'],
  fold: ['这把算了。', '你赢了…这次。', '不跟不跟。', '溜了溜了~'],
  win: ['哈哈哈哈！', '谢谢！', '好牌！', '承让承让~', '下一局！'],
  lose: ['这也能输？', '啊啊啊！', '我不服！', '下一局！', '运气不好…'],
  call: ['我跟。', '我不信你！', '你在诈我吧？', '看看你有什么。'],
};

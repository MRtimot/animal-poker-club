// 角色台词系统（Character Dialogue System）
// 台词由服务器（或本地对战的控制器）根据牌局事件挑选，客户端只负责显示与播放语音。
// 现在是预设台词库；以后接入 AI 生成台词时，只需要替换 pickLine()，语音 / 动画 / 同步都不用改。
import type { Species } from '../player/profile';
import { PERSONALITIES_BY_SPECIES, VOICE_PROFILES, type AnimalEmotion, type SpeechStyle } from './voice';
import { BJ_DIALOGUE, BJ_DIALOGUE_NAME, BJ_DIALOGUE_PRIORITY, type BjDialogueEvent } from '../blackjack/dialogue';
import { BAC_DIALOGUE, BAC_DIALOGUE_NAME, BAC_DIALOGUE_PRIORITY, type BacDialogueEvent } from '../baccarat/dialogue';

export type DialogueEvent =
  | 'greet'
  | 'think'
  | 'raise'
  | 'allin'
  | 'call'
  | 'check'
  | 'fold'
  | 'react_raise'
  | 'react_allin'
  | 'win'
  | 'win_big'
  | 'bluff_win'
  | 'lose'
  | 'big_hand'
  | 'catchphrase'
  | BjDialogueEvent
  | BacDialogueEvent;

export const DIALOGUE_EVENT_NAME: Record<DialogueEvent, string> = {
  greet: '开局问候',
  think: 'AI 思考（面对大注）',
  raise: '自己加注',
  allin: '自己全押',
  call: '自己跟注',
  check: '自己过牌',
  fold: '自己弃牌',
  react_raise: '对手加注',
  react_allin: '对手全押',
  win: '赢下底池',
  win_big: '赢下大底池',
  bluff_win: '诈唬成功',
  lose: '输掉底池',
  big_hand: '同花顺 / 皇家同花顺',
  catchphrase: '口头禅',
  ...BJ_DIALOGUE_NAME,
  ...BAC_DIALOGUE_NAME,
};

/** 优先级：重大牌局事件 > 情绪事件 > 玩家互动 > 闲聊 */
export const DIALOGUE_PRIORITY: Record<DialogueEvent, 0 | 1 | 2 | 3> = {
  big_hand: 3,
  react_allin: 3,
  allin: 3,
  win_big: 3,
  bluff_win: 2,
  win: 2,
  lose: 2,
  react_raise: 1,
  raise: 1,
  call: 1,
  fold: 1,
  check: 0,
  greet: 0,
  think: 0,
  catchphrase: 0,
  ...BJ_DIALOGUE_PRIORITY,
  ...BAC_DIALOGUE_PRIORITY,
};

/** 牌局情境：同一个事件，牌好 / 牌差 / 在诈唬时说的话不一样 */
export type DialogueWhen = 'strong' | 'weak' | 'bluff';

export interface DialogueContext {
  /** 说话者自己的牌力（只有服务器 / 本地控制器知道，绝不会发给其他玩家） */
  strength?: 'strong' | 'medium' | 'weak';
  /** 说话者正在诈唬（牌很差却加注 / 全押） */
  bluff?: boolean;
  /** 底池很大 */
  bigPot?: boolean;
}

export interface DialogueLine {
  text: string;
  emotion: AnimalEmotion;
  /** 挑衅 / 垃圾话（玩家可以在设置中关闭） */
  taunt?: boolean;
  /** 只在这种情境下说 */
  when?: DialogueWhen;
}

type Table = Partial<Record<DialogueEvent, DialogueLine[]>>;
/** flags：t = 挑衅，s = 牌好时，w = 牌差时，b = 诈唬时 */
const L = (text: string, emotion: AnimalEmotion, flags = ''): DialogueLine => ({
  text,
  emotion,
  ...(flags.includes('t') ? { taunt: true } : {}),
  ...(flags.includes('s') ? { when: 'strong' as const } : flags.includes('w') ? { when: 'weak' as const } : flags.includes('b') ? { when: 'bluff' as const } : {}),
});

// 台词原则：口语 > 书面语；短句；符合角色；“……”只在真的犹豫 / 停顿时用，不是每句都加。
const HOLDEM_DIALOGUE: Record<SpeechStyle, Table> = {
  // 🐺 狼 / 🐧 企鹅：短句、慢、低沉、自信、话少
  cool: {
    greet: [L('……开始吧。', 'confident'), L('别浪费时间。', 'neutral'), L('嗯。都到齐了。', 'neutral')],
    think: [L('……嗯。', 'confused'), L('……有点意思。', 'neutral'), L('让我看看。', 'neutral')],
    raise: [L('加注。', 'confident'), L('你还跟吗？', 'confident', 't'), L('……我加。', 'confident'), L('这把，我不会让。', 'confident', 's'), L('来啊。', 'confident', 'tb')],
    allin: [L('全部。', 'confident'), L('……来吧。', 'confident', 't'), L('都推了。你接得住吗？', 'confident', 'ts'), L('……赌一把。', 'confident', 'b')],
    call: [L('我跟。', 'neutral'), L('……跟。', 'neutral'), L('那我就……跟。', 'confident', 's'), L('……就看一眼。', 'neutral', 'w'), L('跟。别想吓我。', 'confident', 't')],
    check: [L('过。', 'neutral'), L('……过。', 'neutral'), L('先看看。', 'neutral')],
    fold: [L('……让你。', 'disappointed'), L('不值得。', 'neutral'), L('啧，这牌没法打。', 'disappointed', 'w')],
    react_raise: [L('你确定？', 'confident', 't'), L('……你刚才一直在装弱。', 'sarcastic', 't'), L('哦？加注？', 'surprised'), L('正合我意。', 'confident', 's'), L('啧……麻烦了。', 'disappointed', 'w')],
    react_allin: [L('哦？', 'surprised'), L('……全压？', 'surprised'), L('这么急？', 'sarcastic', 't'), L('终于忍不住了？', 'confident', 'ts'), L('……这下难办了。', 'disappointed', 'w'), L('你在赌命。', 'confident', 't')],
    win: [L('意料之中。', 'confident', 't'), L('下一个。', 'neutral'), L('……你刚才在诈唬。', 'sarcastic', 't')],
    win_big: [L('这才像样。', 'excited'), L('……都是我的。', 'confident', 't')],
    bluff_win: [L('你不该弃牌的。', 'confident', 't'), L('其实……什么都没有。', 'sarcastic', 't')],
    lose: [L('……记住你了。', 'angry'), L('运气而已。', 'angry'), L('……行。下一把。', 'disappointed')],
    big_hand: [L('……这才是真正的牌。', 'excited')],
  },
  // 🐯 老虎 / 🦁 狮子 / 🐉 龙：强势、有威严、命令式
  regal: {
    greet: [L('王者入座。', 'confident'), L('今天，这张桌子归我。', 'confident'), L('都坐好了？开始吧！', 'confident')],
    think: [L('嗯……', 'confused'), L('容我想想。', 'neutral'), L('哼……有点意思。', 'confident')],
    raise: [L('加注！谁敢跟？', 'confident', 't'), L('跟上我的节奏！', 'confident'), L('这一把，我要定了！', 'excited', 's'), L('怎么，怕了？', 'confident', 'tb')],
    allin: [L('全部押上！', 'excited'), L('让你们见识一下，什么叫气势！', 'excited', 't'), L('来吧——一决胜负！', 'excited', 's')],
    call: [L('我接下了。', 'confident'), L('跟。', 'neutral'), L('哼，陪你看看。', 'neutral', 'w')],
    check: [L('先看看。', 'neutral'), L('过。', 'neutral')],
    fold: [L('这一局，饶过你。', 'disappointed'), L('暂且退一步。', 'neutral')],
    react_raise: [L('胆子不小啊。', 'surprised', 't'), L('你在挑战我？', 'angry', 't'), L('哈！正好！', 'excited', 's'), L('哼……先别得意。', 'angry', 'w')],
    react_allin: [L('什么？！全押？', 'surprised'), L('哼，有骨气！', 'confident', 't'), L('好！我等的就是这个！', 'excited', 's'), L('……你这是在逼我啊。', 'angry', 'w')],
    win: [L('理所当然！', 'happy'), L('服了吧？', 'confident', 't'), L('哈哈，拿来吧！', 'happy')],
    win_big: [L('哈哈哈哈！这才叫赢！', 'excited'), L('整张桌子都是我的！', 'excited')],
    bluff_win: [L('被我的气势吓退了吧？', 'confident', 't')],
    lose: [L('岂有此理！', 'angry'), L('这不可能……', 'disappointed'), L('哼，下一把还回来！', 'angry')],
    big_hand: [L('天命所归！', 'excited')],
  },
  // 🐱 猫：轻快、傲娇、语气变化大
  smug: {
    greet: [L('哼，又来送筹码了？', 'sarcastic', 't'), L('今天心情不错，陪你玩玩。', 'happy'), L('快点开始啦。', 'neutral')],
    think: [L('唔……', 'confused'), L('哼……让我想想。', 'neutral'), L('嗯～这个嘛……', 'confused')],
    raise: [L('哼，加注。', 'confident'), L('跟不跟？不跟就算啦。', 'confident', 't'), L('这把你肯定输。', 'confident', 'ts'), L('怎么，不敢跟？', 'sarcastic', 'tb')],
    allin: [L('全押！才、才不是冲动！', 'excited'), L('哼，全给你看。', 'confident'), L('……哼，赌就赌！', 'nervous', 'b')],
    call: [L('哼，我跟。', 'neutral'), L('你真觉得我会弃牌？', 'sarcastic', 't'), L('……就跟这一次哦。', 'nervous', 'w')],
    check: [L('过……别看我。', 'neutral'), L('过啦。', 'neutral')],
    fold: [L('哼，这把不想玩而已。', 'disappointed'), L('才不是怕你。', 'angry')],
    react_raise: [L('哼……就这？', 'sarcastic', 't'), L('你真的觉得我会弃牌？', 'sarcastic', 't'), L('哼哼，正好。', 'happy', 's'), L('诶……加这么多？', 'nervous', 'w')],
    react_allin: [L('诶？全部？', 'surprised'), L('哼，真敢玩啊。', 'sarcastic', 't'), L('哼～送上门来了。', 'happy', 'ts'), L('等、等一下……', 'nervous', 'w')],
    win: [L('哼，本来就是我的。', 'happy', 't'), L('早就说了吧～', 'sarcastic', 't'), L('嘿嘿，谢啦。', 'happy')],
    win_big: [L('哼哼～今天手气真好！', 'excited')],
    bluff_win: [L('其实我什么都没有哦～', 'sarcastic', 't')],
    lose: [L('……才不是我输了！', 'angry'), L('哼，下一局。', 'disappointed'), L('这不公平！', 'angry')],
    big_hand: [L('诶？！这、这么好的牌！', 'surprised')],
  },
  // 🦊 狐狸 / 🦝 浣熊：温柔、聪明、喜欢停顿和暗示
  mysterious: {
    greet: [L('又见面了……', 'neutral'), L('让我看看，今晚谁会犯错。', 'confident'), L('嗯，人都到齐了。', 'neutral')],
    think: [L('让我想想……', 'neutral'), L('嗯……有意思。', 'confident'), L('这个嘛……', 'confused')],
    raise: [L('加一点……调调味。', 'confident'), L('有意思，我加注。', 'confident'), L('你会跟的……对吧？', 'confident', 'ts'), L('你猜，我拿的是什么？', 'sarcastic', 'tb')],
    allin: [L('全部……就这样吧。', 'confident'), L('这样才有趣。', 'excited'), L('这一把……我等很久了。', 'confident', 's')],
    call: [L('跟。我想看看你的牌。', 'confident'), L('有意思……我跟。', 'neutral'), L('好吧……陪你看看。', 'neutral', 'w')],
    check: [L('先观察一下。', 'neutral'), L('过。不急。', 'neutral')],
    fold: [L('这次就算了。', 'neutral'), L('聪明人知道什么时候离开。', 'confident')],
    react_raise: [L('你刚才的下注……很有意思。', 'confident', 't'), L('想吓我？', 'sarcastic', 't'), L('呵……正好。', 'confident', 's'), L('嗯……这就有点麻烦了。', 'confused', 'w')],
    react_allin: [L('看来……你很有信心。', 'surprised'), L('全部？你确定？', 'surprised', 't'), L('呵呵……终于来了。', 'confident', 's'), L('……这可不太妙。', 'nervous', 'w')],
    win: [L('一切都在计划之中。', 'confident', 't'), L('谢谢你的筹码。', 'happy', 't'), L('呵，承让了。', 'happy')],
    win_big: [L('呵呵……正如我所料。', 'excited')],
    bluff_win: [L('有时候，故事比牌更重要。', 'confident', 't'), L('你真的以为……我有牌？', 'sarcastic', 't')],
    lose: [L('……失算了。', 'disappointed'), L('这次算你赢。', 'neutral'), L('有意思……我记住了。', 'confident')],
    big_hand: [L('命运……站在我这边。', 'excited')],
  },
  // 🐶 狗：热情、真诚、元气
  friendly: {
    greet: [L('大家好！今天也要玩得开心！', 'happy'), L('汪！我准备好啦！', 'excited'), L('嘿！好久不见！', 'happy')],
    think: [L('嗯……怎么办呢……', 'confused'), L('让我想想！', 'neutral'), L('呃……', 'confused')],
    raise: [L('我加注啦！', 'excited'), L('这把我有点信心！', 'confident'), L('这把牌超好的！啊不对……没什么！', 'excited', 's'), L('嘿嘿，我加注！', 'nervous', 'b')],
    allin: [L('全押！冲啊！', 'excited'), L('拼了！', 'excited')],
    call: [L('我跟！', 'happy'), L('一起看看吧！', 'happy'), L('呃……我跟吧？', 'nervous', 'w')],
    check: [L('过牌～', 'neutral'), L('我先过！', 'happy')],
    fold: [L('呜……这把不行。', 'sad'), L('我先休息一下！', 'neutral')],
    react_raise: [L('哇，好厉害的下注！', 'surprised'), L('你是不是拿到好牌了？', 'nervous'), L('好耶，我跟定了！', 'excited', 's'), L('呜……加这么多啊。', 'nervous', 'w')],
    react_allin: [L('哇！全部都压上了！', 'surprised'), L('好勇敢！', 'surprised'), L('来吧！我不怕！', 'excited', 's'), L('诶诶？！怎、怎么办……', 'nervous', 'w')],
    win: [L('耶！谢谢大家！', 'happy'), L('太开心了！', 'excited')],
    win_big: [L('哇啊啊！这么多筹码！', 'excited')],
    bluff_win: [L('嘿嘿，其实我在吓唬你～', 'happy', 't')],
    lose: [L('呜呜……没关系，下一局！', 'sad'), L('好可惜啊！', 'disappointed')],
    big_hand: [L('这是什么神仙牌！', 'excited')],
  },
  // 🐰 兔子：快、容易紧张、会结巴
  nervous: {
    greet: [L('大、大家好……', 'nervous'), L('今天运气会不会好呢……', 'nervous')],
    think: [L('呃、呃……怎么办……', 'nervous'), L('等、等我想想……', 'nervous'), L('嗯……嗯……', 'confused')],
    raise: [L('我、我加注！', 'nervous'), L('就、就加一点点！', 'nervous'), L('这、这把我有信心！', 'excited', 's'), L('我……我加注！真的！', 'nervous', 'b')],
    allin: [L('全、全押了！不管了！', 'excited'), L('呜哇，全部！', 'nervous')],
    call: [L('我跟……应该没问题吧？', 'nervous'), L('跟、跟！', 'nervous'), L('呜……就跟一下下。', 'nervous', 'w')],
    check: [L('过、过牌……', 'nervous'), L('先过……', 'nervous')],
    fold: [L('不行不行，我弃牌！', 'nervous'), L('太、太可怕了……', 'nervous')],
    react_raise: [L('诶？加这么多？', 'surprised'), L('等一下，你确定吗？', 'nervous'), L('呜……我就知道……', 'disappointed', 'w')],
    react_allin: [L('等、等一下！你真的要全押吗？！', 'surprised'), L('全部？！', 'surprised'), L('诶嘿……其、其实我牌还不错……', 'happy', 's'), L('不、不会吧……', 'nervous', 'w')],
    win: [L('诶？我赢了？！', 'surprised'), L('太、太好了！', 'happy')],
    win_big: [L('哇啊！这么多！真的是我的吗？！', 'excited')],
    bluff_win: [L('其、其实我好紧张的……', 'nervous')],
    lose: [L('呜……就知道会这样。', 'sad'), L('我的胡萝卜……', 'sad')],
    big_hand: [L('天、天哪！这是同花顺吗？！', 'surprised')],
  },
  // 🐻 熊 / 🐼 熊猫 / 🐨 考拉：慢吞吞、憨厚
  heavy: {
    greet: [L('嗯……开始吧，不急。', 'neutral'), L('慢慢玩……', 'happy')],
    think: [L('嗯…………', 'confused'), L('让我……想一想……', 'neutral'), L('唔……', 'confused')],
    raise: [L('嗯……加一点。', 'confident'), L('我加注……', 'neutral'), L('嘿嘿……这把加多点。', 'happy', 's')],
    allin: [L('嗯……全部吧。', 'confident'), L('都押上。', 'confident')],
    call: [L('嗯……我跟。', 'neutral'), L('跟吧……', 'neutral'), L('唔……看看再说。', 'neutral', 'w')],
    check: [L('过……', 'neutral'), L('嗯，过。', 'neutral')],
    fold: [L('嗯……不玩了。', 'disappointed'), L('这把……算了。', 'neutral')],
    react_raise: [L('嗯？……加这么多。', 'surprised'), L('你……是认真的？', 'surprised'), L('嘿……好啊。', 'happy', 's')],
    react_allin: [L('……全部？嗯……', 'surprised'), L('好大的胆子……', 'surprised'), L('唔……这下难了。', 'nervous', 'w')],
    win: [L('嘿嘿……赢了。', 'happy'), L('嗯……不错。', 'happy')],
    win_big: [L('哇……好多……', 'excited')],
    bluff_win: [L('嘿……你上当了。', 'happy', 't')],
    lose: [L('唉……', 'sad'), L('嗯……下次吧。', 'disappointed')],
    big_hand: [L('……这是……好牌啊。', 'surprised')],
  },
  // 🐵 猴子 / 🐸 青蛙：活泼、调皮、嘻嘻哈哈
  playful: {
    greet: [L('嘿嘿！谁先送筹码？', 'excited', 't'), L('来玩来玩！', 'happy')],
    think: [L('嗯哼～', 'confused'), L('让我算算……', 'neutral'), L('嘿嘿……想想……', 'happy')],
    raise: [L('嘿嘿，我加注～', 'happy'), L('猜猜我有什么？', 'sarcastic', 't'), L('嘿嘿嘿，这把好玩了。', 'happy', 's'), L('加！反正我不怕！', 'excited', 'b')],
    allin: [L('全押！刺激！', 'excited'), L('一把定输赢！', 'excited')],
    call: [L('跟就跟！', 'happy'), L('我不信你！', 'confident', 't')],
    check: [L('过过过～', 'happy'), L('过！', 'neutral')],
    fold: [L('溜了溜了～', 'neutral'), L('不跟不跟！', 'neutral')],
    react_raise: [L('哟，玩真的？', 'surprised', 't'), L('你在诈我吧？', 'sarcastic', 't'), L('哎呀呀……', 'nervous', 'w')],
    react_allin: [L('哇哦！全部？太刺激了！', 'excited'), L('疯了疯了！', 'surprised'), L('嘿嘿……我等你很久了！', 'excited', 'ts')],
    win: [L('哈哈哈哈！', 'excited', 't'), L('谢谢老板！', 'happy', 't')],
    win_big: [L('发财啦！', 'excited')],
    bluff_win: [L('哈哈，我其实什么都没有！', 'excited', 't')],
    lose: [L('这也能输？', 'angry'), L('不服！再来！', 'angry')],
    big_hand: [L('哇哇哇！这牌太夸张了！', 'excited')],
  },
};

/** 所有台词：德州扑克 + 21 点（同一套挑选、冷却与优先级） */
export const DIALOGUE: Record<SpeechStyle, Table> = Object.fromEntries(
  (Object.keys(HOLDEM_DIALOGUE) as SpeechStyle[]).map((style) => [style, { ...HOLDEM_DIALOGUE[style], ...BJ_DIALOGUE[style], ...BAC_DIALOGUE[style] }]),
) as Record<SpeechStyle, Table>;

export interface DialogueRef {
  /** 台词 ID（例如 cool.react_allin.0）；口头禅为 custom.catchphrase */
  id: string;
  event: DialogueEvent;
  emotion: AnimalEmotion;
  taunt?: boolean;
}

export interface Speaker {
  id: string;
  species: Species;
  style?: SpeechStyle;
  catchphrase?: string;
  /** 是否是 AI（真人玩家的动物只在重大时刻自动说话） */
  isAI: boolean;
}

export function dialogueById(id: string): DialogueLine | null {
  const [style, event, idx] = id.split('.');
  return DIALOGUE[style as SpeechStyle]?.[event as DialogueEvent]?.[Number(idx)] ?? null;
}

/**
 * 根据性格 + 牌局情境挑选一句台词，并避开这只动物最近说过的话（以后可以替换为 AI 生成）。
 * 情境台词优先：牌好时更可能说“终于忍不住了？”，牌差时说“啧……麻烦了。”
 */
export function pickLine(
  speaker: Speaker,
  event: DialogueEvent,
  rng: () => number,
  ctx: DialogueContext = {},
  avoid: readonly string[] = [],
): { ref: DialogueRef; text: string } | null {
  const style = speaker.style ?? VOICE_PROFILES[speaker.species]?.style ?? 'friendly';
  if (event === 'catchphrase') {
    const text = speaker.catchphrase?.trim() || PERSONALITIES_BY_SPECIES[speaker.species]?.catchphrases[0];
    if (!text) return null;
    return { ref: { id: 'custom.catchphrase', event, emotion: 'confident' }, text };
  }
  const list = DIALOGUE[style]?.[event];
  if (!list?.length) return null;
  const want: DialogueWhen | null = ctx.bluff ? 'bluff' : ctx.strength === 'strong' ? 'strong' : ctx.strength === 'weak' ? 'weak' : null;
  const all = list.map((line, i) => ({ line, i }));
  const generic = all.filter((x) => !x.line.when);
  const matched = want ? all.filter((x) => x.line.when === want) : [];
  let pool = matched.length && (rng() < 0.7 || !generic.length) ? matched : generic.length ? generic : all;
  // 避免重复：最近说过的先不说
  const idOf = (x: { i: number }) => `${style}.${event}.${x.i}`;
  const fresh = pool.filter((x) => !avoid.includes(idOf(x)));
  if (fresh.length) pool = fresh;
  // 全都说过：选最久以前说的那句（绝不会连着说同一句）
  else return toRef(style, event, [...pool].sort((a, b) => avoid.indexOf(idOf(a)) - avoid.indexOf(idOf(b)))[0]);
  return toRef(style, event, pool[Math.floor(rng() * pool.length) % pool.length]);
}

function toRef(style: SpeechStyle, event: DialogueEvent, { line, i }: { line: DialogueLine; i: number }): { ref: DialogueRef; text: string } {
  return { ref: { id: `${style}.${event}.${i}`, event, emotion: line.emotion, ...(line.taunt ? { taunt: true } : {}) }, text: line.text };
}

export interface DialogueRules {
  /** 普通台词之间的最短间隔（毫秒） */
  minIntervalMs: number;
  /** 每一手牌最多几句 */
  maxPerHand: number;
  /** 同一只动物两句之间的最短间隔 */
  perSpeakerMs: number;
  /** “嗯……让我想想”这类思考台词的冷却（全桌共享） */
  thinkMs?: number;
}

export const DEFAULT_DIALOGUE_RULES: DialogueRules = { minIntervalMs: 5000, maxPerHand: 3, perSpeakerMs: 9000, thinkMs: 20000 };

/** 每只动物记住最近说过的几句，避免“又是这句” */
const RECENT_KEEP = 5;

/**
 * 台词导演：决定“谁、什么时候、说什么”。冷却时间 + 每手上限 + 优先级，防止动物们疯狂讲话。
 * 服务器（在线）和浏览器（本地对战）用同一个类，所以两种模式的表现一致。
 */
export interface DirectorState {
  lastAt: number | null;
  lastBySpeaker: [string, number][];
  hand: number;
  count: number;
  hadBigHand: boolean;
  recent?: [string, string[]][];
  thinkAt?: number | null;
  thinkHand?: number;
}

export class DialogueDirector {
  private lastAt = -Infinity;
  private lastBySpeaker = new Map<string, number>();
  private hand = -1;
  private countThisHand = 0;
  private hadBigHand = false;
  private recent = new Map<string, string[]>();
  private thinkAt = -Infinity;
  private thinkHand = -1;

  constructor(
    private rng: () => number,
    private rules: DialogueRules = DEFAULT_DIALOGUE_RULES,
    state?: DirectorState,
  ) {
    if (state) {
      this.lastAt = state.lastAt ?? -Infinity;
      this.lastBySpeaker = new Map(state.lastBySpeaker);
      this.hand = state.hand;
      this.countThisHand = state.count;
      this.hadBigHand = state.hadBigHand;
      this.recent = new Map(state.recent ?? []);
      this.thinkAt = state.thinkAt ?? -Infinity;
      this.thinkHand = state.thinkHand ?? -1;
    }
  }

  /** 保存冷却状态（JSON 无法表示 -Infinity，用 null） */
  toState(): DirectorState {
    return {
      lastAt: Number.isFinite(this.lastAt) ? this.lastAt : null,
      lastBySpeaker: [...this.lastBySpeaker],
      hand: this.hand,
      count: this.countThisHand,
      hadBigHand: this.hadBigHand,
      recent: [...this.recent],
      thinkAt: Number.isFinite(this.thinkAt) ? this.thinkAt : null,
      thinkHand: this.thinkHand,
    };
  }

  private remember(speakerId: string, id: string) {
    const r = (this.recent.get(speakerId) ?? []).filter((x) => x !== id);
    r.push(id);
    this.recent.set(speakerId, r.slice(-RECENT_KEEP));
    // 只记录还在桌上的少量动物，状态不会无限增长
    if (this.recent.size > 12) this.recent.delete(this.recent.keys().next().value!);
  }

  /** 返回要说的台词；不该说话时返回 null */
  consider(speaker: Speaker, event: DialogueEvent, handNumber: number, now = Date.now(), ctx: DialogueContext = {}): { ref: DialogueRef; text: string } | null {
    if (handNumber !== this.hand) {
      this.hand = handNumber;
      this.countThisHand = 0;
      this.hadBigHand = false;
    }
    if (event === 'think') return this.considerThink(speaker, handNumber, now);
    const priority = DIALOGUE_PRIORITY[event];
    // 出现同花顺这种重大事件后，这一手不再说普通的话
    if (this.hadBigHand && priority < 3) return null;
    // 每手上限：最高优先级的事件可以多说一句
    if (this.countThisHand >= this.rules.maxPerHand + (priority >= 3 ? 1 : 0)) return null;
    // 普通台词受冷却限制；重大事件不受全局冷却限制
    if (priority < 3 && now - this.lastAt < this.rules.minIntervalMs) return null;
    if (now - (this.lastBySpeaker.get(speaker.id) ?? -Infinity) < this.rules.perSpeakerMs && priority < 3) return null;
    // 真人玩家的动物只在重大时刻自动开口
    if (!speaker.isAI && priority < 3) return null;
    // 爱说话的性格更常开口；优先级越高越一定会说
    const talk = PERSONALITIES_BY_SPECIES[speaker.species]?.talkativeness ?? 0.5;
    // 底池很大时更容易开口（大场面更有戏）
    const bonus = ctx.bigPot ? 0.12 : 0;
    const chance = priority >= 3 ? 0.85 : priority === 2 ? 0.35 + talk * 0.4 + bonus : priority === 1 ? 0.12 + talk * 0.3 + bonus : 0.2 + talk * 0.3;
    if (this.rng() > chance) return null;
    // 偶尔用自己的口头禅代替普通台词（不会连着说）
    const recent = this.recent.get(speaker.id) ?? [];
    const useCatch = !!speaker.catchphrase && (event === 'greet' || event === 'win') && !recent.includes('custom.catchphrase') && this.rng() < 0.35;
    const line = pickLine(speaker, useCatch ? 'catchphrase' : event, this.rng, ctx, recent);
    if (!line) return null;
    this.remember(speaker.id, line.ref.id);
    this.lastAt = now;
    this.lastBySpeaker.set(speaker.id, now);
    this.countThisHand++;
    if (event === 'big_hand') this.hadBigHand = true;
    return line;
  }

  /**
   * AI 面对艰难决定时的“思考”台词（“嗯……”“让我想想……”）。
   * 有自己的冷却：全桌 20 秒最多一句、每手最多一句，不占用普通台词的冷却与上限。
   */
  private considerThink(speaker: Speaker, handNumber: number, now: number) {
    if (!speaker.isAI || this.hadBigHand) return null;
    if (this.thinkHand === handNumber) return null;
    if (now - this.thinkAt < (this.rules.thinkMs ?? 20000)) return null;
    // 别人刚说完话就别马上接着“嗯……”
    if (now - this.lastAt < this.rules.minIntervalMs * 0.3) return null;
    const talk = PERSONALITIES_BY_SPECIES[speaker.species]?.talkativeness ?? 0.5;
    if (this.rng() > 0.2 + talk * 0.45) return null;
    const line = pickLine(speaker, 'think', this.rng, {}, this.recent.get(speaker.id) ?? []);
    if (!line) return null;
    this.remember(speaker.id, line.ref.id);
    this.thinkAt = now;
    this.thinkHand = handNumber;
    return line;
  }
}

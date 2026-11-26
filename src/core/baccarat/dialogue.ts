// 百家乐台词：接入现有的角色台词系统（按说话风格挑选、冷却、优先级、去重都由 DialogueDirector 负责）。
// 口语、短句；{v} 会被换成点数。庄家只说已经公开的事情；台词不会暗示过去的结果能预测下一局。
import type { DialogueLine } from '../character/dialogue';
import type { AnimalEmotion, SpeechStyle } from '../character/voice';

export type BacDialogueEvent =
  | 'bac_bet'
  | 'bac_win'
  | 'bac_lose'
  | 'bac_push'
  | 'bac_tie_win'
  | 'bacd_greet'
  | 'bacd_close'
  | 'bacd_natural'
  | 'bacd_draw'
  | 'bacd_player_win'
  | 'bacd_banker_win'
  | 'bacd_tie'
  | 'bacd_react_bet';

export const BAC_DIALOGUE_NAME: Record<BacDialogueEvent, string> = {
  bac_bet: '百家乐：下注',
  bac_win: '百家乐：赢了',
  bac_lose: '百家乐：输了',
  bac_push: '百家乐：开和，下注退回',
  bac_tie_win: '百家乐：押中和局',
  bacd_greet: '百家乐庄家：开场',
  bacd_close: '百家乐庄家：停止下注',
  bacd_natural: '百家乐庄家：例牌',
  bacd_draw: '百家乐庄家：补牌',
  bacd_player_win: '百家乐庄家：闲赢',
  bacd_banker_win: '百家乐庄家：庄赢',
  bacd_tie: '百家乐庄家：和局',
  bacd_react_bet: '百家乐庄家：看玩家下注',
};

export const BAC_DIALOGUE_PRIORITY: Record<BacDialogueEvent, 0 | 1 | 2 | 3> = {
  bac_bet: 0,
  bac_win: 2,
  bac_lose: 1,
  bac_push: 1,
  bac_tie_win: 3,
  bacd_greet: 1,
  bacd_close: 2,
  bacd_natural: 3,
  bacd_draw: 1,
  bacd_player_win: 2,
  bacd_banker_win: 2,
  bacd_tie: 3,
  bacd_react_bet: 1,
};

const L = (text: string, emotion: AnimalEmotion, taunt = false): DialogueLine => ({ text, emotion, ...(taunt ? { taunt: true } : {}) });

type Table = Record<BacDialogueEvent, DialogueLine[]>;

export const BAC_DIALOGUE: Record<SpeechStyle, Table> = {
  cool: {
    bac_bet: [L('就这样。', 'neutral'), L('下好了。', 'confident')],
    bac_win: [L('不错。', 'confident')],
    bac_lose: [L('……下一局。', 'disappointed')],
    bac_push: [L('退回，也好。', 'neutral')],
    bac_tie_win: [L('……和。我押中了。', 'confident')],
    bacd_greet: [L('请下注。', 'neutral'), L('桌子准备好了。', 'neutral')],
    bacd_close: [L('停止下注。', 'neutral'), L('买定离手。', 'confident')],
    bacd_natural: [L('例牌，{v}。', 'confident')],
    bacd_draw: [L('补牌。', 'neutral')],
    bacd_player_win: [L('闲，{v} 点。', 'neutral')],
    bacd_banker_win: [L('庄，{v} 点。', 'confident')],
    bacd_tie: [L('和。', 'surprised')],
    bacd_react_bet: [L('……有意思。', 'neutral'), L('你确定？', 'confident', true)],
  },
  regal: {
    bac_bet: [L('全押在这里，看好了。', 'confident')],
    bac_win: [L('理所当然。', 'happy')],
    bac_lose: [L('哼，再来。', 'angry')],
    bac_push: [L('和局？暂且放过。', 'neutral')],
    bac_tie_win: [L('和！果然如此！', 'excited')],
    bacd_greet: [L('牌桌已经就绪，请下注。', 'confident'), L('今晚，由我开牌。', 'confident')],
    bacd_close: [L('停止下注！', 'confident')],
    bacd_natural: [L('例牌 {v}！胜负已分。', 'excited')],
    bacd_draw: [L('按规矩，补一张。', 'neutral')],
    bacd_player_win: [L('闲家 {v} 点，胜。', 'confident')],
    bacd_banker_win: [L('庄家 {v} 点，胜。', 'confident')],
    bacd_tie: [L('和局！难得一见。', 'surprised')],
    bacd_react_bet: [L('好气魄。', 'surprised'), L('这一注，有胆量。', 'confident')],
  },
  smug: {
    bac_bet: [L('哼哼，就押这个～', 'happy'), L('才、才不是乱选的！', 'nervous')],
    bac_win: [L('嘿嘿，早就知道～', 'happy', true)],
    bac_lose: [L('才不是我选错了！', 'angry')],
    bac_push: [L('和？那就当没发生过。', 'neutral')],
    bac_tie_win: [L('和局！我是天才吧！', 'excited')],
    bacd_greet: [L('请下注～我等着呢。', 'confident'), L('来吧，看看你选哪边？', 'sarcastic', true)],
    bacd_close: [L('好啦，不许改了。', 'confident')],
    bacd_natural: [L('哇，例牌 {v}！', 'surprised')],
    bacd_draw: [L('再来一张～', 'neutral')],
    bacd_player_win: [L('闲 {v} 点，算你们走运。', 'sarcastic')],
    bacd_banker_win: [L('庄 {v} 点～果然是庄。', 'happy', true)],
    bacd_tie: [L('和？谁都没想到吧。', 'surprised')],
    bacd_react_bet: [L('你真的选这个？', 'sarcastic', true), L('嗯哼……随你。', 'confident')],
  },
  mysterious: {
    bac_bet: [L('就这一边……', 'neutral')],
    bac_win: [L('呵，承让。', 'happy')],
    bac_lose: [L('有意思……', 'neutral')],
    bac_push: [L('和……下注回来了。', 'neutral')],
    bac_tie_win: [L('和局……我听见了。', 'confident')],
    bacd_greet: [L('又见面了……请下注。', 'neutral'), L('牌在等你。', 'confident')],
    bacd_close: [L('停止下注……让牌说话。', 'confident')],
    bacd_natural: [L('例牌，{v}……', 'confident')],
    bacd_draw: [L('规则说，再来一张。', 'neutral')],
    bacd_player_win: [L('闲，{v}。', 'neutral')],
    bacd_banker_win: [L('庄，{v}。', 'confident')],
    bacd_tie: [L('和……谁也没有赢。', 'surprised')],
    bacd_react_bet: [L('有意思的选择。', 'confident'), L('你相信这一边？', 'neutral')],
  },
  friendly: {
    bac_bet: [L('我押好啦！', 'happy')],
    bac_win: [L('耶！赢啦！', 'happy')],
    bac_lose: [L('没关系，下一局！', 'sad')],
    bac_push: [L('和局，钱回来啦！', 'happy')],
    bac_tie_win: [L('哇！押中和了！', 'excited')],
    bacd_greet: [L('欢迎！请下注吧！', 'happy'), L('准备好了吗？', 'happy')],
    bacd_close: [L('停止下注啦！', 'happy')],
    bacd_natural: [L('哇，例牌 {v}！', 'excited')],
    bacd_draw: [L('补一张！', 'happy')],
    bacd_player_win: [L('闲家 {v} 点，赢啦！', 'happy')],
    bacd_banker_win: [L('庄家 {v} 点赢！', 'happy')],
    bacd_tie: [L('和局！一样大！', 'surprised')],
    bacd_react_bet: [L('好选择！加油！', 'happy')],
  },
  nervous: {
    bac_bet: [L('就、就押这个……', 'nervous')],
    bac_win: [L('赢、赢了？太好了……', 'surprised')],
    bac_lose: [L('呜……就知道……', 'sad')],
    bac_push: [L('还、还好，退回来了……', 'nervous')],
    bac_tie_win: [L('诶？！和局！押中了！', 'surprised')],
    bacd_greet: [L('请、请下注……', 'nervous'), L('那、那我们开始吧……', 'nervous')],
    bacd_close: [L('停、停止下注了哦……', 'nervous')],
    bacd_natural: [L('例、例牌 {v}！', 'surprised')],
    bacd_draw: [L('要、要补一张……', 'nervous')],
    bacd_player_win: [L('闲 {v} 点……赢了。', 'nervous')],
    bacd_banker_win: [L('庄 {v} 点……对、对不起。', 'nervous')],
    bacd_tie: [L('和、和局？！', 'surprised')],
    bacd_react_bet: [L('这、这么多吗……', 'nervous')],
  },
  heavy: {
    bac_bet: [L('就这样，不改了。', 'neutral')],
    bac_win: [L('嗯，不错。', 'happy')],
    bac_lose: [L('……没事，慢慢来。', 'neutral')],
    bac_push: [L('和，拿回来。', 'neutral')],
    bac_tie_win: [L('和……押中了。', 'happy')],
    bacd_greet: [L('不急……慢慢下注。', 'neutral'), L('桌子在这儿，请坐。', 'neutral')],
    bacd_close: [L('停止下注。', 'neutral')],
    bacd_natural: [L('例牌，{v}。', 'neutral')],
    bacd_draw: [L('补一张。', 'neutral')],
    bacd_player_win: [L('闲，{v} 点。', 'neutral')],
    bacd_banker_win: [L('庄，{v} 点。', 'neutral')],
    bacd_tie: [L('……和。', 'surprised')],
    bacd_react_bet: [L('嗯……想好了就好。', 'neutral')],
  },
  playful: {
    bac_bet: [L('就它了！', 'excited'), L('押！押！押！', 'excited')],
    bac_win: [L('哈哈！赢啦！', 'excited')],
    bac_lose: [L('哎呀！下一局！', 'surprised')],
    bac_push: [L('和？好玩！', 'happy')],
    bac_tie_win: [L('和局！！我押中了！！', 'excited')],
    bacd_greet: [L('来来来！下注啦！', 'excited'), L('快快快，选一边！', 'excited')],
    bacd_close: [L('停！不许再改啦！', 'excited')],
    bacd_natural: [L('例牌 {v}！！', 'excited')],
    bacd_draw: [L('再来一张！', 'excited')],
    bacd_player_win: [L('闲 {v} 点！闲赢！', 'excited')],
    bacd_banker_win: [L('庄 {v} 点！庄赢！', 'excited')],
    bacd_tie: [L('和局！！', 'excited')],
    bacd_react_bet: [L('哇！好大胆！', 'excited'), L('嘿嘿，有意思！', 'happy')],
  },
};

// 统一的牌局接口：本地 AI 对战与在线房间使用相同的 UI
import type { PlayerAction } from '../core/table/types';
import { useGame, type Screen } from '../store/gameStore';
import { useFx } from '../store/fxStore';
import { useAccount } from '../store/accountStore';
import { voice } from '../audio/voice';
import { sound } from '../audio/sound';
import { localAction, localChat, restartLocalGame, stopLocalGame } from './localHost';
import { net } from './netClient';

/** 清理牌桌上的临时表现：角色语音、气泡、动画、说话状态、音乐紧张度（不碰玩家永久存档） */
function clearTableFx() {
  voice.stop();
  useFx.getState().reset();
  sound.stopTransient();
}

export const session = {
  action(a: PlayerAction) {
    const g = useGame.getState();
    if (g.mode === 'local') {
      const err = localAction(a);
      if (err) g.toast(err, 'error');
    } else if (g.mode === 'online') {
      net.action(a, g.view?.handNumber);
    }
  },
  chat(text: string) {
    const t = text.trim().slice(0, 100);
    if (!t) return;
    const g = useGame.getState();
    if (g.mode === 'local') localChat(t, 'chat');
    else net.chat(t);
  },
  emote(e: string) {
    const g = useGame.getState();
    if (g.mode === 'local') localChat(e, 'emote');
    else net.emote(e);
  },

  /**
   * 离开牌桌 / 房间，回到指定页面（默认首页）。所有“离开”按钮都走这里：
   * 停止本地 AI 与计时器 → 通知服务器离开房间（游客随后断开连接）→ 停止语音与动画 → 清空临时牌局状态 → 切换页面。
   * 玩家永久存档（等级、经验、金币、动物、成就、设置）不受影响。
   * 同步执行且可重复调用：连续点击只会多发一次无害的“离开”消息。
   */
  leave(to: Screen = 'home') {
    const g = useGame.getState();
    if (g.mode === 'local') stopLocalGame();
    // 游客回首页 / 大厅时断开连接（首页不保持多人连接）；回到“在线”页面要继续创建 / 加入房间，保持连接
    if (g.mode === 'online' || g.room) net.leaveRoom({ disconnect: useAccount.getState().status !== 'signedIn' && to !== 'online' });
    clearTableFx();
    g.set({ mode: null, view: null, room: null, chat: [], pendingAction: null, modal: null, cameraMode: 'overview' });
    g.setScreen(to);
  },

  /** 再来一局：开始一场全新的对局（不沿用上一局的牌局状态） */
  playAgain() {
    const g = useGame.getState();
    clearTableFx();
    g.set({ pendingAction: null, modal: null });
    if (g.room?.solo) net.restartSolo();
    else if (g.mode === 'local') restartLocalGame();
  },
};

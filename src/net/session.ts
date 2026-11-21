// 统一的牌局接口：本地 AI 对战与在线房间使用相同的 UI
import type { PlayerAction } from '../core/table/types';
import { useGame } from '../store/gameStore';
import { localAction, localChat, stopLocalGame } from './localHost';
import { net } from './netClient';

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
  leave() {
    const g = useGame.getState();
    if (g.mode === 'local') {
      stopLocalGame();
      g.set({ mode: null, view: null, chat: [] });
      g.setScreen('home');
    } else if (g.mode === 'online') {
      const solo = !!g.room?.solo;
      net.leaveRoom();
      g.setScreen(solo ? 'quick' : 'online');
    } else {
      g.setScreen('home');
    }
  },
};

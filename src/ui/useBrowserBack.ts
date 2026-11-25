// 浏览器“返回 / 前进”按钮：游戏没有使用 URL 路由（页面由 gameStore.screen 决定，网址始终是 /），
// 所以不处理的话，在牌桌上按“返回”会直接离开整个网站。
// 做法：离开首页时在浏览器历史里放一个“游戏内”记录；按返回时拦截，按当前页面做合法的跳转：
//   - 牌局进行中：不离开，弹出“确定要离开牌桌吗？”
//   - 新账号的首次设置：不允许跳过
//   - 房间 / 牌局结束：正常离开房间（通知服务器、清理状态）并回到首页
//   - 其他页面（设置、创建器…）：回到首页
// 按“前进”回到“游戏内”记录时不做任何事（旧牌局已经不存在，不能“前进”回去）。
import { useEffect } from 'react';
import { useGame, type Screen } from '../store/gameStore';
import { session } from '../net/session';
import { consumeBackForFullscreen } from '../display/fullscreen';

const IN_APP = 'apc-in';
const ROOT_SCREENS: Screen[] = ['home', 'login'];

export function useBrowserBack() {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.history?.pushState) return;
    // 直接打开 /game、/room/XXXX 等地址：游戏没有这些页面，显示首页，并把网址改回 /（保留 ?debug 等参数）
    if (window.location.pathname !== '/') window.history.replaceState(window.history.state, '', '/' + window.location.search + window.location.hash);
    const isInApp = () => (window.history.state as { apc?: string } | null)?.apc === IN_APP;
    const push = () => window.history.pushState({ apc: IN_APP }, '');
    const sync = (screen: Screen) => {
      if (!ROOT_SCREENS.includes(screen) && !isInApp()) push();
    };
    sync(useGame.getState().screen);
    const unsub = useGame.subscribe((s, prev) => {
      if (s.screen !== prev.screen) sync(s.screen);
    });
    const onPop = () => {
      if (isInApp()) return; // “前进”：停在当前页面
      const g = useGame.getState();
      if (ROOT_SCREENS.includes(g.screen)) return;
      // 全屏时按返回：只退出全屏，留在当前页面（不离开房间、不回首页）
      if (consumeBackForFullscreen()) {
        push();
        return;
      }
      if (g.screen === 'onboarding' || (g.screen === 'game' && ((g.view && !g.view.gameOver) || g.bj))) {
        push();
        if (g.screen === 'game') g.set({ modal: 'leave' });
        return;
      }
      if (g.screen === 'game' || g.screen === 'room' || g.mode || g.room) session.leave('home');
      else g.setScreen('home');
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      unsub();
    };
  }, []);
}

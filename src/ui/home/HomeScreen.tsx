// 首页：滚动驱动的沉浸式游戏世界入口
// 页面文字在这里；3D 场景（HomeWorld）在全屏画布里，两者共用 homeTimeline 时间轴。
// 所有按钮都连接到现有的真实页面（开始游戏 / 在线房间 / AI 对战 / 动物创建器 / 收藏 / 规则 / 设置）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { useProfile } from '../../store/profileStore';
import { RulesModal } from '../common/RulesModal';
import { HOME_SECTIONS, bindHomeTimeline, type HomeSectionId } from './homeTimeline';
import { HomeActionsContext, type HomeActions } from './homeActions';
import { HomeNav } from './HomeNav';
import { HeroSection } from './sections/HeroSection';
import { TableSection } from './sections/TableSection';
import { AnimalsSection } from './sections/AnimalsSection';
import { GameplaySection } from './sections/GameplaySection';
import { demoPot } from './demoHand';
import { OnlineSection } from './sections/OnlineSection';
import { AISection } from './sections/AISection';
import { FinalCTASection, HomeFooter } from './sections/FinalSection';
import { DesktopRoomCTA, ctaAway as ctaAway_ } from './RoomCTA';
import { enterOnEntryGesture } from '../../display/fullscreen';

export function HomeScreen() {
  const setScreen = useGame((s) => s.setScreen);
  const set = useGame((s) => s.set);
  const created = useProfile((s) => s.createdCharacter);
  const [rules, setRules] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const binding = useRef<ReturnType<typeof bindHomeTimeline> | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // 键盘滚动（PageUp / PageDown / 空格 / Home / End / 方向键）：让滚动容器获得焦点（不改变滚动位置）
    el.focus({ preventScroll: true });
    const nav = document.querySelector<HTMLElement>('[data-nav]');
    const links = nav ? [...nav.querySelectorAll<HTMLElement>('[data-nav-link]')] : [];
    let lastActive = '';
    let ctaAway: boolean | null = null;
    const b = bindHomeTimeline(el, {
      onUpdate: (t) => {
        nav?.classList.toggle('scrolled', t.story > 0.02);
        // 电脑版“创建房间”入口：滚到结尾（那里有自己的“创建房间”按钮与页脚）时让开；
        // 只在越过分界时查找并修改 DOM（手机上没有这个入口，滚动时也不会每一帧去查找）
        const away = ctaAway_(t);
        if (away !== ctaAway) {
          ctaAway = away;
          document.querySelector<HTMLElement>('[data-room-cta]')?.classList.toggle('away', away);
        }
        // 当前所在段落 → 导航高亮
        const i = Math.min(HOME_SECTIONS.length - 1, Math.floor(t.story + 0.001));
        const id: HomeSectionId | 'top' = HOME_SECTIONS[i] === 'hero' ? 'top' : HOME_SECTIONS[i];
        if (id !== lastActive) {
          lastActive = id;
          for (const l of links) {
            const on = l.dataset.navLink === id;
            l.classList.toggle('on', on);
            // 读屏软件也能知道当前所在的段落（只有一个链接处于当前状态）
            if (on) l.setAttribute('aria-current', 'location');
            else l.removeAttribute('aria-current');
          }
        }
      },
      onCount: (c, p) => {
        if (c.dataset.count === 'pot') c.textContent = demoPot(p).toLocaleString();
      },
    });
    binding.current = b;
    return () => {
      b.dispose();
      binding.current = null;
    };
  }, []);

  const actions = useMemo<HomeActions>(
    () => ({
      // 进入游戏的按钮：手机 / 平板按全屏偏好进入全屏（必须在点击里同步调用）
      play: () => {
        enterOnEntryGesture();
        setScreen(created ? 'quick' : 'creator');
      },
      aiMode: () => {
        enterOnEntryGesture();
        setScreen(created ? 'quick' : 'creator');
      },
      createRoom: () => {
        enterOnEntryGesture();
        set({ onlineTab: 'create' });
        setScreen('online');
      },
      joinRoom: () => {
        enterOnEntryGesture();
        set({ onlineTab: 'join' });
        setScreen('online');
      },
      creator: () => setScreen('creator'),
      collection: () => setScreen('collection'),
      settings: () => setScreen('settings'),
      rules: () => setRules(true),
      scrollTo: (id) => binding.current?.scrollTo(id),
    }),
    [created, set, setScreen],
  );

  return (
    <HomeActionsContext.Provider value={actions}>
      <div className="screen home-premium">
        <HomeNav />
        {/* 电脑版“创建房间”入口：放在导航之后，键盘 Tab 很快就能到达（位置固定在右侧，与文档顺序无关） */}
        <DesktopRoomCTA />
        <div className="home-scroll" ref={scroller} tabIndex={-1}>
          <div className="home-track">
            <HeroSection />
            <TableSection />
            <AnimalsSection />
            <GameplaySection />
            <OnlineSection />
            <AISection />
            <FinalCTASection />
            <HomeFooter />
          </div>
        </div>
        {rules && <RulesModal onClose={() => setRules(false)} />}
      </div>
    </HomeActionsContext.Provider>
  );
}

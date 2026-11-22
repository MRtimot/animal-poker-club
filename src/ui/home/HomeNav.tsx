// 首页顶部导航：滚动后缩小、背景变为半透明模糊；手机上收进菜单
import { useEffect, useState } from 'react';
import type { HomeSectionId } from './homeTimeline';
import { useHomeActions } from './homeActions';
import { PremiumButton } from './PremiumButton';

const LINKS: [string, HomeSectionId | 'top'][] = [
  ['首页', 'top'],
  ['牌桌', 'table'],
  ['动物', 'animals'],
  ['牌局', 'game'],
  ['在线', 'online'],
  ['AI', 'ai'],
];

export function HomeNav() {
  const a = useHomeActions();
  const [menu, setMenu] = useState(false);
  // 菜单打开时按 Esc 关闭
  useEffect(() => {
    if (!menu) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [menu]);
  const go = (id: HomeSectionId | 'top') => {
    setMenu(false);
    a.scrollTo(id);
  };
  return (
    <header className="home-nav" data-nav>
      <button type="button" className="hn-brand" onClick={() => go('top')} aria-label="回到顶部">
        <span className="hn-mark" aria-hidden>
          ♠
        </span>
        <span className="hn-name">
          动物扑克俱乐部
          <small>ANIMAL POKER CLUB</small>
        </span>
      </button>
      <nav className="hn-links" aria-label="首页导航">
        {LINKS.map(([t, id]) => (
          <button key={id} type="button" data-nav-link={id} onClick={() => go(id)}>
            {t}
          </button>
        ))}
      </nav>
      <div className="hn-right">
        <button type="button" className="hn-icon" onClick={a.rules} title="游戏规则" aria-label="游戏规则">
          📖
        </button>
        <button type="button" className="hn-icon" onClick={a.collection} title="我的收藏" aria-label="我的收藏">
          📚
        </button>
        <button type="button" className="hn-icon" onClick={a.settings} title="设置" aria-label="设置">
          ⚙️
        </button>
        <PremiumButton variant="primary" onClick={a.play}>
          开始游戏
        </PremiumButton>
        <button type="button" className="hn-menu" aria-label="打开菜单" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <i />
          <i />
        </button>
      </div>
      {menu && (
        <div className="hn-sheet" role="menu">
          {LINKS.map(([t, id]) => (
            <button key={id} type="button" role="menuitem" onClick={() => go(id)}>
              {t}
            </button>
          ))}
          <div className="hn-sheet-sep" />
          {(
            [
              ['动物创建器', a.creator],
              ['我的收藏', a.collection],
              ['游戏规则', a.rules],
              ['设置', a.settings],
            ] as const
          ).map(([t, fn]) => (
            <button
              key={t}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                fn();
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}

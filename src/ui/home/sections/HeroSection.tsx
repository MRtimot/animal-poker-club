// 第一屏：品牌、标题、两个主要按钮、创始人与测试员致谢、向下探索提示
import { AccountChip } from '../../account/AccountScreens';
import { PremiumButton } from '../PremiumButton';
import { Reveal, StorySection } from '../HomeParts';
import { useHomeActions } from '../homeActions';
import { useIsPC } from '../../../utils/pc';

export function HeroSection() {
  const a = useHomeActions();
  // 电脑版：在主按钮下方提供三个直达入口（移动端保持原样）
  const pc = useIsPC();
  return (
    <StorySection id="hero" label="首页">
      <div className="hero-copy">
        {/* 开场：标题与按钮依次出现（CSS 开场动画）；向下滚动时向上移动并淡出（时间轴） */}
        <Reveal at={0} out={0.04} span={0.3} className="hero-exit hero-exit-1">
          <div className="hero-in hero-in-1 eyebrow hero-eyebrow">
            <span className="eyebrow-line" aria-hidden />
            ANIMAL POKER CLUB
          </div>
          <h1 className="hero-title hero-in hero-in-2">动物扑克俱乐部</h1>
        </Reveal>
        <Reveal at={0} out={0.08} span={0.3} className="hero-exit hero-exit-2">
          <p className="hero-sub hero-in hero-in-3">每一张牌，都有自己的故事。</p>
          <p className="hero-note hero-in hero-in-3">走进森林里的扑克俱乐部，和性格各异的动物们来一局德州扑克。</p>
        </Reveal>
        <Reveal at={0} out={0.12} span={0.3} className="hero-exit hero-exit-3">
          <div className="hero-cta hero-in hero-in-4">
            <PremiumButton variant="primary" size="lg" onClick={a.play}>
              开始游戏
            </PremiumButton>
            <PremiumButton variant="secondary" size="lg" onClick={() => a.scrollTo('table')}>
              探索扑克俱乐部
            </PremiumButton>
          </div>
          {pc && (
            <nav className="hero-quick hero-in hero-in-4" aria-label="快速开始">
              <button type="button" onClick={a.createRoom}>
                <span aria-hidden>🌐</span>在线对战
              </button>
              <button type="button" onClick={a.aiMode}>
                <span aria-hidden>🤖</span>AI 对战
              </button>
              <button type="button" onClick={() => a.scrollTo('animals')}>
                <span aria-hidden>🐾</span>探索动物
              </button>
            </nav>
          )}
          <div className="hero-credits hero-in hero-in-5">
            <div className="founder-badge">
              <span className="founder-crown">👑</span>
              <span className="founder-label">创始人</span>
              <span className="founder-name">Timothy Ong</span>
              <span className="founder-title">Founder of APEX</span>
            </div>
            <div className="tester-badge">
              <span className="tester-icon">🧪</span>
              <span className="tester-label">游戏测试员</span>
              <span className="tester-name">Zac</span>
            </div>
          </div>
        </Reveal>
      </div>
      <Reveal at={0} out={0.1} span={0.3} className="hero-account hero-exit">
        <div className="hero-in hero-in-5">
          <AccountChip />
        </div>
      </Reveal>
      <Reveal at={0} out={0.01} span={0.06} className="scroll-hint">
        <div className="hero-in hero-in-6">
          <span>向下探索</span>
          <i aria-hidden />
        </div>
      </Reveal>
    </StorySection>
  );
}

// 结尾高潮 + 页脚
import { Reveal, StorySection } from '../HomeParts';
import { useHomeActions } from '../homeActions';
import { PremiumButton } from '../PremiumButton';
import { useConsent } from '../../../privacy/consent';
import { useIsPC } from '../../../utils/pc';

export function FinalCTASection() {
  const a = useHomeActions();
  return (
    <StorySection id="cta" label="开始游戏">
      <div className="story-copy story-center final-copy">
        <Reveal at={0.12} span={0.12}>
          <h2 className="story-title final-title">准备好上桌了吗？</h2>
        </Reveal>
        <Reveal at={0.24} span={0.12}>
          <p className="story-text final-sub">你的座位已经准备好了。</p>
        </Reveal>
        <Reveal at={0.34} span={0.12}>
          <div className="story-cta">
            <PremiumButton variant="primary" size="lg" onClick={a.play}>
              开始游戏
            </PremiumButton>
            <PremiumButton variant="secondary" size="lg" onClick={a.createRoom}>
              创建房间
            </PremiumButton>
          </div>
        </Reveal>
        <Reveal at={0.44} span={0.12}>
          <div className="home-modes">
          <button type="button" className="home-bj" onClick={a.blackjack}>
            <span className="home-bj-suit" aria-hidden>
              ♠
            </span>
            <span className="home-bj-text">
              <b>BLACKJACK 21</b>
              <small>READ THE DEALER · PLAY YOUR HAND · BEAT 21</small>
            </span>
            <span className="home-bj-go">PLAY BLACKJACK →</span>
          </button>
          <button type="button" className="home-bj home-bac" onClick={a.baccarat}>
            <span className="home-bj-suit" aria-hidden>
              ♦
            </span>
            <span className="home-bj-text">
              <b>BACCARAT</b>
              <small>CLASSIC PUNTO BANCO · PLAYER OR BANKER</small>
            </span>
            <span className="home-bj-go">PLAY BACCARAT →</span>
          </button>
          </div>
        </Reveal>
      </div>
    </StorySection>
  );
}

export function HomeFooter() {
  const a = useHomeActions();
  const pc = useIsPC();
  const links: [string, () => void][] = [
    ['开始游戏', a.play],
    ['在线房间', a.createRoom],
    ['AI 对战', a.aiMode],
    ['21 点', a.blackjack],
    ['百家乐', a.baccarat],
    ['动物创建器', a.creator],
    ['我的收藏', a.collection],
    ['游戏规则', a.rules],
    ['设置', a.settings],
  ];
  return (
    <footer className="home-footer">
      <div className="hf-brand">
        <div className="hf-logo">动物扑克俱乐部</div>
        <div className="hf-en">ANIMAL POKER CLUB</div>
      </div>
      <nav className="hf-links" aria-label="页脚导航">
        {links.map(([t, fn]) => (
          <button key={t} type="button" onClick={fn}>
            {t}
          </button>
        ))}
      </nav>
      <div className="hf-credits">
        创始人 Timothy Ong · Founder of APEX <span aria-hidden>·</span> 游戏测试员 熊
      </div>
      <div className="hf-legal">
        仅使用虚拟筹码 · 无真钱交易 · 登录仅用于保存游戏进度
        {pc && (
          <>
            {' · '}
            <button type="button" className="hf-cookie" onClick={() => useConsent.getState().openSettings()}>
              Cookie 与本机存储设置
            </button>
          </>
        )}
      </div>
      <div className="hf-copy">© 2026 Animal Poker Club</div>
    </footer>
  );
}

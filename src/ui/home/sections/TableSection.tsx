// 进入扑克世界：镜头推向牌桌，公共牌与筹码出现
import { Eyebrow, Reveal, StorySection } from '../HomeParts';

export function TableSection() {
  return (
    <StorySection id="table" label="牌桌">
      <div className="story-copy story-left">
        <Reveal at={0.04} out={0.36} span={0.08}>
          <Eyebrow n="01">ENTER THE CLUB</Eyebrow>
          <h2 className="story-title">欢迎来到俱乐部。</h2>
          <p className="story-text">暖色吊灯、绒布牌桌、木质下注圈。每一个细节，都在等你入座。</p>
        </Reveal>
      </div>
      <div className="story-copy story-center story-low">
        <Reveal at={0.62} span={0.1}>
          <Eyebrow>THE TABLE IS READY</Eyebrow>
        </Reveal>
        <Reveal at={0.7} span={0.1}>
          <h2 className="story-title story-title-xl">牌桌已就绪。</h2>
        </Reveal>
        <Reveal at={0.8} span={0.1}>
          <p className="story-text">每一局，都从这里开始。</p>
        </Reveal>
      </div>
    </StorySection>
  );
}

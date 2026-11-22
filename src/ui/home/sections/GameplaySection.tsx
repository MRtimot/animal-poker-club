// 开始你的牌局：随着滚动，一手真实规则的德州扑克在 3D 牌桌上发生
// 牌型名称由游戏引擎实时判定（不是写死的文字）
import { useMemo } from 'react';
import { evaluateHand } from '../../../core/poker/handEvaluator';
import { DEMO_HAND } from '../../../three/scenes/homeCast';
import { POT_FINAL, handText } from '../demoHand';
import { Eyebrow, Reveal, StorySection } from '../HomeParts';

const ACTIONS: { label: string; key: string; lit: [number, number][] }[] = [
  { label: '弃牌', key: 'F', lit: [] },
  { label: '过牌', key: 'C', lit: [[0.62, 0.7]] },
  { label: '跟注', key: 'C', lit: [] },
  { label: '加注', key: 'R', lit: [[0.42, 0.5]] },
  { label: '全押', key: 'A', lit: [[0.72, 0.8]] },
];

const STEPS: { at: number; out: number; title: string; text: string }[] = [
  { at: 0.05, out: 0.25, title: '发牌', text: '两张底牌，只属于你。' },
  { at: 0.28, out: 0.4, title: '翻牌', text: '三张公共牌同时翻开。' },
  { at: 0.41, out: 0.6, title: '加注 · 跟注', text: '你加注，对手跟注，筹码滑入底池。' },
  { at: 0.61, out: 0.7, title: '转牌 · 河牌', text: '最后两张公共牌，局势反转只在一瞬间。' },
  { at: 0.71, out: 0.81, title: '全押', text: '你推上全部筹码，对手选择跟注。' },
];

export function GameplaySection() {
  const hero = useMemo(() => evaluateHand([...DEMO_HAND.hero, ...DEMO_HAND.board]), []);
  const rival = useMemo(() => evaluateHand([...DEMO_HAND.rival, ...DEMO_HAND.board]), []);
  return (
    <StorySection id="game" label="牌局">
      <div className="story-copy story-left story-top">
        <Reveal at={0.01} out={0.3} span={0.05}>
          <Eyebrow n="03">PLAY THE HAND</Eyebrow>
          <h2 className="story-title">开始你的牌局。</h2>
        </Reveal>
      </div>
      <div className="play-steps">
        {STEPS.map((s) => (
          <Reveal key={s.title} at={s.at} out={s.out} span={0.03} className="play-step">
            <div className="play-step-title">{s.title}</div>
            <div className="play-step-text">{s.text}</div>
          </Reveal>
        ))}
        <Reveal at={0.82} out={0.89} span={0.03} className="play-step">
          <div className="play-step-title">摊牌</div>
          <div className="play-step-text">对手亮出：{handText(rival)}</div>
        </Reveal>
        <Reveal at={0.89} span={0.03} className="play-step play-step-win">
          <div className="play-step-title">你赢了</div>
          <div className="play-step-text">
            {handText(hero)} · 赢得底池 {POT_FINAL.toLocaleString()}
          </div>
        </Reveal>
      </div>
      <Reveal at={0.03} out={0.97} span={0.04} className="play-hud">
        <div className="play-pot">
          <span>底池</span>
          <b data-count="pot">300</b>
        </div>
        <div className="play-actions" aria-hidden>
          {ACTIONS.map((x) => (
            <span key={x.label} className="play-action">
              {x.lit.map(([a, b]) => (
                <Reveal key={a} at={a} out={b} span={0.015} as="span" className="play-action-lit" />
              ))}
              <span className="play-action-label">{x.label}</span>
              <kbd>{x.key}</kbd>
            </span>
          ))}
        </div>
        <div className="play-note">示意画面 · 实际牌桌上的按钮与快捷键相同</div>
      </Reveal>
    </StorySection>
  );
}

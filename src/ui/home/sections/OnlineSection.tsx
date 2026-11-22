// 和朋友一起上桌：3D 牌桌上朋友们一个个入座；按钮连接真实的创建 / 加入房间
import { SPECIES_MAP } from '../../../core/player/profile';
import { MAX_ROOM_PLAYERS } from '../../../core/protocol';
import { ROOM_CODE_LENGTH } from '../../../core/utils/random';
import { JOIN_AT, SEAT_SPECIES } from '../../../three/scenes/homeCast';
import { Eyebrow, Reveal, StorySection } from '../HomeParts';
import { useHomeActions } from '../homeActions';
import { PremiumButton } from '../PremiumButton';

const STEPS = ['创建房间', `把 ${ROOM_CODE_LENGTH} 位房间代码发给朋友`, '朋友输入代码加入', '房主开始游戏，一起上桌'];

export function OnlineSection() {
  const a = useHomeActions();
  const joins = Object.entries(JOIN_AT).sort((x, y) => x[1] - y[1]);
  return (
    <StorySection id="online" label="在线多人">
      <div className="story-copy story-left story-top">
        <Reveal at={0.02} out={0.66} span={0.06}>
          <Eyebrow n="04">PLAY TOGETHER</Eyebrow>
          <h2 className="story-title">和朋友一起上桌。</h2>
        </Reveal>
        <ol className="online-steps">
          {STEPS.map((t, i) => (
            <Reveal key={t} as="li" at={0.08 + i * 0.07} out={0.66} span={0.05}>
              <span className="online-step-n">{i + 1}</span>
              {t}
            </Reveal>
          ))}
        </ol>
      </div>
      <div className="online-side">
        <Reveal at={0.14} out={0.66} span={0.05} className="room-code">
          <span className="room-code-label">房间代码</span>
          <span className="room-code-value">K7Q2PX</span>
          <span className="room-code-note">示例</span>
        </Reveal>
        <div className="join-feed" aria-hidden>
          {joins.map(([k, t]) => {
            const sp = SPECIES_MAP[SEAT_SPECIES[Number(k)]];
            return (
              <Reveal key={k} at={t} out={0.66} span={0.03} className="join-item">
                <span className="join-emoji">{sp.emoji}</span>
                {sp.name} 加入了房间
              </Reveal>
            );
          })}
        </div>
      </div>
      <div className="story-copy story-center story-low">
        <Reveal at={0.7} span={0.08}>
          <h2 className="story-title story-title-xl">你的牌桌。你的朋友。你的游戏。</h2>
        </Reveal>
        <Reveal at={0.78} span={0.08}>
          <p className="story-text">
            最多 {MAX_ROOM_PLAYERS} 人同桌 · 人数不够时房主可以添加 AI · 全程虚拟筹码，免费游玩
          </p>
          <div className="story-cta">
            <PremiumButton variant="primary" onClick={a.createRoom}>
              创建房间
            </PremiumButton>
            <PremiumButton variant="secondary" onClick={a.joinRoom}>
              加入房间
            </PremiumButton>
          </div>
        </Reveal>
      </div>
    </StorySection>
  );
}

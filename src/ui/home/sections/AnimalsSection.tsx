// 认识你的对手：动物依次登场（3D 舞台），文字介绍来自游戏里真实的性格与声音档案
import { SPECIES_MAP } from '../../../core/player/profile';
import { PERSONALITIES_BY_SPECIES, VOICE_PROFILES } from '../../../core/character/voice';
import { isSpeciesUnlocked, levelFromXp, unlockText } from '../../../progress/progression';
import { useProfile } from '../../../store/profileStore';
import { FEATURED_SPECIES } from '../homeTimeline';
import { Eyebrow, Reveal, StorySection } from '../HomeParts';
import { useHomeActions } from '../homeActions';
import { PremiumButton } from '../PremiumButton';

const N = FEATURED_SPECIES.length;

export function AnimalsSection() {
  const a = useHomeActions();
  const xp = useProfile((s) => s.xp);
  const achievements = useProfile((s) => s.achievements);
  const level = levelFromXp(xp);
  return (
    <StorySection id="animals" label="动物角色">
      <div className="story-copy story-center story-top">
        <Reveal at={0.005} out={0.07} span={0.025}>
          <Eyebrow n="02">MEET THE PLAYERS</Eyebrow>
          <h2 className="story-title">认识你的对手。</h2>
        </Reveal>
      </div>
      {FEATURED_SPECIES.map((sp, i) => {
        const persona = PERSONALITIES_BY_SPECIES[sp];
        const voice = VOICE_PROFILES[sp];
        const info = SPECIES_MAP[sp];
        const unlocked = isSpeciesUnlocked(sp, level, achievements);
        const seg = 1 / N;
        const t0 = i * seg;
        return (
          <div key={sp} className="animal-card">
            <Reveal at={t0 + seg * 0.42} out={t0 + seg * 0.82} span={seg * 0.1} className="animal-index">
              {String(i + 1).padStart(2, '0')} / {String(N).padStart(2, '0')}
            </Reveal>
            <Reveal at={t0 + seg * 0.45} out={t0 + seg * 0.82} span={seg * 0.12} as="h3" className="animal-name">
              {persona.name}
            </Reveal>
            <Reveal at={t0 + seg * 0.52} out={t0 + seg * 0.82} span={seg * 0.12} className="animal-traits">
              {persona.personalityTraits.join(' · ')}
            </Reveal>
            <Reveal at={t0 + seg * 0.58} out={t0 + seg * 0.82} span={seg * 0.12} as="p" className="animal-desc">
              {info.desc} 打法：{persona.pokerStyle}。
            </Reveal>
            <Reveal at={t0 + seg * 0.64} out={t0 + seg * 0.82} span={seg * 0.12} className="animal-meta">
              <span className="animal-quote">“{persona.catchphrases[0]}”</span>
              <span className="animal-voice">声音：{voice.personality.tone}</span>
              <span className={`animal-lock ${unlocked ? 'ok' : ''}`}>{unlocked ? '可在动物创建器中选择' : unlockText(sp)}</span>
            </Reveal>
            {i === N - 1 && (
              <Reveal at={t0 + seg * 0.7} out={t0 + seg * 0.84} span={seg * 0.1} className="animal-cta">
                <PremiumButton variant="secondary" onClick={a.creator}>
                  创建你自己的动物
                </PremiumButton>
              </Reveal>
            )}
          </div>
        );
      })}
    </StorySection>
  );
}

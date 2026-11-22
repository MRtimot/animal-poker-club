// 挑战动物牌手：对面的狼看牌、思考、开口说话、跟注
// 台词来自游戏真实的台词库；“听它说”使用真实的角色语音系统（设备自带语音合成）
import { useMemo, useState } from 'react';
import { pickLine } from '../../../core/character/dialogue';
import { PERSONALITIES, DIFFICULTY_NAME } from '../../../core/ai/ai';
import { SPECIES_MAP } from '../../../core/player/profile';
import { playDialogue } from '../../../animation/dialoguePlayback';
import { voice } from '../../../audio/voice';
import { getHomeCast, RIVAL } from '../../../three/scenes/homeCast';
import { Eyebrow, Reveal, StorySection } from '../HomeParts';
import { useHomeActions } from '../homeActions';
import { PremiumButton } from '../PremiumButton';

const SPEAKER = `home-seat-${RIVAL}`;

export function AISection() {
  const a = useHomeActions();
  const wolf = getHomeCast().seats[RIVAL];
  const name = SPECIES_MAP[wolf.species].name;
  const emoji = SPECIES_MAP[wolf.species].emoji;
  const lines = useMemo(() => {
    const sp = { id: SPEAKER, species: wolf.species, isAI: true };
    return { think: pickLine(sp, 'think', () => 0.4)!, call: pickLine(sp, 'call', () => 0.9, { strength: 'strong' })! };
  }, [wolf.species]);
  const [note, setNote] = useState('');
  const [speaking, setSpeaking] = useState(false);

  const listen = async () => {
    if (speaking) return;
    setSpeaking(true);
    setNote('');
    try {
      const r1 = await playDialogue(SPEAKER, lines.think.text, lines.think.ref, wolf, { name, bubble: false, withVoice: true });
      if (r1 === 'spoken') await playDialogue(SPEAKER, lines.call.text, lines.call.ref, wolf, { name, bubble: false, withVoice: true });
      if (r1 === 'off') setNote('角色语音已在设置中关闭');
      else if (r1 === 'text-only') setNote(voice.status() === 'ok' ? '请再点一次（浏览器需要先点击页面才能发声）' : '当前设备不支持角色语音，只显示字幕');
    } finally {
      setSpeaking(false);
    }
  };

  return (
    <StorySection id="ai" label="AI 对战">
      <div className="story-copy story-left story-top">
        <Reveal at={0.02} out={0.38} span={0.06}>
          <Eyebrow n="05">PLAY AGAINST THE CLUB</Eyebrow>
          <h2 className="story-title">挑战动物牌手。</h2>
        </Reveal>
        <Reveal at={0.1} out={0.38} span={0.06} as="p" className="story-text">
          {Object.keys(PERSONALITIES).length} 种性格 × {Object.keys(DIFFICULTY_NAME).length} 种难度。AI 用本地逻辑思考和下注，不调用任何付费 AI 服务；每只动物都有自己的声音和说话方式。
        </Reveal>
      </div>
      <div className="ai-dialogue" aria-live="off">
        <Reveal at={0.44} out={0.62} span={0.04} className="ai-bubble">
          <span className="ai-speaker">
            {emoji} {name}
          </span>
          {lines.think.text}
        </Reveal>
        <Reveal at={0.64} span={0.03} className="ai-action">
          {emoji} {name} · 跟注 400
        </Reveal>
        <Reveal at={0.67} span={0.04} className="ai-bubble">
          <span className="ai-speaker">
            {emoji} {name}
          </span>
          {lines.call.text}
        </Reveal>
      </div>
      <div className="story-copy story-left ai-cta">
        <Reveal at={0.74} span={0.08}>
          <div className="story-cta">
            <PremiumButton variant="primary" onClick={a.aiMode}>
              挑战 AI
            </PremiumButton>
            <PremiumButton variant="secondary" onClick={listen} disabled={speaking}>
              {speaking ? '正在说话…' : `🔊 听${name}说一句`}
            </PremiumButton>
          </div>
          {note && <p className="story-note">{note}</p>}
        </Reveal>
      </div>
    </StorySection>
  );
}

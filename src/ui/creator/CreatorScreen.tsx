import { useMemo, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { useProfile } from '../../store/profileStore';
import {
  ACCESSORIES, AnimalConfig, DEFAULT_ANIMAL, EAR_STYLES, EXPRESSIONS, EYEBROWS, EYE_COLORS, FACE_SHAPES, FUR_COLORS,
  GLASSES, HATS, MOUTHS, NAME_IDEAS, OUTFITS, OUTFIT_COLORS, RARITY_COLOR, RARITY_NAME, SPECIES, SPECIES_MAP, randomAnimal, type Species,
} from '../../core/player/profile';
import { isSpeciesUnlocked, levelFromXp, unlockText } from '../../progress/progression';
import { BackButton, Btn, Seg } from '../common/ui';
import type { AnimName } from '../../store/fxStore';
import { net } from '../../net/netClient';
import { sound } from '../../audio/sound';
import { useAccount } from '../../store/accountStore';
import { EMOTIONS, EMOTION_NAME, PERSONALITIES_BY_SPECIES, VOICE_PRESETS, resolveVoiceProfile, type AnimalEmotion, type VoicePresetId } from '../../core/character/voice';
import { DIALOGUE_EVENT_NAME, pickLine, type DialogueEvent } from '../../core/character/dialogue';
import { planSpeech } from '../../core/character/prosody';
import { playDialogue } from '../../animation/dialoguePlayback';
import { voice } from '../../audio/voice';
import { CREATOR_SPEAKER } from '../../three/scenes/ShowcaseScenes';
import { nicknameError } from '../../core/account/types';

type Tab = 'species' | 'look' | 'face' | 'outfit' | 'hat' | 'glasses' | 'acc' | 'voice';
const TABS: { id: Tab; label: string }[] = [
  { id: 'species', label: '动物' },
  { id: 'look', label: '外观' },
  { id: 'face', label: '面部' },
  { id: 'outfit', label: '服装' },
  { id: 'hat', label: '帽子' },
  { id: 'glasses', label: '眼镜' },
  { id: 'acc', label: '配件' },
  { id: 'voice', label: '声音' },
];

const PREVIEW_ANIMS: { name: AnimName; label: string }[] = [
  { name: 'wave', label: '👋 挥手' },
  { name: 'happy', label: '😊 开心' },
  { name: 'win', label: '🏆 胜利' },
  { name: 'lose', label: '😩 失败' },
  { name: 'angry', label: '😠 生气' },
  { name: 'surprised', label: '😮 惊讶' },
  { name: 'nervous', label: '😰 紧张' },
  { name: 'allin', label: '💥 全押' },
  { name: 'laugh', label: '😂 大笑' },
  { name: 'talk', label: '💬 说话' },
];

export function CreatorScreen({ onAnim }: { onAnim: (a: { name: AnimName; start: number }) => void }) {
  const setScreen = useGame((s) => s.setScreen);
  const toast = useGame((s) => s.toast);
  const name = useProfile((s) => s.name);
  const animal = useProfile((s) => s.animal);
  const setName = useProfile((s) => s.setName);
  const setAnimal = useProfile((s) => s.setAnimal);
  const save = useProfile((s) => s.saveCharacter);
  const xp = useProfile((s) => s.xp);
  const achievements = useProfile((s) => s.achievements);
  const level = levelFromXp(xp);
  const [tab, setTab] = useState<Tab>('species');
  const signedIn = useAccount((s) => s.status === 'signedIn');

  const patch = (p: Partial<AnimalConfig>) => {
    setAnimal({ ...animal, ...p });
    sound.play('pop');
  };
  const unlockedSpecies = SPECIES.filter((s) => isSpeciesUnlocked(s.id, level, achievements)).map((s) => s.id);

  const options = <T extends string>(list: readonly { id: T; name: string }[], key: keyof AnimalConfig) => (
    <Seg options={list.map((o) => ({ value: o.id, label: o.name }))} value={animal[key] as T} onChange={(v) => patch({ [key]: v } as any)} />
  );

  const play = (n: AnimName) => onAnim({ name: n, start: performance.now() / 1000 });

  return (
    <>
      <BackButton onClick={() => setScreen('home')} label="首页" />
      <div className="preview-name">{name || '给你的动物取个名字'}</div>
      <div className="screen creator">
        <div className="panel creator-left">
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="tab-body">
            {tab === 'species' && (
              <div className="species-grid">
                {SPECIES.map((s) => {
                  const ok = unlockedSpecies.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      className={`species-btn ${animal.species === s.id ? 'on' : ''} ${ok ? '' : 'locked'}`}
                      onClick={() => {
                        if (!ok) {
                          toast(`🔒 ${s.name}：${unlockText(s.id)}`);
                          return;
                        }
                        patch({ species: s.id, furColor: 'default', ears: 'default' });
                        play('wave');
                      }}
                      title={ok ? s.desc : unlockText(s.id)}
                    >
                      {!ok && <span className="lock">🔒</span>}
                      <span className="e">{s.emoji}</span>
                      <span className="n">{s.name}</span>
                      <span className="r" style={{ color: RARITY_COLOR[s.rarity] }}>
                        {RARITY_NAME[s.rarity]}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {tab === 'look' && (
              <>
                <div className="field">
                  <label>毛色</label>
                  <div className="swatches">
                    {FUR_COLORS.map((f) => (
                      <div key={f.id}>
                        <div
                          className={`swatch ${animal.furColor === f.id ? 'on' : ''}`}
                          style={{ background: f.hex || `conic-gradient(${SPECIES_MAP[animal.species].color} 0 50%, #fff 0)` }}
                          onClick={() => patch({ furColor: f.id })}
                          title={f.name}
                        />
                        <div className="swatch-label">{f.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>眼睛颜色</label>
                  <div className="swatches">
                    {EYE_COLORS.map((f) => (
                      <div key={f.id}>
                        <div className={`swatch ${animal.eyeColor === f.id ? 'on' : ''}`} style={{ background: f.hex }} onClick={() => patch({ eyeColor: f.id })} />
                        <div className="swatch-label">{f.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>眼睛大小：{Math.round(animal.eyeSize * 100)}%</label>
                  <input className="range" type="range" min={0.7} max={1.4} step={0.05} value={animal.eyeSize} onChange={(e) => setAnimal({ ...animal, eyeSize: Number(e.target.value) })} />
                </div>
                <div className="field">
                  <label>耳朵</label>
                  {options(EAR_STYLES, 'ears')}
                </div>
              </>
            )}

            {tab === 'face' && (
              <>
                <div className="field">
                  <label>表情</label>
                  {options(EXPRESSIONS, 'expression')}
                </div>
                <div className="field">
                  <label>眉毛</label>
                  {options(EYEBROWS, 'eyebrows')}
                </div>
                <div className="field">
                  <label>嘴巴</label>
                  {options(MOUTHS, 'mouth')}
                </div>
                <div className="field">
                  <label>脸型</label>
                  {options(FACE_SHAPES, 'face')}
                </div>
              </>
            )}

            {tab === 'outfit' && (
              <>
                <div className="field">
                  <label>服装</label>
                  {options(OUTFITS, 'outfit')}
                </div>
                <div className="field">
                  <label>服装 / 配件主色</label>
                  <div className="swatches">
                    {OUTFIT_COLORS.map((c) => (
                      <div key={c} className={`swatch ${animal.outfitColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => patch({ outfitColor: c })} />
                    ))}
                  </div>
                </div>
              </>
            )}
            {tab === 'hat' && (
              <div className="field">
                <label>帽子</label>
                {options(HATS, 'hat')}
              </div>
            )}
            {tab === 'glasses' && (
              <div className="field">
                <label>眼镜</label>
                {options(GLASSES, 'glasses')}
              </div>
            )}
            {tab === 'acc' && (
              <div className="field">
                <label>特殊配件</label>
                {options(ACCESSORIES, 'accessory')}
              </div>
            )}
            {tab === 'voice' && <VoiceTab animal={animal} name={name} onChange={(a) => setAnimal(a)} />}
          </div>
        </div>

        <div className="panel creator-right">
          <div className="field" style={{ marginBottom: 4 }}>
            <label>动物名字（显示在头顶）</label>
            <input className="input" value={name} maxLength={12} placeholder="例如：小橘" onChange={(e) => setName(e.target.value)} />
            {nicknameError(name) && (
              <div className="small err-text" style={{ marginTop: 4 }}>
                {/* 游客可以在本机使用这个名字，但在线房间会改用系统分配的名字：提前告诉玩家，而不是进房间后才发现名字变了 */}
                {nicknameError(name)}
                {signedIn ? '（不会保存）' : '（在线房间里会显示为系统分配的名字）'}
              </div>
            )}
          </div>
          <div className="name-ideas">
            {NAME_IDEAS.slice(0, 8).map((n) => (
              <button key={n} onClick={() => setName(n)}>
                {n}
              </button>
            ))}
          </div>
          <div className="small muted hide-sm">试试动作：</div>
          <div className="anim-buttons">
            {PREVIEW_ANIMS.map((a) => (
              <button key={a.name} className="btn btn-ghost btn-sm" onClick={() => play(a.name)}>
                {a.label}
              </button>
            ))}
          </div>
          <div className="row">
            <Btn
              kind="ghost"
              className="grow"
              onClick={() => {
                setAnimal(randomAnimal(Math.random, unlockedSpecies));
                setName(NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)]);
                play('happy');
              }}
            >
              🎲 随机生成
            </Btn>
            <Btn
              kind="ghost"
              className="grow"
              onClick={() => {
                setAnimal({ ...DEFAULT_ANIMAL, species: unlockedSpecies.includes(animal.species) ? animal.species : 'cat' });
              }}
            >
              ↺ 重新设置
            </Btn>
          </div>
          <div className="row">
            <Btn
              kind="cyan"
              className="grow"
              onClick={() => {
                if (!name.trim()) return toast('请先给动物取个名字', 'error');
                const c = save();
                net.updateProfile();
                toast(`已保存角色「${c.name}」`, 'success');
                play('win');
              }}
            >
              💾 保存角色
            </Btn>
            <Btn
              kind="pink"
              className="grow"
              onClick={() => {
                if (!name.trim()) return toast('请先给动物取个名字', 'error');
                save();
                net.updateProfile();
                setScreen('quick');
              }}
            >
              进入游戏 →
            </Btn>
          </div>
        </div>
      </div>
      <div className="creator-hint">🖱️ 拖动旋转 · 滚轮缩放 · 360° 查看</div>
    </>
  );
}

// ───────────── 角色声音（动物创建器） ─────────────

const SHOW_VOICE_DEBUG = import.meta.env.DEV || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug'));

function VoiceTab({ animal, name, onChange }: { animal: AnimalConfig; name: string; onChange: (a: AnimalConfig) => void }) {
  const v = animal.voice ?? { preset: 'auto' as VoicePresetId, pitch: 0, rate: 0 };
  const profile = resolveVoiceProfile(animal);
  const persona = PERSONALITIES_BY_SPECIES[animal.species];
  const [line, setLine] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const setVoice = (patch: Partial<typeof v>) => onChange({ ...animal, voice: { ...v, ...patch } });

  const tryVoice = async () => {
    const sample = pickLine({ id: CREATOR_SPEAKER, species: animal.species, style: profile.style, catchphrase: animal.catchphrase, isAI: true }, animal.catchphrase ? 'catchphrase' : 'greet', Math.random);
    if (!sample) return;
    setLine(sample.text);
    const r = await playDialogue(CREATOR_SPEAKER, sample.text, sample.ref, animal, { name: name || persona.name, bubble: false });
    setResult(r === 'spoken' ? null : r === 'text-only' ? voiceUnavailableText() : r === 'off' ? '角色语音已在设置中关闭，只播放了说话动画' : null);
  };

  return (
    <>
      <div className="field">
        <label>声音风格</label>
        <Seg options={VOICE_PRESETS.map((p) => ({ value: p.id, label: p.name }))} value={v.preset} onChange={(preset) => setVoice({ preset })} />
      </div>
      <div className="field">
        <label>音高微调：{v.pitch > 0 ? '+' : ''}{v.pitch.toFixed(2)}</label>
        <input className="range" type="range" min={-0.5} max={0.5} step={0.05} value={v.pitch} onChange={(e) => setVoice({ pitch: Number(e.target.value) })} />
      </div>
      <div className="field">
        <label>语速微调：{v.rate > 0 ? '+' : ''}{v.rate.toFixed(2)}</label>
        <input className="range" type="range" min={-0.5} max={0.5} step={0.05} value={v.rate} onChange={(e) => setVoice({ rate: Number(e.target.value) })} />
      </div>
      <div className="field">
        <label>口头禅（AI 对手偶尔会说，最多 24 个字）</label>
        <input
          className="input"
          value={animal.catchphrase ?? ''}
          maxLength={24}
          placeholder={persona.catchphrases[0]}
          onChange={(e) => onChange({ ...animal, catchphrase: e.target.value || undefined })}
        />
      </div>
      <div className="small muted" style={{ marginBottom: 8, lineHeight: 1.6 }}>
        性格：{persona.personalityTraits.join('、')} · 说话方式：{profile.personality.speakingStyle}
      </div>
      <Btn kind="cyan" onClick={tryVoice}>
        ▶ 试听
      </Btn>
      {line && <div className="voice-line">“{line}”</div>}
      {result && <div className="small muted" style={{ marginTop: 4 }}>{result}</div>}
      {SHOW_VOICE_DEBUG && <VoiceDebug animal={animal} />}
    </>
  );
}

function voiceUnavailableText() {
  const st = voice.status();
  if (st === 'unsupported') return '🔇 当前设备不支持角色语音，只显示字幕与说话动画';
  if (st === 'no-chinese-voice') return '🔇 当前设备没有中文语音，只显示字幕与说话动画';
  return '浏览器需要先点击页面才能发声（自动播放限制），请再点一次试听';
}

/** 开发者调试：任意动物 × 情绪 × 牌局事件，测试语音 / 动画 / 完整台词 */
function VoiceDebug({ animal }: { animal: AnimalConfig }) {
  const [species, setSpecies] = useState<Species>(animal.species);
  const [emotion, setEmotion] = useState<AnimalEmotion>('confident');
  const [event, setEvent] = useState<DialogueEvent>('react_allin');
  const [out, setOut] = useState('');
  const test = { ...animal, species, voice: undefined };
  const profile = resolveVoiceProfile(test);
  const [strength, setStrength] = useState<'' | 'strong' | 'weak' | 'bluff'>('');
  const [variant, setVariant] = useState(0);
  const ctx = strength === 'bluff' ? { bluff: true } : strength ? { strength } : {};
  const line = useMemo(() => pickLine({ id: CREATOR_SPEAKER, species, isAI: true }, event, Math.random, ctx), [species, event, strength, variant]); // eslint-disable-line
  const text = line?.text ?? '……';
  const plan = useMemo(() => planSpeech(text, profile, emotion, Math.random), [text, profile.voiceId, emotion, variant]); // eslint-disable-line
  const picked = voice.status() === 'ok' ? voice.pickVoice(profile) : null;
  return (
    <div className="voice-debug">
      <div className="vd-title">AI VOICE DEBUG</div>
      <div className="vd-row">
        <span>Character</span>
        <select className="select" value={species} onChange={(e) => setSpecies(e.target.value as Species)}>
          {SPECIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.emoji} {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="vd-row">
        <span>Emotion</span>
        <select className="select" value={emotion} onChange={(e) => setEmotion(e.target.value as AnimalEmotion)}>
          {EMOTIONS.map((e) => (
            <option key={e} value={e}>
              {EMOTION_NAME[e]}
            </option>
          ))}
        </select>
      </div>
      <div className="vd-row">
        <span>Event</span>
        <select className="select" value={event} onChange={(e) => setEvent(e.target.value as DialogueEvent)}>
          {(Object.keys(DIALOGUE_EVENT_NAME) as DialogueEvent[]).map((k) => (
            <option key={k} value={k}>
              {DIALOGUE_EVENT_NAME[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="vd-row">
        <span>Context</span>
        <select className="select" value={strength} onChange={(e) => setStrength(e.target.value as typeof strength)}>
          <option value="">普通</option>
          <option value="strong">牌好</option>
          <option value="weak">牌差</option>
          <option value="bluff">诈唬</option>
        </select>
      </div>
      <div className="vd-info">
        Voice: {picked ? `${picked.name} (${picked.lang})` : `无可用中文语音（${voice.status()}）`} · Quality: System Voice
        <br />
        Pitch {profile.pitch.toFixed(2)} · Rate {profile.speed.toFixed(2)} · Style {profile.style}
        <br />
        Dialogue: “{text}”{' '}
        <a href="#" onClick={(e) => (e.preventDefault(), setVariant((x) => x + 1))}>
          换一句
        </a>
        <br />
        Prosody: 开口前 {plan.leadInMs}ms
        {plan.segments.map((g, i) => (
          <span key={i} className="vd-seg">
            {' '}
            [{g.kind === 'hesitation' ? '犹豫' : g.kind === 'stutter' ? '结巴' : '句'}] “{g.text}” p{g.pitch.toFixed(2)} r{g.rate.toFixed(2)} v{g.volume.toFixed(2)}
            {g.pauseAfterMs ? ` → 停 ${g.pauseAfterMs}ms` : ''}
          </span>
        ))}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <Btn size="sm" kind="ghost" onClick={async () => setOut(await voice.speak(text, profile, { emotion, priority: 3, plan }))}>
          ▶ Test Voice（自然）
        </Btn>
        <Btn size="sm" kind="ghost" onClick={async () => setOut(await voice.speak(text, profile, { emotion, priority: 3, natural: false }))}>
          ▶ 对比：平直念稿
        </Btn>
        <Btn size="sm" kind="ghost" onClick={async () => setOut(await playDialogue(CREATOR_SPEAKER, text, { emotion, event }, test, { name: '调试', withVoice: false, bubble: false }))}>
          ▶ Test Animation
        </Btn>
        <Btn size="sm" kind="ghost" onClick={async () => setOut(await playDialogue(CREATOR_SPEAKER, text, { emotion, event }, test, { name: '调试', bubble: false }))}>
          ▶ Test Full Dialogue
        </Btn>
      </div>
      {out && <div className="vd-info">结果：{out}</div>}
    </div>
  );
}

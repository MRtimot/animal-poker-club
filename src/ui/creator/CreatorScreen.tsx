import { useState } from 'react';
import { useGame } from '../../store/gameStore';
import { useProfile } from '../../store/profileStore';
import {
  ACCESSORIES, AnimalConfig, DEFAULT_ANIMAL, EAR_STYLES, EXPRESSIONS, EYEBROWS, EYE_COLORS, FACE_SHAPES, FUR_COLORS,
  GLASSES, HATS, MOUTHS, NAME_IDEAS, OUTFITS, OUTFIT_COLORS, RARITY_COLOR, RARITY_NAME, SPECIES, SPECIES_MAP, randomAnimal,
} from '../../core/player/profile';
import { isSpeciesUnlocked, levelFromXp, unlockText } from '../../progress/progression';
import { BackButton, Btn, Seg } from '../common/ui';
import type { AnimName } from '../../store/fxStore';
import { net } from '../../net/netClient';
import { sound } from '../../audio/sound';

type Tab = 'species' | 'look' | 'face' | 'outfit' | 'hat' | 'glasses' | 'acc';
const TABS: { id: Tab; label: string }[] = [
  { id: 'species', label: '动物' },
  { id: 'look', label: '外观' },
  { id: 'face', label: '面部' },
  { id: 'outfit', label: '服装' },
  { id: 'hat', label: '帽子' },
  { id: 'glasses', label: '眼镜' },
  { id: 'acc', label: '配件' },
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
          </div>
        </div>

        <div className="panel creator-right">
          <div className="field" style={{ marginBottom: 4 }}>
            <label>动物名字（显示在头顶）</label>
            <input className="input" value={name} maxLength={12} placeholder="例如：小橘" onChange={(e) => setName(e.target.value)} />
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

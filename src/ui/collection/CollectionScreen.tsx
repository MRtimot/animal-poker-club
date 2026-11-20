import { useState } from 'react';
import { useGame } from '../../store/gameStore';
import { useProfile } from '../../store/profileStore';
import { RARITY_COLOR, RARITY_NAME, SPECIES, SPECIES_MAP } from '../../core/player/profile';
import { ACHIEVEMENTS, isSpeciesUnlocked, levelFromXp, unlockText } from '../../progress/progression';
import { HAND_NAME } from '../../core/poker/handEvaluator';
import { Avatar, BackButton, Btn, LevelBar, Seg } from '../common/ui';
import { formatChips, timeAgo } from '../../utils/format';

type Tab = 'dex' | 'chars' | 'ach' | 'stats';

export function CollectionScreen() {
  const setScreen = useGame((s) => s.setScreen);
  const toast = useGame((s) => s.toast);
  const p = useProfile();
  const level = levelFromXp(p.xp);
  const [tab, setTab] = useState<Tab>('dex');
  const unlocked = SPECIES.filter((s) => isSpeciesUnlocked(s.id, level, p.achievements)).length;

  return (
    <div className="screen collection">
      <BackButton onClick={() => setScreen('home')} label="首页" />
      <div className="panel">
        <div style={{ padding: '18px 18px 0' }}>
          <div className="row wrap" style={{ marginBottom: 12 }}>
            <h2 className="grow">📚 我的收藏</h2>
            <div style={{ minWidth: 260 }}>
              <LevelBar />
            </div>
          </div>
          <Seg
            options={[
              { value: 'dex', label: `动物图鉴 ${unlocked}/${SPECIES.length}` },
              { value: 'chars', label: `我的角色 ${p.characters.length}` },
              { value: 'ach', label: `成就 ${Object.keys(p.achievements).length}/${ACHIEVEMENTS.length}` },
              { value: 'stats', label: '统计' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
          {tab === 'dex' && (
            <>
              {(['common', 'rare', 'epic', 'legendary'] as const).map((r) => (
                <div key={r} style={{ marginBottom: 18 }}>
                  <h3 style={{ color: RARITY_COLOR[r], marginBottom: 10 }}>{RARITY_NAME[r]}</h3>
                  <div className="dex-grid">
                    {SPECIES.filter((s) => s.rarity === r).map((s) => {
                      const ok = isSpeciesUnlocked(s.id, level, p.achievements);
                      return (
                        <div key={s.id} className={`dex-card ${ok ? '' : 'locked'}`} style={{ borderColor: ok ? RARITY_COLOR[r] + '88' : 'transparent' }}>
                          <div className="e">{s.emoji}</div>
                          <div style={{ fontWeight: 800 }}>{s.name}</div>
                          <div className="rar" style={{ color: RARITY_COLOR[r] }}>
                            {RARITY_NAME[r]}
                          </div>
                          <div className="desc">{ok ? s.desc : `🔒 ${unlockText(s.id)}`}</div>
                          {ok && (
                            <div className="small gold" style={{ marginTop: 4 }}>
                              胜利 {p.stats.speciesWins[s.id] ?? 0} 次
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <p className="small muted">通过游戏进度、等级与成就解锁动物，不涉及任何真钱购买。</p>
            </>
          )}

          {tab === 'chars' && (
            <>
              {p.characters.length === 0 && <p className="muted">还没有保存的角色。去「动物创建器」打造一只属于你的动物吧！</p>}
              {p.characters.map((c) => (
                <div className="member" key={c.id}>
                  <Avatar animal={c.animal} />
                  <div className="info">
                    <div className="name">{c.name}</div>
                    <div className="sub">
                      {SPECIES_MAP[c.animal.species].name} · {timeAgo(c.createdAt)}
                    </div>
                  </div>
                  <Btn
                    size="sm"
                    onClick={() => {
                      p.useCharacter(c.id);
                      toast(`已切换为「${c.name}」`, 'success');
                    }}
                  >
                    使用
                  </Btn>
                  <Btn size="sm" kind="ghost" onClick={() => p.deleteCharacter(c.id)}>
                    删除
                  </Btn>
                </div>
              ))}
              <Btn kind="pink" onClick={() => setScreen('creator')}>
                🐾 打开动物创建器
              </Btn>
            </>
          )}

          {tab === 'ach' &&
            ACHIEVEMENTS.map((a) => {
              const t = p.achievements[a.id];
              return (
                <div key={a.id} className={`ach ${t ? '' : 'locked'}`}>
                  <div className="i">{a.icon}</div>
                  <div className="grow">
                    <div style={{ fontWeight: 800 }}>{a.name}</div>
                    <div className="small muted">{a.desc}</div>
                  </div>
                  <div className="small">{t ? <span className="gold">✔ {timeAgo(t)}</span> : <span className="muted">未达成</span>}</div>
                </div>
              );
            })}

          {tab === 'stats' && (
            <>
              <div className="stat-grid" style={{ marginBottom: 18 }}>
                {[
                  ['完成局数', p.stats.handsPlayed],
                  ['获胜局数', p.stats.handsWon],
                  ['胜率', p.stats.handsPlayed ? Math.round((p.stats.handsWon / p.stats.handsPlayed) * 100) + '%' : '0%'],
                  ['当前连胜', p.stats.currentStreak],
                  ['最高连胜', p.stats.bestStreak],
                  ['全押获胜', p.stats.allInWins],
                  ['最大底池', formatChips(p.stats.biggestPot)],
                  ['最好牌型', p.stats.bestHand >= 0 ? HAND_NAME[p.stats.bestHand as 0] : '—'],
                  ['比赛场次', p.stats.gamesPlayed],
                  ['冠军次数', p.stats.gamesWon],
                  ['在线局数', p.stats.onlineHands],
                  ['总经验', p.xp],
                ].map(([k, v]) => (
                  <div className="stat" key={k as string}>
                    <b>{v}</b>
                    <span>{k}</span>
                  </div>
                ))}
              </div>
              <h3 style={{ marginBottom: 10 }}>最近游戏</h3>
              {p.recent.length === 0 && <p className="muted">暂无记录</p>}
              {p.recent.map((r, i) => (
                <div key={i} className="rank-row">
                  <div className="place">{r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : r.place}</div>
                  <div className="grow">
                    <div style={{ fontWeight: 700 }}>
                      {r.mode === 'online' ? '在线房间' : 'AI 对战'} · {r.players} 人
                    </div>
                    <div className="small muted">
                      {r.hands} 手牌 · 剩余 {formatChips(r.chips)} 筹码 · {timeAgo(r.time)}
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

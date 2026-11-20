import { useState } from 'react';
import { useGame } from '../../store/gameStore';
import { useProfile } from '../../store/profileStore';
import { SPECIES_MAP } from '../../core/player/profile';
import { Avatar, Btn, LevelBar } from '../common/ui';
import { RulesModal } from '../common/RulesModal';

export function HomeScreen() {
  const setScreen = useGame((s) => s.setScreen);
  const set = useGame((s) => s.set);
  const name = useProfile((s) => s.name);
  const animal = useProfile((s) => s.animal);
  const created = useProfile((s) => s.createdCharacter);
  const stats = useProfile((s) => s.stats);
  const [rules, setRules] = useState(false);

  return (
    <div className="screen home">
      <div className="home-top">
        <div className="title-block">
          <div className="title">动物扑克俱乐部</div>
          <div className="subtitle">诈唬、策略与动物之间的较量</div>
          <div className="slogan">今天，谁才是真正的扑克王？</div>
          <div className="founder-badge">
            <span className="founder-crown">👑</span>
            <span className="founder-label">创始人</span>
            <span className="founder-name">Timothy Ong</span>
          </div>
        </div>
        <div className="panel profile-chip">
          <Avatar animal={animal} />
          <div className="grow">
            <div style={{ fontWeight: 800 }}>
              {name} <span className="muted small">· {SPECIES_MAP[animal.species].name}</span>
            </div>
            <LevelBar />
            <div className="small muted" style={{ marginTop: 4 }}>
              已玩 {stats.handsPlayed} 局 · 赢 {stats.handsWon} 局
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="home-menu">
          <Btn kind="pink" size="lg" className="primary" onClick={() => setScreen(created ? 'quick' : 'creator')}>
            🎮 开始游戏
          </Btn>
          <Btn
            kind="cyan"
            onClick={() => {
              set({ onlineTab: 'create' });
              setScreen('online');
            }}
          >
            🏠 创建房间
          </Btn>
          <Btn
            kind="cyan"
            onClick={() => {
              set({ onlineTab: 'join' });
              setScreen('online');
            }}
          >
            🔑 加入房间
          </Btn>
          <Btn onClick={() => setScreen('creator')}>🐾 动物创建器</Btn>
          <Btn kind="ghost" onClick={() => setScreen('collection')}>
            📚 我的收藏
          </Btn>
          <Btn kind="ghost" onClick={() => setRules(true)}>
            📖 游戏规则
          </Btn>
          <Btn kind="ghost" onClick={() => setScreen('settings')}>
            ⚙️ 设置
          </Btn>
        </div>
        <div className="home-foot">仅使用虚拟筹码 · 无真钱交易 · 无第三方服务</div>
      </div>
      {rules && <RulesModal onClose={() => setRules(false)} />}
    </div>
  );
}

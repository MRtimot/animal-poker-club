import { useState } from 'react';
import { useGame } from '../../store/gameStore';
import { useProfile } from '../../store/profileStore';
import { Btn } from '../common/ui';
import { AccountChip } from '../account/AccountScreens';
import { RulesModal } from '../common/RulesModal';

export function HomeScreen() {
  const setScreen = useGame((s) => s.setScreen);
  const set = useGame((s) => s.set);
  const created = useProfile((s) => s.createdCharacter);
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
        <span className="founder-title">Founder of APEX</span>
          </div>
          <div className="tester-badge">
            <span className="tester-icon">🧪</span>
            <span className="tester-label">游戏测试员</span>
            <span className="tester-name">John</span>
          </div>
        </div>
        <AccountChip />
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
        <div className="home-foot">仅使用虚拟筹码 · 无真钱交易 · 登录仅用于保存游戏进度</div>
      </div>
      {rules && <RulesModal onClose={() => setRules(false)} />}
    </div>
  );
}

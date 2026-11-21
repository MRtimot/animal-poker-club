import { useEffect, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { BLIND_OPTIONS, CHIP_OPTIONS } from '../../core/protocol';
import { ROOM_CODE_LENGTH } from '../../core/utils/random';
import { net } from '../../net/netClient';
import { BackButton, Btn, Seg } from '../common/ui';
import { formatChips } from '../../utils/format';

function ConnStatus() {
  const conn = useGame((s) => s.conn);
  const map = {
    idle: ['未连接', 'off'],
    connecting: ['正在连接服务器…', 'off'],
    connected: ['已连接到服务器', ''],
    disconnected: ['无法连接服务器，正在重试…', 'off'],
  } as const;
  const [text, cls] = map[conn];
  return (
    <div className="row small" style={{ marginBottom: 14 }}>
      <span className={`dot ${cls}`} />
      <span className="muted">{text}</span>
    </div>
  );
}

export function OnlineScreen() {
  const setScreen = useGame((s) => s.setScreen);
  const tab = useGame((s) => s.onlineTab);
  const set = useGame((s) => s.set);
  const conn = useGame((s) => s.conn);
  const serverUrl = useSettings((s) => s.serverUrl);

  const [players, setPlayers] = useState(6);
  const [chips, setChips] = useState(1000);
  const [blinds, setBlinds] = useState(0);
  const [turn, setTurn] = useState(30);
  const [code, setCode] = useState('');

  useEffect(() => {
    net.connect();
  }, []);

  const create = () => {
    const [sb, bb] = BLIND_OPTIONS[blinds];
    net.updateProfile();
    net.createRoom({ maxPlayers: players, startingChips: chips, smallBlind: sb, bigBlind: bb, turnSeconds: turn });
  };
  const join = () => {
    const c = code.trim().toUpperCase();
    if (c.length !== ROOM_CODE_LENGTH) {
      useGame.getState().toast(`房间代码是 ${ROOM_CODE_LENGTH} 位字母或数字`, 'error');
      return;
    }
    net.updateProfile();
    net.joinRoom(c);
  };

  return (
    <div className="screen side-screen">
      <BackButton onClick={() => setScreen('home')} label="首页" />
      <div className="panel side-panel">
        <div className="panel-head">
          <h2 className="grow">🌏 在线房间</h2>
        </div>
        <ConnStatus />
        <div className="field">
          <Seg
            options={[
              { value: 'create', label: '🏠 创建房间' },
              { value: 'join', label: '🔑 加入房间' },
            ]}
            value={tab}
            onChange={(v) => set({ onlineTab: v })}
          />
        </div>

        {tab === 'create' ? (
          <>
            <div className="field">
              <label>玩家人数</label>
              <Seg options={[2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: n }))} value={players} onChange={setPlayers} />
            </div>
            <div className="field">
              <label>初始筹码</label>
              <Seg options={CHIP_OPTIONS.map((c) => ({ value: c, label: formatChips(c) }))} value={chips} onChange={setChips} />
            </div>
            <div className="field">
              <label>盲注</label>
              <Seg options={BLIND_OPTIONS.map(([s, b], i) => ({ value: i, label: `${s} / ${b}` }))} value={blinds} onChange={setBlinds} />
            </div>
            <div className="field">
              <label>每次行动时间</label>
              <Seg options={[15, 20, 30, 45, 60].map((n) => ({ value: n, label: `${n} 秒` }))} value={turn} onChange={setTurn} />
            </div>
            <Btn kind="pink" size="lg" block onClick={create} disabled={conn !== 'connected'}>
              创建房间
            </Btn>
            <p className="small muted" style={{ lineHeight: 1.7 }}>
              创建后会生成 {ROOM_CODE_LENGTH} 位房间代码（例如 <b className="gold">ABCD12</b>），把它发给朋友即可加入。人数不够时房主可以添加本地 AI。
            </p>
          </>
        ) : (
          <>
            <div className="field">
              <label>房间代码</label>
              <input
                className="input code-input"
                maxLength={ROOM_CODE_LENGTH}
                placeholder="ABCD12"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && join()}
                autoFocus
              />
            </div>
            <Btn kind="pink" size="lg" block onClick={join} disabled={conn !== 'connected'}>
              加入房间
            </Btn>
          </>
        )}

        <div className="grow" />
        <p className="small muted" style={{ lineHeight: 1.7, marginTop: 16 }}>
          服务器：{serverUrl || '当前网站自带的游戏服务器'}
          <br />
          联机由自建 WebSocket 服务器完成，不使用任何第三方服务。可在「设置」中修改服务器地址。
        </p>
      </div>
    </div>
  );
}

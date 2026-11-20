import { useState } from 'react';
import { useGame } from '../../store/gameStore';
import { net } from '../../net/netClient';
import { AIDifficulty, AIPersonality, DIFFICULTY_NAME, PERSONALITIES } from '../../core/ai/ai';
import { Avatar, Btn, Modal, Seg } from '../common/ui';
import { ChatPanel } from '../game/ChatPanel';
import { formatChips } from '../../utils/format';

export function RoomLobby() {
  const room = useGame((s) => s.room);
  const me = useGame((s) => s.playerId);
  const toast = useGame((s) => s.toast);
  const [addOpen, setAddOpen] = useState(false);
  const [aiP, setAiP] = useState<AIPersonality>('smartCat');
  const [aiD, setAiD] = useState<AIDifficulty>('normal');
  const [confirmLeave, setConfirmLeave] = useState(false);
  if (!room) return null;

  const isHost = room.hostId === me;
  const mine = room.members.find((m) => m.id === me);
  const full = room.members.length >= room.settings.maxPlayers;
  const notReady = room.members.filter((m) => !m.isAI && !m.ready);
  const canStart = isHost && room.members.length >= 2 && notReady.length === 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      toast(`已复制房间代码 ${room.code}`, 'success');
    } catch {
      toast(`房间代码：${room.code}`);
    }
  };

  return (
    <div className="screen side-screen">
      <ChatPanel side="left" />
      <div className="panel side-panel">
        <div className="panel-head">
          <div className="grow">
            <div className="small muted">房间代码</div>
            <div className="room-code" onClick={copy} style={{ cursor: 'pointer' }} title="点击复制">
              {room.code}
            </div>
          </div>
          <Btn kind="ghost" size="sm" onClick={copy}>
            📋 复制
          </Btn>
        </div>
        <div className="row wrap small muted" style={{ marginBottom: 14, gap: 6 }}>
          <span className="tag">👥 {room.members.length} / {room.settings.maxPlayers}</span>
          <span className="tag">🪙 {formatChips(room.settings.startingChips)}</span>
          <span className="tag">
            盲注 {room.settings.smallBlind}/{room.settings.bigBlind}
          </span>
          <span className="tag">⏱ {room.settings.turnSeconds} 秒</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {room.members.map((m, i) => (
            <div className="member" key={m.id}>
              <Avatar animal={m.profile.animal} />
              <div className="info">
                <div className="name">
                  {m.profile.name} {m.id === me && <span className="gold small">（你）</span>}
                </div>
                <div className="sub">
                  {m.isHost ? '房主' : m.isAI ? `${PERSONALITIES[m.aiPersonality!]?.name ?? 'AI'} · ${DIFFICULTY_NAME[m.aiDifficulty ?? 'normal']}` : `玩家 ${i}`} · 🪙{' '}
                  {formatChips(m.chips)}
                </div>
              </div>
              <span className={`dot ${m.connected ? '' : 'off'}`} title={m.connected ? '在线' : '离线'} />
              {m.isHost ? (
                <span className="tag host">👑 房主</span>
              ) : m.isAI ? (
                <span className="tag">AI</span>
              ) : m.ready ? (
                <span className="tag ready">已准备</span>
              ) : (
                <span className="tag wait">未准备</span>
              )}
              {isHost && m.id !== me && (
                <button className="icon-btn" style={{ width: 32, height: 32, fontSize: 14 }} title="移出" onClick={() => net.removeMember(m.id)}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {Array.from({ length: room.settings.maxPlayers - room.members.length }, (_, i) => (
            <div className="member" key={'empty' + i} style={{ opacity: 0.45 }}>
              <div className="avatar">❔</div>
              <div className="info">
                <div className="name">等待玩家加入…</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {isHost && (
            <Btn kind="ghost" block onClick={() => setAddOpen(true)} disabled={full}>
              🤖 添加本地 AI
            </Btn>
          )}
          {!isHost && (
            <Btn kind={mine?.ready ? 'ghost' : 'green'} size="lg" block onClick={() => net.ready(!mine?.ready)}>
              {mine?.ready ? '取消准备' : '✅ 准备'}
            </Btn>
          )}
          {isHost && (
            <Btn kind="pink" size="lg" block onClick={() => net.startGame()} disabled={!canStart}>
              🃏 开始游戏
            </Btn>
          )}
          {isHost && !canStart && (
            <div className="small muted center">
              {room.members.length < 2 ? '至少需要 2 名玩家，可以添加 AI' : `等待 ${notReady.map((m) => m.profile.name).join('、')} 准备`}
            </div>
          )}
          {!isHost && <div className="small muted center">所有玩家准备后，由房主开始游戏</div>}
          <Btn kind="ghost" size="sm" onClick={() => setConfirmLeave(true)}>
            离开房间
          </Btn>
        </div>
      </div>

      {addOpen && (
        <Modal
          title="🤖 添加本地 AI"
          onClose={() => setAddOpen(false)}
          actions={
            <>
              <Btn kind="ghost" onClick={() => setAddOpen(false)}>
                取消
              </Btn>
              <Btn
                onClick={() => {
                  net.addAI(aiP, aiD);
                  setAddOpen(false);
                }}
              >
                添加
              </Btn>
            </>
          }
        >
          <div className="field">
            <label>性格</label>
            <Seg options={(Object.keys(PERSONALITIES) as AIPersonality[]).map((k) => ({ value: k, label: PERSONALITIES[k].name }))} value={aiP} onChange={setAiP} />
            <div className="small muted" style={{ marginTop: 6 }}>
              {PERSONALITIES[aiP].desc}
            </div>
          </div>
          <div className="field">
            <label>难度</label>
            <Seg options={(['easy', 'normal', 'hard', 'expert'] as AIDifficulty[]).map((d) => ({ value: d, label: DIFFICULTY_NAME[d] }))} value={aiD} onChange={setAiD} />
          </div>
          <div className="small muted">AI 在服务器上用本地逻辑运行，不调用任何外部 AI 服务。</div>
        </Modal>
      )}
      {confirmLeave && (
        <Modal
          title="确定要离开房间吗？"
          onClose={() => setConfirmLeave(false)}
          actions={
            <>
              <Btn kind="ghost" onClick={() => setConfirmLeave(false)}>
                再等等
              </Btn>
              <Btn
                kind="red"
                onClick={() => {
                  net.leaveRoom();
                  useGame.getState().setScreen('online');
                }}
              >
                离开
              </Btn>
            </>
          }
        >
          <p className="muted">{isHost ? '你是房主，离开后房主将转交给其他玩家。' : '离开后需要重新输入房间代码才能回来。'}</p>
        </Modal>
      )}
    </div>
  );
}

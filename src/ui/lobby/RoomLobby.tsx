import { useState } from 'react';
import { useGame } from '../../store/gameStore';
import { net } from '../../net/netClient';
import { session } from '../../net/session';
import { AIDifficulty, AIPersonality, DIFFICULTY_NAME, PERSONALITIES } from '../../core/ai/ai';
import { Avatar, Btn, Modal, Seg, useBusy } from '../common/ui';
import { ChatPanel } from '../game/ChatPanel';
import { formatChips } from '../../utils/format';
import { useIsPC } from '../../utils/pc';
import { enterOnEntryGesture } from '../../display/fullscreen';
import { GAME_MODES, MODE_SUIT, gameModeOf, isHouseGame, type GameMode } from '../../core/gameMode';
import { VirtualTag } from '../notice/GameNotice';

export function RoomLobby() {
  const room = useGame((s) => s.room);
  const me = useGame((s) => s.playerId);
  const toast = useGame((s) => s.toast);
  const [addOpen, setAddOpen] = useState(false);
  const [aiP, setAiP] = useState<AIPersonality>('smartCat');
  const [aiD, setAiD] = useState<AIDifficulty>('easy');
  const [confirmLeave, setConfirmLeave] = useState(false);
  // 电脑版顶栏显示房间状态（移动端顶栏保持原样）；自己的连接中断时如实显示，而不是看起来一切正常
  const pc = useIsPC();
  const conn = useGame((s) => s.conn);
  // 防止重复点击“开始游戏”（房间状态改变或出现错误时恢复）。Hook 必须在提前返回之前调用
  const [starting, markStarting] = useBusy(room?.status);
  if (!room) return null;

  const isHost = room.hostId === me;
  const mine = room.members.find((m) => m.id === me);
  const full = room.members.length >= room.settings.maxPlayers;
  const notReady = room.members.filter((m) => !m.isAI && !m.ready);
  const mode = gameModeOf(room.settings);
  const bj = isHouseGame(mode);
  const minPlayers = GAME_MODES[mode].minPlayers;
  const canStart = isHost && room.members.length >= minPlayers && notReady.length === 0;
  const humans = room.members.filter((m) => !m.isAI).length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      toast(`已复制房间代码 ${room.code}`, 'success');
    } catch {
      toast(`房间代码：${room.code}`);
    }
  };

  return (
    <div className="screen side-screen lobby-screen">
      {/* 房间顶栏：返回 · 房间代码 · 人数 · 开始 / 准备 */}
      <header className="lbar">
        <button type="button" className="lbar-btn" aria-label="离开房间" title="离开房间" onClick={() => setConfirmLeave(true)}>
          <span aria-hidden>←</span>
          <span className="lbar-btn-text">返回</span>
        </button>
        <div className="lbar-center">
          <span className="lbar-cap">房间</span>
          <button type="button" className="lbar-code" onClick={copy} title="点击复制房间代码" aria-label={`房间代码 ${room.code}，点击复制`}>
            {room.code}
          </button>
          <span className="lbar-sep" aria-hidden />
          {pc && (
            <span className={`lbar-status ${conn !== 'connected' ? 'lost' : canStart ? 'ready' : ''}`} role="status">
              {conn !== 'connected'
                ? '连接中断，正在重新连接…'
                : room.members.length < minPlayers
                  ? '等待玩家加入'
                  : notReady.length
                    ? `等待 ${notReady.length} 位玩家准备`
                    : '全部就绪，可以开始'}
            </span>
          )}
          <span className="lbar-count" aria-label={`${room.members.length} / ${room.settings.maxPlayers} 名玩家`}>
            <b>{room.members.length}</b> / {room.settings.maxPlayers} 名玩家
            {humans < room.members.length && <small>（{room.members.length - humans} 个 AI）</small>}
          </span>
        </div>
        <div className="lbar-right">
          {isHost ? (
            <Btn
              kind="pink"
              onClick={() => {
                if (!markStarting()) return;
                enterOnEntryGesture();
                net.startGame();
              }}
              disabled={!canStart || starting}
              title={canStart ? '开始游戏' : room.members.length < minPlayers ? `至少需要 ${minPlayers} 名玩家` : '还有玩家没有准备'}
            >
              {starting ? '开始中…' : '开始游戏'}
            </Btn>
          ) : (
            <Btn kind={mine?.ready ? 'ghost' : 'green'} onClick={() => net.ready(!mine?.ready)}>
              {mine?.ready ? '取消准备' : '准备'}
            </Btn>
          )}
        </div>
      </header>
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
          <span className="tag">{bj ? `最低下注 ${room.settings.bigBlind}` : `盲注 ${room.settings.smallBlind}/${room.settings.bigBlind}`}</span>
          <span className="tag">⏱ {room.settings.turnSeconds} 秒</span>
          {room.expiresAt ? (
            <span className="tag" title="房间由服务器保留；断线不会马上失去座位，重新连上会回到这里">
              ⏳ 保留到 {new Date(room.expiresAt - net.serverOffset).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : null}
        </div>
        <VirtualTag compact className="lobby-virtual" />

        <div className="field lobby-mode">
          <label>游戏模式{isHost ? '' : '（由房主选择）'}</label>
          {isHost ? (
            <Seg options={(Object.keys(GAME_MODES) as GameMode[]).map((m) => ({ value: m, label: `${MODE_SUIT[m]} ${GAME_MODES[m].name}` }))} value={mode} onChange={(m) => m !== mode && net.setMode(m)} />
          ) : (
            <div className="tag">
              {MODE_SUIT[mode]} {GAME_MODES[mode].name} · {GAME_MODES[mode].en}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {room.members.map((m, i) => (
            <div className="member" key={m.id}>
              <Avatar animal={m.profile.animal} src={m.profile.avatar} />
              <div className="info">
                <div className="name">
                  {m.profile.name} {m.id === me && <span className="gold small">（你）</span>}
                </div>
                <div className="sub">
                  {!m.isAI && !m.connected && <span className="conn-lost">🟡 连接中断 · </span>}
                  {m.isHost ? '房主' : m.isAI ? `${PERSONALITIES[m.aiPersonality!]?.name ?? 'AI'} · ${DIFFICULTY_NAME[m.aiDifficulty ?? 'normal']}` : `玩家 ${i}`} · 🪙{' '}
                  {formatChips(m.chips)}
                </div>
              </div>
              <span className={`dot ${m.connected ? '' : 'warn'}`} title={m.connected ? '在线' : '连接中断，等待重新连接'} />
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
          {isHost && !canStart && (
            <div className="small muted center">
              {room.members.length < minPlayers ? `至少需要 ${minPlayers} 名玩家，可以添加 AI` : `等待 ${notReady.map((m) => m.profile.name).join('、')} 准备`}
            </div>
          )}
          {!isHost && <div className="small muted center">{mine?.ready ? '已准备，等待房主开始游戏' : '点击右上角「准备」，所有玩家准备后由房主开始游戏'}</div>}
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
                onClick={() => session.leave('online')}
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

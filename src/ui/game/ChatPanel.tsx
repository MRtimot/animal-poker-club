import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../store/gameStore';
import { EMOTES, QUICK_CHATS } from '../../core/protocol';
import { session } from '../../net/session';
import { sound } from '../../audio/sound';
import { isPC } from '../../utils/pc';

const NAME_COLORS = ['#ffb36b', '#5fe1ff', '#ff8cc4', '#9ff0b8', '#d6a8ff', '#ffe08a', '#8ab8ff', '#ff9a9a'];
function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

function isNarrow() {
  return typeof window !== 'undefined' && window.innerWidth <= 900;
}

/** 聊天窗口：文字、快捷消息、表情 */
export function ChatPanel({ side = 'right' }: { side?: 'left' | 'right' }) {
  const chat = useGame((s) => s.chat);
  const me = useGame((s) => s.playerId);
  // 默认展开：电脑版在 1600 宽以上才展开（更窄时会挡住右侧座位）；其他设备保持原来的规则
  const [open, setOpen] = useState(typeof window !== 'undefined' && window.innerWidth > (side === 'left' ? 1400 : isPC() ? 1599 : 1280));
  const [text, setText] = useState('');
  const [seen, setSeen] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setSeen(chat.length);
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat, open]);

  const unread = Math.max(0, chat.length - seen);
  const send = () => {
    if (!text.trim()) return;
    session.chat(text);
    setText('');
  };
  // 靠左时避开横屏手机一侧的挖孔 / 圆角（安全区为 0 时与原来的 14px / 70px 相同，电脑版不变）
  const sideStyle = side === 'left' ? { left: 'calc(14px + var(--safe-left))', right: 'auto' } : undefined;

  if (!open) {
    return (
      <div className="chat-fab" style={side === 'left' && !isNarrow() ? { left: 'calc(14px + var(--safe-left))', right: 'auto', top: 'calc(70px + var(--safe-top))', bottom: 'auto' } : undefined}>
        <button
          className="icon-btn"
          style={{ position: 'relative', width: 52, height: 52, fontSize: 24 }}
          onClick={() => {
            sound.play('button');
            setOpen(true);
          }}
          title="聊天"
        >
          💬
          {unread > 0 && <span className="unread">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </div>
    );
  }

  return (
    <div className="chat-panel panel" style={isNarrow() ? undefined : (sideStyle as any)}>
      <div className="chat-head">
        <span>💬 聊天</span>
        <button className="icon-btn" style={{ width: 30, height: 30, fontSize: 14 }} onClick={() => setOpen(false)} title="收起">
          ✕
        </button>
      </div>
      <div className="chat-list" ref={listRef}>
        {chat.length === 0 && <div className="chat-msg system">还没有消息，打个招呼吧 👋</div>}
        {chat.map((m) =>
          m.kind === 'system' ? (
            <div key={m.id} className="chat-msg system">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className={`chat-msg ${m.kind}`}>
              <span className="who" style={{ color: m.from === me ? '#5fe1ff' : colorFor(m.from) }}>
                {m.name}
                {m.from === me ? '（你）' : ''}:
              </span>
              <span className="txt">{m.text}</span>
            </div>
          ),
        )}
      </div>
      <div className="quick-chats">
        {QUICK_CHATS.map((q) => (
          <button key={q} onClick={() => session.chat(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="emotes">
        {EMOTES.map((e) => (
          <button key={e} onClick={() => session.emote(e)} title="发送表情">
            {e}
          </button>
        ))}
      </div>
      <div className="chat-input">
        <input
          className="input"
          value={text}
          maxLength={100}
          placeholder="说点什么…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') send();
          }}
        />
        <button className="btn btn-sm" onClick={send}>
          发送
        </button>
      </div>
    </div>
  );
}

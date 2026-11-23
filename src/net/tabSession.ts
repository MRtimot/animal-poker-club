// 每个浏览器标签页是一名独立玩家：在线会话编号保存在 sessionStorage。
// 但浏览器的“复制标签页”（以及 window.open 打开的同站页面）会把 sessionStorage 一起复制，
// 两个标签页就会拿着同一个会话编号连接服务器：互相把对方挤下线、不停重连。
// 这里在连接前用 BroadcastChannel 问一句“还有别的标签页在用这个会话吗？”——
// 有（说明这是复制出来的标签页）就换成新会话；没有（刷新页面时旧页面已经关闭）就继续使用，刷新仍能回到座位。

const CHANNEL = 'apc-tab-session';

interface TabSessionOptions {
  /** 当前标签页的会话编号（每次读取，换会话后会变化） */
  getSessionId: () => string | undefined;
  /** 发现会话已被另一个标签页使用：清除本标签页的会话与房间记录 */
  resetSession: () => void;
  timeoutMs?: number;
}

type Msg = { type: 'probe'; sid: string; from: string } | { type: 'taken'; sid: string; to: string };

/**
 * 开始应答其他标签页的询问，并检查本标签页的会话是否已被占用。
 * 返回的 Promise 在检查完成后结算（最多等待 timeoutMs）；返回值表示是否换成了新会话。
 * 返回 close()：停止应答（测试用；页面关闭时浏览器会自动关闭频道）。
 */
export function startTabSession(o: TabSessionOptions): { ready: Promise<boolean>; close: () => void } {
  if (typeof BroadcastChannel === 'undefined') return { ready: Promise.resolve(false), close: () => undefined };
  const ch = new BroadcastChannel(CHANNEL);
  // Node（测试）中不要让频道阻止进程退出
  (ch as unknown as { unref?: () => void }).unref?.();
  const me = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let resolveReady: (reset: boolean) => void = () => undefined;
  let pendingSid: string | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;

  ch.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'probe' && m.from !== me && m.sid && m.sid === o.getSessionId() && m.sid !== pendingSid) {
      // 我正在使用这个会话：告诉询问者（复制出来的标签页）换一个
      ch.postMessage({ type: 'taken', sid: m.sid, to: m.from } satisfies Msg);
    } else if (m.type === 'taken' && m.to === me && pendingSid && m.sid === pendingSid) {
      pendingSid = undefined;
      if (timer) clearTimeout(timer);
      o.resetSession();
      resolveReady(true);
    }
  };

  const sid = o.getSessionId();
  const ready = new Promise<boolean>((resolve) => {
    resolveReady = resolve;
    if (!sid) return resolve(false);
    pendingSid = sid;
    timer = setTimeout(() => {
      pendingSid = undefined;
      resolve(false);
    }, o.timeoutMs ?? 200);
    ch.postMessage({ type: 'probe', sid, from: me } satisfies Msg);
  });
  return { ready, close: () => ch.close() };
}

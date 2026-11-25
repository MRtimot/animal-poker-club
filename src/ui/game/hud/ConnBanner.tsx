// 在线牌桌的连接横幅：短暂的换连接 / 网络抖动（不到 1.5 秒）不显示，避免频繁闪烁
import { useEffect, useState } from 'react';
import { useGame } from '../../../store/gameStore';

export function ConnBanner() {
  const mode = useGame((s) => s.mode);
  const conn = useGame((s) => s.conn);
  const restarting = useGame((s) => s.serverRestarting);
  const [lost, setLost] = useState(false);
  // 只看“连上 / 没连上”：重试时状态会在 连接中 ↔ 断开 之间来回切换，不能每次都重新计时（否则横幅一直不出现）
  const down = conn !== 'connected';
  useEffect(() => {
    if (!down) return setLost(false);
    const t = setTimeout(() => setLost(true), 1500);
    return () => clearTimeout(t);
  }, [down]);
  if (mode !== 'online' || !lost) return null;
  return (
    <div className="conn-banner" role="alert">
      {restarting ? '⚠️ 服务器正在重启，正在重新连接…' : '⚠️ 连接中断，正在重新连接…（你的座位会保留）'}
    </div>
  );
}

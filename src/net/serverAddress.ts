// 游戏服务器地址。
// 优先级：玩家在「设置」里填写的地址 > 构建时的 VITE_GAME_SERVER（例如网页放在 Vercel、服务器放在 Render）> 当前网站自身
import { useSettings } from '../store/settingsStore';

/** 构建时配置的游戏服务器，例如 https://animal-poker-club.onrender.com（不是密钥，可以公开） */
export const BUILT_IN_SERVER: string = (import.meta.env.VITE_GAME_SERVER ?? '').trim();

/** 网页和游戏服务器是否在不同的网址上 */
export function isSplitDeployment() {
  return !!(useSettings.getState().serverUrl.trim() || BUILT_IN_SERVER);
}

/** 服务器的 http(s) 地址；空字符串 = 与网页同一个网址 */
export function serverHttpBase(): string {
  const raw = useSettings.getState().serverUrl.trim() || BUILT_IN_SERVER;
  if (!raw) return '';
  let u = raw.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/(api\/)?ws\/?$/, '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(u)) u = (location.protocol === 'https:' ? 'https://' : 'http://') + u;
  return u;
}

/** WebSocket 地址 */
export function serverWsUrl(): string {
  const base = serverHttpBase();
  // /api/ws：Vercel 上是实时连接函数的路径；本地服务器 / Render 也提供同一路径
  if (base) return base.replace(/^http/, 'ws') + '/api/ws';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api/ws`;
}

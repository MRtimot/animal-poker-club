export function formatChips(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function shortChips(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return formatChips(n);
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

/**
 * 可用的 localStorage（隐私模式 / 禁用存储时返回 undefined）。
 * 只在第一次成功时做一次读写探测并记住结果：以前每次调用都写入再删除一个测试键，
 * 每次读写存档都多两次写入，还会在其他标签页触发两次 storage 事件。
 */
let probed: Storage | undefined;
export function safeStorage(): Storage | undefined {
  try {
    const ls = window.localStorage;
    if (probed === ls) return ls;
    const k = '__apc_test__';
    ls.setItem(k, '1');
    ls.removeItem(k);
    probed = ls;
    return ls;
  } catch {
    return undefined;
  }
}

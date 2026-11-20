// 随机数工具：洗牌使用 crypto.getRandomValues（浏览器与 Node 均可用）

export type RNG = () => number; // 返回 [0, 1)

export const secureRandom: RNG = () => {
  const c = (globalThis as any).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(2);
    c.getRandomValues(buf);
    // 53 位精度
    return (buf[0] * 2 ** 21 + (buf[1] >>> 11)) / 2 ** 53;
  }
  return Math.random();
};

/** 可复现的伪随机数（测试 & AI 模拟用） */
export function seededRandom(seed: number): RNG {
  let s = seed >>> 0 || 1;
  return () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: RNG, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

export function pick<T>(rng: RNG, arr: readonly T[]): T {
  return arr[randInt(rng, arr.length)];
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function randomId(len = 12, rng: RNG = secureRandom): string {
  let out = '';
  for (let i = 0; i < len; i++) out += ID_CHARS[randInt(rng, ID_CHARS.length)];
  return out;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 0/O/1/I
export function randomRoomCode(rng: RNG = secureRandom): string {
  let out = '';
  for (let i = 0; i < 5; i++) out += CODE_CHARS[randInt(rng, CODE_CHARS.length)];
  return out;
}

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { AnimalConfig, DEFAULT_ANIMAL, NAME_IDEAS, PlayerProfile, sanitizeAnimal, sanitizeName } from '../core/player/profile';
import { randomId } from '../core/utils/random';
import { ACHIEVEMENTS, EMPTY_STATS, RecentGame, Stats, levelFromXp, normalizeStats } from '../progress/progression';
import { STARTING_CHIPS, type AccountState } from '../core/account/types';
import { REFILL_CHIPS } from '../core/blackjack/rules';
import { safeStorage } from '../utils/format';

/**
 * 游客存档只保存在本机。登录后这里显示的是服务器上的账号数据，
 * 此时暂停写入本地，避免账号数据覆盖游客存档（也避免把账号数据当成“游客进度”再次迁移）。
 */
let accountMode = false;
export const GUEST_KEY = 'apc-profile';
const guestStorage = createJSONStorage(() => ({
  getItem: (k: string) => safeStorage()?.getItem(k) ?? null,
  setItem: (k: string, v: string) => {
    // 存储空间已满等写入失败：进度留在内存里继续玩，不能让按钮点击 / 结算中途报错
    try {
      if (!accountMode) safeStorage()?.setItem(k, v);
    } catch {
      /* 写入失败 */
    }
  },
  removeItem: (k: string) => safeStorage()?.removeItem(k),
}));

export interface SavedCharacter {
  id: string;
  name: string;
  animal: AnimalConfig;
  createdAt: number;
}

export interface ProfileState {
  name: string;
  animal: AnimalConfig;
  characters: SavedCharacter[];
  xp: number;
  stats: Stats;
  achievements: Record<string, number>;
  recent: RecentGame[];
  createdCharacter: boolean;
  /** 虚拟金币（与账号的虚拟筹码是同一种货币；登录后显示服务器上的数额） */
  chips: number;

  setName: (n: string) => void;
  setAnimal: (a: AnimalConfig) => void;
  saveCharacter: () => SavedCharacter;
  useCharacter: (id: string) => void;
  deleteCharacter: (id: string) => void;
  /** 增加经验并更新统计；返回新解锁的成就与升级信息 */
  applyProgress: (xpGain: number, patch: (s: Stats) => Stats) => { newAchievements: string[]; levelUp: number | null };
  /**
   * 游客在本机结算一局 21 点：经验、统计、成就与金币；同一局（roundId）只结算一次，重复调用返回 null。
   * chipsDelta = 0：在线房间的桌上筹码，不影响持久金币
   */
  settleBlackjack: (roundId: string, xpGain: number, stats: Stats, chipsDelta: number) => { newAchievements: string[]; levelUp: number | null } | null;
  /** 金币不够最低下注时补给到固定数额（虚拟金币，没有任何购买）；还够时不变。返回现在的数额 */
  refillChips: (below: number) => number;
  addRecent: (g: RecentGame) => void;
  resetAll: () => void;
}

/** 已经结算过的 21 点局号（同一局的结果再次到达时不会重复发放） */
const settledRounds = new Set<string>();

const initialName = NAME_IDEAS[Math.floor(Math.random() * 6)];

export const useProfile = create<ProfileState>()(
  persist(
    (set, get) => ({
      name: initialName,
      animal: DEFAULT_ANIMAL,
      characters: [],
      xp: 0,
      stats: EMPTY_STATS,
      achievements: {},
      recent: [],
      createdCharacter: false,
      chips: STARTING_CHIPS,

      setName: (n) => set({ name: n.slice(0, 12) }),
      setAnimal: (a) => set({ animal: a }),
      saveCharacter: () => {
        const { name, animal, characters } = get();
        // 用整理后的名字比较：保存的名字是整理过的（去掉首尾空格等），用原始输入比较会把同名角色存成两份
        const clean = sanitizeName(name);
        const existing = characters.find((c) => c.name === clean);
        const ch: SavedCharacter = { id: existing?.id ?? randomId(8), name: clean, animal: sanitizeAnimal(animal), createdAt: Date.now() };
        const list = existing ? characters.map((c) => (c.id === ch.id ? ch : c)) : [ch, ...characters].slice(0, 12);
        set({ characters: list, createdCharacter: true });
        return ch;
      },
      useCharacter: (id) => {
        const c = get().characters.find((x) => x.id === id);
        if (c) set({ name: c.name, animal: sanitizeAnimal(c.animal) });
      },
      deleteCharacter: (id) => set({ characters: get().characters.filter((c) => c.id !== id) }),
      applyProgress: (xpGain, patch) => {
        const before = get();
        const prevLevel = levelFromXp(before.xp);
        const stats = patch({ ...before.stats, speciesWins: { ...before.stats.speciesWins } });
        const xp = before.xp + Math.max(0, Math.round(xpGain));
        const newLevel = levelFromXp(xp);
        const achievements = { ...before.achievements };
        const newAchievements: string[] = [];
        for (const a of ACHIEVEMENTS) {
          if (!achievements[a.id] && a.check(stats)) {
            achievements[a.id] = Date.now();
            newAchievements.push(a.id);
          }
        }
        set({ stats, xp, achievements });
        return { newAchievements, levelUp: newLevel > prevLevel ? newLevel : null };
      },
      settleBlackjack: (roundId, xpGain, stats, chipsDelta) => {
        if (settledRounds.has(roundId)) return null;
        settledRounds.add(roundId);
        if (settledRounds.size > 200) settledRounds.delete(settledRounds.values().next().value!);
        const res = get().applyProgress(xpGain, () => stats);
        if (chipsDelta) set({ chips: Math.max(0, get().chips + Math.trunc(chipsDelta)) });
        return res;
      },
      refillChips: (below) => {
        if (!accountMode && get().chips < below) set({ chips: REFILL_CHIPS });
        return get().chips;
      },
      addRecent: (g) => set({ recent: [g, ...get().recent].slice(0, 12) }),
      resetAll: () =>
        set({ xp: 0, stats: EMPTY_STATS, achievements: {}, recent: [], characters: [], animal: DEFAULT_ANIMAL, name: initialName, createdCharacter: false, chips: STARTING_CHIPS }),
    }),
    {
      name: GUEST_KEY,
      storage: guestStorage,
      version: 2,
      // v1 → v2：补齐新增的统计字段，旧存档不丢失
      migrate: (old: any) => ({ ...old, stats: normalizeStats(old?.stats) }),
      // 读取本机存档时逐项校验：存档损坏或被手动修改（例如不存在的动物）不能让游戏崩溃
      merge: (persisted, current) => ({ ...current, ...cleanGuestSave(persisted, current) }),
    },
  ),
);

/**
 * 多个标签页共用同一份游客存档：另一个标签页写入后，这里重新读取。
 * 否则每个标签页都拿着自己内存里的旧存档，下一次保存会把另一个标签页刚获得的经验 / 成就覆盖掉。
 * （storage 事件只在“其他标签页”修改时触发；重新读取后写回的内容相同，不会来回触发）
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === GUEST_KEY && !accountMode) void useProfile.persist.rehydrate();
  });
}

/** 校验本机游客存档的每个字段；非法值回落到默认值，缺失字段自动补齐 */
export function cleanGuestSave(raw: unknown, cur: ProfileState): Partial<ProfileState> {
  const p: any = raw && typeof raw === 'object' ? raw : {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const achievements: Record<string, number> = {};
  if (p.achievements && typeof p.achievements === 'object')
    for (const [k, v] of Object.entries(p.achievements)) if (ACHIEVEMENTS.some((a) => a.id === k) && typeof v === 'number' && v > 0) achievements[k] = v;
  return {
    name: typeof p.name === 'string' && p.name.trim() ? sanitizeName(p.name) : cur.name,
    animal: sanitizeAnimal(p.animal ?? cur.animal),
    characters: Array.isArray(p.characters)
      ? p.characters
          .filter((c: any) => c && typeof c === 'object' && typeof c.id === 'string')
          .slice(0, 12)
          .map((c: any) => ({ id: c.id.slice(0, 24), name: sanitizeName(c.name), animal: sanitizeAnimal(c.animal), createdAt: num(c.createdAt) || Date.now() }))
      : [],
    xp: num(p.xp),
    stats: normalizeStats(p.stats),
    achievements,
    recent: Array.isArray(p.recent)
      ? p.recent
          .filter((r: any) => r && typeof r === 'object')
          .slice(0, 12)
          .map((r: any) => ({
            time: num(r.time),
            mode: r.mode === 'online' ? 'online' : 'local',
            place: Math.max(1, num(r.place)),
            players: Math.max(2, num(r.players)),
            hands: num(r.hands),
            chips: num(r.chips),
          }))
      : [],
    createdCharacter: !!p.createdCharacter,
    // 旧存档没有金币：按新玩家的起始数额
    chips: typeof p.chips === 'number' && Number.isFinite(p.chips) && p.chips >= 0 ? Math.min(1_000_000_000, Math.floor(p.chips)) : STARTING_CHIPS,
  };
}

/** 显示服务器上的账号数据（等级、经验、成就、统计全部以服务器为准） */
export function showAccount(a: AccountState) {
  accountMode = true;
  useProfile.setState({
    name: a.nickname,
    animal: sanitizeAnimal(a.animal),
    characters: (a.characters ?? []).map((c) => ({ ...c, animal: sanitizeAnimal(c.animal) })),
    xp: a.xp,
    stats: normalizeStats(a.stats),
    achievements: a.achievements,
    recent: a.recent,
    createdCharacter: a.onboarded,
    chips: a.chips,
  });
}

/** 退出登录：恢复本机的游客存档 */
export async function showGuest() {
  accountMode = false;
  useProfile.setState({ name: initialName, animal: DEFAULT_ANIMAL, characters: [], xp: 0, stats: EMPTY_STATS, achievements: {}, recent: [], createdCharacter: false, chips: STARTING_CHIPS });
  await useProfile.persist.rehydrate();
}

export function isAccountMode() {
  return accountMode;
}

/** 读取游客存档（用于登录时迁移） */
export function readGuestSave(): any | null {
  try {
    const raw = safeStorage()?.getItem(GUEST_KEY);
    return raw ? JSON.parse(raw)?.state ?? null : null;
  } catch {
    return null;
  }
}

export function clearGuestSave() {
  safeStorage()?.removeItem(GUEST_KEY);
}

export function currentProfile(): PlayerProfile {
  const s = useProfile.getState();
  return { name: sanitizeName(s.name), animal: s.animal, level: levelFromXp(s.xp) };
}

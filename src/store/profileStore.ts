import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { AnimalConfig, DEFAULT_ANIMAL, NAME_IDEAS, PlayerProfile, sanitizeAnimal, sanitizeName } from '../core/player/profile';
import { randomId } from '../core/utils/random';
import { ACHIEVEMENTS, EMPTY_STATS, RecentGame, Stats, levelFromXp, normalizeStats } from '../progress/progression';
import type { AccountState } from '../core/account/types';
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
    if (!accountMode) safeStorage()?.setItem(k, v);
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

  setName: (n: string) => void;
  setAnimal: (a: AnimalConfig) => void;
  saveCharacter: () => SavedCharacter;
  useCharacter: (id: string) => void;
  deleteCharacter: (id: string) => void;
  /** 增加经验并更新统计；返回新解锁的成就与升级信息 */
  applyProgress: (xpGain: number, patch: (s: Stats) => Stats) => { newAchievements: string[]; levelUp: number | null };
  addRecent: (g: RecentGame) => void;
  resetAll: () => void;
}

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

      setName: (n) => set({ name: n.slice(0, 12) }),
      setAnimal: (a) => set({ animal: a }),
      saveCharacter: () => {
        const { name, animal, characters } = get();
        const existing = characters.find((c) => c.name === name);
        const ch: SavedCharacter = { id: existing?.id ?? randomId(8), name: sanitizeName(name), animal, createdAt: Date.now() };
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
      addRecent: (g) => set({ recent: [g, ...get().recent].slice(0, 12) }),
      resetAll: () =>
        set({ xp: 0, stats: EMPTY_STATS, achievements: {}, recent: [], characters: [], animal: DEFAULT_ANIMAL, name: initialName, createdCharacter: false }),
    }),
    {
      name: GUEST_KEY,
      storage: guestStorage,
      version: 2,
      // v1 → v2：补齐新增的统计字段，旧存档不丢失
      migrate: (old: any) => ({ ...old, stats: normalizeStats(old?.stats) }),
    },
  ),
);

/** 显示服务器上的账号数据（等级、经验、成就、统计全部以服务器为准） */
export function showAccount(a: AccountState) {
  accountMode = true;
  useProfile.setState({
    name: a.nickname,
    animal: sanitizeAnimal(a.animal),
    characters: a.characters,
    xp: a.xp,
    stats: normalizeStats(a.stats),
    achievements: a.achievements,
    recent: a.recent,
    createdCharacter: a.onboarded,
  });
}

/** 退出登录：恢复本机的游客存档 */
export async function showGuest() {
  accountMode = false;
  useProfile.setState({ name: initialName, animal: DEFAULT_ANIMAL, characters: [], xp: 0, stats: EMPTY_STATS, achievements: {}, recent: [], createdCharacter: false });
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

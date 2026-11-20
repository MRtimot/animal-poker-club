import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITY_NAME: Record<Quality, string> = { low: '低', medium: '中', high: '高', ultra: '极高' };

/** 扑克房间环境 */
export type RoomTheme = 'casino' | 'penthouse' | 'cabin';
export const ROOM_NAME: Record<RoomTheme, string> = { casino: '豪华赌场', penthouse: '夜景高层', cabin: '森林小屋' };

export interface SettingsState {
  quality: Quality;
  /** 自动画质：根据帧率自动降低画质 */
  autoQuality: boolean;
  room: RoomTheme;
  musicVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  autoCamera: boolean;
  showFps: boolean;
  serverUrl: string;
  tutorialDone: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

function defaultQuality(): Quality {
  if (typeof window === 'undefined') return 'high';
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
  if (mobile) return (navigator.hardwareConcurrency ?? 4) >= 6 ? 'medium' : 'low';
  // 桌面端：根据 CPU 核心数与内存粗略估计设备性能
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as any).deviceMemory ?? 8;
  if (cores >= 10 && mem >= 8) return 'ultra';
  return cores >= 6 ? 'high' : 'medium';
}

const memoryStorage = (() => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
})();

export const persistStorage = createJSONStorage(() => {
  try {
    const ls = window.localStorage;
    ls.getItem('x');
    return ls;
  } catch {
    return memoryStorage;
  }
});

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      quality: defaultQuality(),
      autoQuality: true,
      room: 'casino',
      musicVolume: 0.35,
      sfxVolume: 0.8,
      ambientVolume: 0.4,
      autoCamera: true,
      showFps: false,
      serverUrl: '',
      tutorialDone: false,
      set: (patch) => set(patch),
    }),
    {
      name: 'apc-settings',
      storage: persistStorage,
      version: 2,
      migrate: (old: any) => ({ ...old, autoQuality: true, room: 'casino' }),
    },
  ),
);

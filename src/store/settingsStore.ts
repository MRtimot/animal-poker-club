import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITY_NAME: Record<Quality, string> = { low: '低', medium: '中', high: '高', ultra: '极高' };

export interface SettingsState {
  quality: Quality;
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
  return mobile ? 'medium' : 'high';
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
      musicVolume: 0.35,
      sfxVolume: 0.8,
      ambientVolume: 0.4,
      autoCamera: true,
      showFps: false,
      serverUrl: '',
      tutorialDone: false,
      set: (patch) => set(patch),
    }),
    { name: 'apc-settings', storage: persistStorage, version: 1 },
  ),
);

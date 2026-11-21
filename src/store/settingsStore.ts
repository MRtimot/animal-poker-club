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
  /** 🎙️ 角色语音 */
  voiceEnabled: boolean;
  voiceVolume: number;
  /** 语速倍率 0.6 ~ 1.6 */
  voiceRate: number;
  /** 自然语调：分段停顿、音高 / 语速自然变化（关闭则整句平直地读） */
  voiceNatural: boolean;
  /** 角色（AI 动物）说话：关闭后不显示也不播放台词 */
  aiTalk: boolean;
  /** 挑衅 / 垃圾话台词 */
  trashTalk: boolean;
  /** 台词字幕（气泡） */
  subtitles: boolean;
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
      voiceEnabled: true,
      voiceVolume: 0.9,
      voiceRate: 1,
      voiceNatural: true,
      aiTalk: true,
      trashTalk: true,
      subtitles: true,
      set: (patch) => set(patch),
    }),
    {
      name: 'apc-settings',
      storage: persistStorage,
      version: 2,
      migrate: (old: any) => ({ ...old, autoQuality: true, room: 'casino' }),
      // 逐项校验：损坏或手动修改的设置不能让 3D 画面或界面崩溃
      merge: (persisted: any, current) => {
        const p = persisted && typeof persisted === 'object' ? persisted : {};
        const vol = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
        const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
        return {
          ...current,
          quality: (['low', 'medium', 'high', 'ultra'] as const).includes(p.quality) ? p.quality : current.quality,
          autoQuality: bool(p.autoQuality, current.autoQuality),
          room: (['casino', 'penthouse', 'cabin'] as const).includes(p.room) ? p.room : current.room,
          musicVolume: vol(p.musicVolume, current.musicVolume),
          sfxVolume: vol(p.sfxVolume, current.sfxVolume),
          ambientVolume: vol(p.ambientVolume, current.ambientVolume),
          autoCamera: bool(p.autoCamera, current.autoCamera),
          showFps: bool(p.showFps, current.showFps),
          serverUrl: typeof p.serverUrl === 'string' ? p.serverUrl.slice(0, 200) : current.serverUrl,
          tutorialDone: bool(p.tutorialDone, current.tutorialDone),
          voiceEnabled: bool(p.voiceEnabled, current.voiceEnabled),
          voiceVolume: vol(p.voiceVolume, current.voiceVolume),
          voiceRate: typeof p.voiceRate === 'number' && p.voiceRate >= 0.6 && p.voiceRate <= 1.6 ? p.voiceRate : current.voiceRate,
          voiceNatural: bool(p.voiceNatural, current.voiceNatural),
          aiTalk: bool(p.aiTalk, current.aiTalk),
          trashTalk: bool(p.trashTalk, current.trashTalk),
          subtitles: bool(p.subtitles, current.subtitles),
        };
      },
    },
  ),
);

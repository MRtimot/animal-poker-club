import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { onConsentChange, preferencesAllowed } from '../privacy/consent';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITY_NAME: Record<Quality, string> = { low: '低', medium: '中', high: '高', ultra: '极高' };

/** 扑克房间环境 */
export type RoomTheme = 'casino' | 'penthouse' | 'cabin';
export const ROOM_NAME: Record<RoomTheme, string> = { casino: '豪华赌场', penthouse: '夜景高层', cabin: '森林小屋' };

/** 手机 / 平板全屏：自动（第一次点“开始 / 创建 / 加入”时进入，自己退出后本次不再自动进入）/ 开（每次进入游戏时进入）/ 关 */
export type FullscreenPreference = 'auto' | 'on' | 'off';
export const FULLSCREEN_PREF_NAME: Record<FullscreenPreference, string> = { auto: '自动', on: '开', off: '关' };

export interface SettingsState {
  quality: Quality;
  /** 自动画质：根据帧率自动降低画质 */
  autoQuality: boolean;
  room: RoomTheme;
  musicVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  /** 🔇 全部静音（音乐 / 音效 / 环境声 / 演出 / 角色语音）；各项音量保持不变，取消后立刻恢复 */
  muted: boolean;
  /** iPhone / iPad：静音模式打开时也播放游戏声音（只保存在这台设备） */
  silentModeSound: boolean;
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
  /** 手机 / 平板全屏偏好（只保存在这台设备，不同步到其他设备：每台设备的浏览器能力不同） */
  fullscreenPreference: FullscreenPreference;
  /** 手机触感反馈（震动），只在支持的浏览器上生效 */
  haptics: boolean;
  /** 已经完整看过一次失败演出：之后允许跳过（只跳过画面，牌局结果不变） */
  defeatSeen: boolean;
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
  let base: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  try {
    const ls = window.localStorage;
    ls.getItem('x');
    base = ls;
  } catch {
    base = memoryStorage;
  }
  return {
    getItem: (k: string) => base.getItem(k),
    // 玩家在“Cookie 与本机存储”里关闭了偏好设置：不写入本机（设置只在本次打开期间有效）
    setItem: (k: string, v: string) => {
      try {
        if (preferencesAllowed()) base.setItem(k, v);
      } catch {
        /* 存储空间已满等：设置只在本次打开期间有效 */
      }
    },
    removeItem: (k: string) => base.removeItem(k),
  };
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
      muted: false,
      silentModeSound: true,
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
      fullscreenPreference: 'auto',
      haptics: true,
      defeatSeen: false,
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
          muted: bool(p.muted, current.muted),
          silentModeSound: bool(p.silentModeSound, current.silentModeSound),
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
          fullscreenPreference: (['auto', 'on', 'off'] as const).includes(p.fullscreenPreference) ? p.fullscreenPreference : current.fullscreenPreference,
          haptics: bool(p.haptics, current.haptics),
          defeatSeen: bool(p.defeatSeen, current.defeatSeen),
        };
      },
    },
  ),
);

// 重新允许保存偏好设置时：把当前设置写回本机（关闭时已保存的设置由同意模块删除）
onConsentChange((c) => {
  if (c.preferences) useSettings.setState({});
});

// 多个标签页共用设置：另一个标签页修改后重新读取，避免旧设置把新设置覆盖回去
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'apc-settings') void useSettings.persist.rehydrate();
  });
}

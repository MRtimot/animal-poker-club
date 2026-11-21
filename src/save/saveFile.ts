// 本地存档的导出 / 导入（animal-poker-save.json）
// 游客进度只保存在浏览器里；导出文件让玩家可以备份，或者手动搬到另一台设备
import { ACHIEVEMENTS, normalizeStats, type RecentGame } from '../progress/progression';
import { sanitizeAnimal, sanitizeName } from '../core/player/profile';
import { useProfile, type SavedCharacter } from '../store/profileStore';
import { useSettings, type SettingsState } from '../store/settingsStore';

export const SAVE_FORMAT = 'animal-poker-save';
export const SAVE_VERSION = 1;
export const SAVE_FILENAME = 'animal-poker-save.json';
const MAX_FILE_BYTES = 512 * 1024;
const MAX_XP = 1_000_000_000;

/** 会写入存档文件的设置（不包含服务器地址等与设备相关的设置） */
const SETTING_KEYS = ['quality', 'autoQuality', 'room', 'musicVolume', 'sfxVolume', 'ambientVolume', 'autoCamera', 'showFps', 'tutorialDone'] as const;
type SavedSettings = Partial<Pick<SettingsState, (typeof SETTING_KEYS)[number]>>;

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: number;
  exportedAt: number;
  profile: {
    name: string;
    animal: ReturnType<typeof sanitizeAnimal>;
    characters: SavedCharacter[];
    xp: number;
    stats: ReturnType<typeof normalizeStats>;
    achievements: Record<string, number>;
    recent: RecentGame[];
    createdCharacter: boolean;
  };
  settings: SavedSettings;
}

export function buildSave(): SaveFile {
  const p = useProfile.getState();
  const s = useSettings.getState() as any;
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    exportedAt: Date.now(),
    profile: {
      name: p.name,
      animal: p.animal,
      characters: p.characters,
      xp: p.xp,
      stats: p.stats,
      achievements: p.achievements,
      recent: p.recent,
      createdCharacter: p.createdCharacter,
    },
    settings: Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k]])) as SavedSettings,
  };
}

/** 下载存档文件 */
export function exportSave() {
  const blob = new Blob([JSON.stringify(buildSave(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = SAVE_FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class SaveError extends Error {}

const num = (v: unknown, min: number, max: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);

function cleanSettings(x: any): SavedSettings {
  const out: any = {};
  if (!x || typeof x !== 'object') return out;
  if (['low', 'medium', 'high', 'ultra'].includes(x.quality)) out.quality = x.quality;
  if (['casino', 'penthouse', 'cabin'].includes(x.room)) out.room = x.room;
  for (const k of ['autoQuality', 'autoCamera', 'showFps', 'tutorialDone']) if (typeof x[k] === 'boolean') out[k] = x[k];
  for (const k of ['musicVolume', 'sfxVolume', 'ambientVolume']) if (typeof x[k] === 'number') out[k] = num(x[k], 0, 1, 0.5);
  return out;
}

/** 解析并校验存档文件；格式错误时抛出中文提示 */
export function parseSave(text: string): SaveFile {
  if (text.length > MAX_FILE_BYTES) throw new SaveError('存档文件过大');
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError('这不是有效的存档文件');
  }
  if (!raw || raw.format !== SAVE_FORMAT || !raw.profile) throw new SaveError('这不是《动物扑克俱乐部》的存档文件');
  if (typeof raw.version !== 'number' || raw.version > SAVE_VERSION) throw new SaveError('存档来自更新版本的游戏，请先更新游戏');
  const p = raw.profile;
  const known = new Set(ACHIEVEMENTS.map((a) => a.id));
  const achievements: Record<string, number> = {};
  if (p.achievements && typeof p.achievements === 'object')
    for (const [k, v] of Object.entries(p.achievements)) if (known.has(k) && typeof v === 'number' && v > 0) achievements[k] = v;
  const characters: SavedCharacter[] = Array.isArray(p.characters)
    ? p.characters
        .filter((c: any) => c && typeof c === 'object' && typeof c.id === 'string')
        .slice(0, 12)
        .map((c: any) => ({ id: String(c.id).slice(0, 24), name: sanitizeName(c.name), animal: sanitizeAnimal(c.animal), createdAt: num(c.createdAt, 0, Date.now(), Date.now()) }))
    : [];
  const recent: RecentGame[] = Array.isArray(p.recent)
    ? p.recent
        .filter((r: any) => r && typeof r === 'object')
        .slice(0, 12)
        .map((r: any) => ({
          time: num(r.time, 0, Date.now(), Date.now()),
          mode: r.mode === 'online' ? 'online' : 'local',
          place: Math.floor(num(r.place, 1, 8, 1)),
          players: Math.floor(num(r.players, 2, 8, 2)),
          hands: Math.floor(num(r.hands, 0, 100000, 0)),
          chips: Math.floor(num(r.chips, 0, 1e9, 0)),
        }))
    : [];
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    exportedAt: num(raw.exportedAt, 0, Date.now() + 86400_000, Date.now()),
    profile: {
      name: sanitizeName(p.name),
      animal: sanitizeAnimal(p.animal),
      characters,
      xp: Math.floor(num(p.xp, 0, MAX_XP, 0)),
      stats: normalizeStats(p.stats),
      achievements,
      recent,
      createdCharacter: !!p.createdCharacter,
    },
    settings: cleanSettings(raw.settings),
  };
}

/** 用存档替换当前本机进度 */
export function applySave(save: SaveFile) {
  useProfile.setState({ ...save.profile });
  if (Object.keys(save.settings).length) useSettings.getState().set(save.settings);
}

export function readFileText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) return Promise.reject(new SaveError('存档文件过大'));
  return file.text();
}

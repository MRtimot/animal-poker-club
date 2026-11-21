// 玩家账号：客户端与服务器共享的数据结构与校验规则
// 注意：这里只有“玩家看得到的”字段 —— 不含 Google ID、Token、邮箱或数据库内部 ID
import type { AnimalConfig, Species } from '../player/profile';
import type { RecentGame, Stats } from '../../progress/progression';

/** 玩家数据结构版本：以后修改存档结构时递增，并在服务器端写迁移 */
export const DATA_VERSION = 2;

export const STARTING_CHIPS = 1000;

export interface AccountCharacter {
  id: string;
  name: string;
  animal: AnimalConfig;
  createdAt: number;
}

/** 同步到所有设备的玩家设置（画质、音量、镜头等偏好） */
export interface AccountSettings {
  language: 'zh-CN';
  quality: 'low' | 'medium' | 'high' | 'ultra';
  autoQuality: boolean;
  room: 'casino' | 'penthouse' | 'cabin';
  musicVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  autoCamera: boolean;
  showFps: boolean;
  tutorialDone: boolean;
  reducedMotion: boolean;
}

/** 服务器发给客户端的完整玩家状态（服务器是唯一可信来源） */
export interface AccountState {
  nickname: string;
  avatarUrl: string | null;
  onboarded: boolean;
  createdAt: number;
  animal: AnimalConfig;
  characters: AccountCharacter[];
  level: number;
  xp: number;
  chips: number;
  stats: Stats;
  achievements: Record<string, number>;
  unlockedAnimals: Species[];
  settings: Partial<AccountSettings>;
  recent: RecentGame[];
  /** 资料版本号：每次修改递增，用于多设备冲突检测 */
  version: number;
  dataVersion: number;
  /** 本次登录是否新建账号 */
  isNew?: boolean;
}

/** 服务器在结算后推送给该玩家所有设备的事件 */
export interface ProgressEvent {
  xpGained: number;
  chipsGained: number;
  levelBefore: number;
  levelAfter: number;
  newAchievements: string[];
  newAnimals: Species[];
}

// ───────────── 昵称规则（服务器强制执行；客户端只用来提前提示） ─────────────

/** 完全相同即禁止 */
const RESERVED_EXACT = ['gm', 'mod', 'root', 'staff', 'support', 'ai', 'bot'];
/** 包含即禁止（防止冒充管理员 / 官方） */
const RESERVED_CONTAINS = ['系统', '管理员', '官方', '客服', '版主', '运营', 'admin', 'system', 'moderator', 'official', '动物扑克俱乐部'];
const BANNED = ['操你', '傻逼', '傻b', '煞笔', '妈的', '去死', '婊', '贱人', 'fuck', 'shit', 'bitch', 'nazi', '纳粹', '赌博网', '代充'];

/** 是否包含不当内容（昵称、口头禅共用） */
export function containsBannedWords(text: string): boolean {
  const lower = text.normalize('NFKC').toLowerCase().replace(/[\s_\-·.]/g, '');
  return BANNED.some((b) => lower.includes(b));
}

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;

/** 返回 null 表示合法，否则返回中文错误提示 */
export function nicknameError(raw: unknown): string | null {
  if (typeof raw !== 'string') return '请输入昵称';
  const n = raw.normalize('NFKC').trim();
  const len = [...n].length;
  if (len < NICKNAME_MIN) return `昵称至少 ${NICKNAME_MIN} 个字`;
  if (len > NICKNAME_MAX) return `昵称最多 ${NICKNAME_MAX} 个字`;
  // 只允许中文、字母、数字、空格、下划线、连字符和少量符号
  if (!/^[\p{Script=Han}A-Za-z0-9 _\-·.]+$/u.test(n)) return '昵称只能包含中文、字母、数字、空格、下划线和连字符';
  if (/\s{2,}/.test(n)) return '昵称不能包含连续空格';
  const lower = n.toLowerCase().replace(/[\s_\-·.]/g, '');
  if (RESERVED_EXACT.includes(lower) || RESERVED_CONTAINS.some((r) => lower.includes(r))) return '这个昵称是系统保留名称';
  if (BANNED.some((b) => lower.includes(b))) return '昵称包含不当内容';
  return null;
}

export function cleanNickname(raw: string): string {
  return raw.normalize('NFKC').trim();
}

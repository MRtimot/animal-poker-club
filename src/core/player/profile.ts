// 动物角色配置 —— 客户端与服务器共享的数据结构（不含任何 3D 代码）

export type Species =
  | 'cat' | 'dog' | 'fox' | 'panda' | 'rabbit' | 'bear' | 'raccoon' | 'frog'
  | 'lion' | 'tiger' | 'koala' | 'monkey' | 'penguin' | 'wolf' | 'dragon';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface SpeciesInfo {
  id: Species;
  name: string;
  emoji: string;
  rarity: Rarity;
  /** 默认毛色 */
  color: string;
  /** 解锁条件说明 */
  unlock: { level?: number; achievement?: string };
  desc: string;
}

export const SPECIES: SpeciesInfo[] = [
  { id: 'cat', name: '猫', emoji: '🐱', rarity: 'common', color: '#f0a050', unlock: {}, desc: '优雅又神秘，最会察言观色。' },
  { id: 'dog', name: '狗', emoji: '🐶', rarity: 'common', color: '#c8955c', unlock: {}, desc: '忠诚热情，拿到好牌尾巴就藏不住。' },
  { id: 'rabbit', name: '兔子', emoji: '🐰', rarity: 'common', color: '#f3eee8', unlock: {}, desc: '蹦蹦跳跳，下注全凭心情。' },
  { id: 'bear', name: '熊', emoji: '🐻', rarity: 'common', color: '#8a5a3b', unlock: {}, desc: '稳重的大块头，筹码堆得像山一样。' },
  { id: 'penguin', name: '企鹅', emoji: '🐧', rarity: 'common', color: '#2c3440', unlock: {}, desc: '穿着天生的燕尾服，冷静如冰。' },
  { id: 'monkey', name: '猴子', emoji: '🐵', rarity: 'common', color: '#9a6a44', unlock: {}, desc: '机灵调皮，最喜欢偷看底池。' },
  { id: 'fox', name: '狐狸', emoji: '🦊', rarity: 'rare', color: '#e8743b', unlock: { level: 2 }, desc: '狡猾的诈唬大师。' },
  { id: 'raccoon', name: '浣熊', emoji: '🦝', rarity: 'rare', color: '#8e8f96', unlock: { level: 3 }, desc: '戴着天生的面具，没人看得透。' },
  { id: 'koala', name: '考拉', emoji: '🐨', rarity: 'rare', color: '#a7a9b0', unlock: { level: 4 }, desc: '看起来在打瞌睡，其实全在算牌。' },
  { id: 'panda', name: '熊猫', emoji: '🐼', rarity: 'epic', color: '#f5f5f2', unlock: { level: 5 }, desc: '国宝级的耐心，只玩强牌。' },
  { id: 'tiger', name: '老虎', emoji: '🐯', rarity: 'epic', color: '#f08a24', unlock: { level: 6 }, desc: '霸气外露，一言不合就加注。' },
  { id: 'frog', name: '青蛙', emoji: '🐸', rarity: 'epic', color: '#6cc04a', unlock: { achievement: 'allin_win' }, desc: '跳来跳去，谁也猜不到下一步。' },
  { id: 'lion', name: '狮子', emoji: '🦁', rarity: 'legendary', color: '#e0a83e', unlock: { level: 8 }, desc: '牌桌之王，气场两米八。' },
  { id: 'wolf', name: '狼', emoji: '🐺', rarity: 'legendary', color: '#7d8796', unlock: { achievement: 'streak5' }, desc: '孤傲的猎手，嗅得到对手的恐惧。' },
  { id: 'dragon', name: '龙', emoji: '🐲', rarity: 'legendary', color: '#3fae8c', unlock: { level: 10 }, desc: '传说中的扑克之神。' },
];

export const SPECIES_MAP: Record<Species, SpeciesInfo> = Object.fromEntries(SPECIES.map((s) => [s.id, s])) as any;

export const RARITY_NAME: Record<Rarity, string> = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
export const RARITY_COLOR: Record<Rarity, string> = { common: '#9fb3c8', rare: '#4aa8ff', epic: '#b46cff', legendary: '#ffb020' };

export const FUR_COLORS: { id: string; name: string; hex: string }[] = [
  { id: 'default', name: '原色', hex: '' },
  { id: 'white', name: '白色', hex: '#f4f1ea' },
  { id: 'black', name: '黑色', hex: '#2a2a2e' },
  { id: 'brown', name: '棕色', hex: '#8a5a3b' },
  { id: 'gray', name: '灰色', hex: '#8d9099' },
  { id: 'orange', name: '橙色', hex: '#f08a3c' },
  { id: 'pink', name: '粉色', hex: '#f5a3c0' },
  { id: 'blue', name: '蓝色', hex: '#6aa6f0' },
  { id: 'purple', name: '紫色', hex: '#a77ee8' },
  { id: 'gold', name: '金色', hex: '#e8c25a' },
];

export const EYE_COLORS: { id: string; name: string; hex: string }[] = [
  { id: 'black', name: '黑色', hex: '#1a1a1f' },
  { id: 'brown', name: '棕色', hex: '#6b3d1f' },
  { id: 'blue', name: '蓝色', hex: '#2f7fe0' },
  { id: 'green', name: '绿色', hex: '#2ea85a' },
  { id: 'gold', name: '金色', hex: '#e0a92a' },
  { id: 'red', name: '红色', hex: '#d83a3a' },
  { id: 'purple', name: '紫色', hex: '#8a4fe0' },
];

export const EAR_STYLES = [
  { id: 'default', name: '原生耳朵' },
  { id: 'normal', name: '普通耳朵' },
  { id: 'big', name: '大耳朵' },
  { id: 'round', name: '圆耳朵' },
  { id: 'pointy', name: '尖耳朵' },
] as const;

export const EXPRESSIONS = [
  { id: 'normal', name: '平静' },
  { id: 'happy', name: '开心' },
  { id: 'cool', name: '酷酷' },
  { id: 'sleepy', name: '困倦' },
  { id: 'mischief', name: '坏笑' },
] as const;

export const EYEBROWS = [
  { id: 'none', name: '无' },
  { id: 'thin', name: '细眉' },
  { id: 'thick', name: '浓眉' },
  { id: 'angry', name: '怒眉' },
  { id: 'worried', name: '八字眉' },
] as const;

export const MOUTHS = [
  { id: 'smile', name: '微笑' },
  { id: 'grin', name: '咧嘴笑' },
  { id: 'flat', name: '面无表情' },
  { id: 'open', name: '张嘴' },
  { id: 'tongue', name: '吐舌头' },
] as const;

export const FACE_SHAPES = [
  { id: 'round', name: '圆脸' },
  { id: 'wide', name: '宽脸' },
  { id: 'long', name: '长脸' },
  { id: 'chubby', name: '胖嘟嘟' },
] as const;

export const OUTFITS = [
  { id: 'none', name: '无' },
  { id: 'tshirt', name: 'T 恤' },
  { id: 'suit', name: '西装' },
  { id: 'hoodie', name: '连帽衫' },
  { id: 'denim', name: '牛仔外套' },
  { id: 'gown', name: '礼服' },
  { id: 'police', name: '警察服' },
  { id: 'chef', name: '厨师服' },
  { id: 'racer', name: '赛车服' },
] as const;

export const HATS = [
  { id: 'none', name: '无' },
  { id: 'tophat', name: '🎩 礼帽' },
  { id: 'crown', name: '👑 皇冠' },
  { id: 'cap', name: '🧢 棒球帽' },
  { id: 'cowboy', name: '🤠 牛仔帽' },
  { id: 'grad', name: '🎓 学士帽' },
  { id: 'santa', name: '🎅 圣诞帽' },
] as const;

export const GLASSES = [
  { id: 'none', name: '无' },
  { id: 'shades', name: '黑色墨镜' },
  { id: 'round', name: '圆框眼镜' },
  { id: 'gold', name: '金色眼镜' },
  { id: 'science', name: '科学家眼镜' },
  { id: 'funny', name: '搞怪眼镜' },
] as const;

export const ACCESSORIES = [
  { id: 'none', name: '无' },
  { id: 'headphones', name: '耳机' },
  { id: 'necklace', name: '项链' },
  { id: 'backpack', name: '背包' },
  { id: 'bowtie', name: '蝴蝶结' },
  { id: 'tie', name: '领带' },
  { id: 'crown', name: '小皇冠' },
  { id: 'goldchain', name: '金链' },
  { id: 'wings', name: '小翅膀' },
] as const;

export const OUTFIT_COLORS = ['#e84a5f', '#2a9d8f', '#264653', '#f4a261', '#6c5ce7', '#ffffff', '#1d1d24', '#f2c94c'];

export interface AnimalConfig {
  species: Species;
  furColor: string; // FUR_COLORS id
  eyeColor: string; // EYE_COLORS id
  eyeSize: number; // 0.7 ~ 1.4
  expression: (typeof EXPRESSIONS)[number]['id'];
  ears: (typeof EAR_STYLES)[number]['id'];
  eyebrows: (typeof EYEBROWS)[number]['id'];
  mouth: (typeof MOUTHS)[number]['id'];
  face: (typeof FACE_SHAPES)[number]['id'];
  outfit: (typeof OUTFITS)[number]['id'];
  outfitColor: string;
  hat: (typeof HATS)[number]['id'];
  glasses: (typeof GLASSES)[number]['id'];
  accessory: (typeof ACCESSORIES)[number]['id'];
}

export interface PlayerProfile {
  name: string;
  animal: AnimalConfig;
  level?: number;
}

export const DEFAULT_ANIMAL: AnimalConfig = {
  species: 'cat',
  furColor: 'default',
  eyeColor: 'black',
  eyeSize: 1,
  expression: 'normal',
  ears: 'default',
  eyebrows: 'none',
  mouth: 'smile',
  face: 'round',
  outfit: 'tshirt',
  outfitColor: '#e84a5f',
  hat: 'none',
  glasses: 'none',
  accessory: 'none',
};

export const NAME_IDEAS = ['小橘', '熊大', '扑克王', '赌神猫', '青蛙哥', '狐狸先生', '疯狂兔', '奶茶', '豆包', '团子', '阿福', '旺财', '咕咕', '布丁'];

export function sanitizeName(name: unknown, fallback = '神秘动物'): string {
  if (typeof name !== 'string') return fallback;
  const n = name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
  return n || fallback;
}

/** 校验来自网络的角色配置，非法字段回落到默认值 */
export function sanitizeAnimal(a: any): AnimalConfig {
  const out: AnimalConfig = { ...DEFAULT_ANIMAL };
  if (!a || typeof a !== 'object') return out;
  const pickFrom = <T extends string>(v: unknown, list: readonly { id: T }[], def: T): T =>
    list.some((x) => x.id === v) ? (v as T) : def;
  out.species = SPECIES.some((s) => s.id === a.species) ? a.species : 'cat';
  out.furColor = pickFrom(a.furColor, FUR_COLORS, 'default');
  out.eyeColor = pickFrom(a.eyeColor, EYE_COLORS, 'black');
  out.eyeSize = typeof a.eyeSize === 'number' ? Math.min(1.4, Math.max(0.7, a.eyeSize)) : 1;
  out.expression = pickFrom(a.expression, EXPRESSIONS, 'normal');
  out.ears = pickFrom(a.ears, EAR_STYLES, 'default');
  out.eyebrows = pickFrom(a.eyebrows, EYEBROWS, 'none');
  out.mouth = pickFrom(a.mouth, MOUTHS, 'smile');
  out.face = pickFrom(a.face, FACE_SHAPES, 'round');
  out.outfit = pickFrom(a.outfit, OUTFITS, 'none');
  out.outfitColor = typeof a.outfitColor === 'string' && /^#[0-9a-f]{6}$/i.test(a.outfitColor) ? a.outfitColor : '#e84a5f';
  out.hat = pickFrom(a.hat, HATS, 'none');
  out.glasses = pickFrom(a.glasses, GLASSES, 'none');
  out.accessory = pickFrom(a.accessory, ACCESSORIES, 'none');
  return out;
}

export function randomAnimal(rng: () => number = Math.random, allowed?: Species[]): AnimalConfig {
  const r = <T>(arr: readonly T[]) => arr[Math.floor(rng() * arr.length)];
  const species = r(allowed && allowed.length ? allowed : SPECIES.map((s) => s.id));
  return {
    species,
    furColor: rng() < 0.55 ? 'default' : r(FUR_COLORS).id,
    eyeColor: r(EYE_COLORS).id,
    eyeSize: Math.round((0.8 + rng() * 0.5) * 100) / 100,
    expression: r(EXPRESSIONS).id,
    ears: rng() < 0.6 ? 'default' : r(EAR_STYLES).id,
    eyebrows: r(EYEBROWS).id,
    mouth: r(MOUTHS).id,
    face: r(FACE_SHAPES).id,
    outfit: r(OUTFITS.slice(1)).id,
    outfitColor: r(OUTFIT_COLORS),
    hat: rng() < 0.4 ? 'none' : r(HATS).id,
    glasses: rng() < 0.55 ? 'none' : r(GLASSES).id,
    accessory: rng() < 0.4 ? 'none' : r(ACCESSORIES).id,
  };
}

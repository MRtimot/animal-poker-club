// 外观定制（纯视觉）：牌桌主题、牌面 / 牌背、筹码配色。只改变颜色、边框、图案与灯光，
// 从不改变牌的身份（A♠ 永远是 A♠）、概率、结果或赔付；也不进入任何牌局状态或网络消息。
// “classic” 与原来的外观完全一样：德州、21 点默认不受影响。
import { createContext } from 'react';

export type TableThemeId = 'classic' | 'luxury' | 'dark' | 'royal' | 'animal' | 'midnight' | 'velvet' | 'gold' | 'modern';
export interface TableTheme {
  name: string;
  /** 桌布颜色 */
  felt: string;
  /** 桌边皮革 */
  rail: string;
  /** 桌面印字 / 界面强调色 */
  accent: string;
  /** 桌面上方的补光颜色 */
  light: string;
}

export const TABLE_THEMES: Record<TableThemeId, TableTheme> = {
  classic: { name: '经典', felt: '#1d5e3d', rail: '#2a1410', accent: '#e8d092', light: '#ffe2b0' },
  luxury: { name: '奢华', felt: '#164640', rail: '#1b1210', accent: '#f0d58a', light: '#fff0c8' },
  dark: { name: '暗夜', felt: '#1c1e24', rail: '#0f0f12', accent: '#c9c9d4', light: '#d8dcff' },
  royal: { name: '皇家', felt: '#1d2c63', rail: '#2a1830', accent: '#f0cf72', light: '#ffe6b8' },
  animal: { name: '动物俱乐部', felt: '#34622c', rail: '#4a2a18', accent: '#f6cd7a', light: '#ffd9a0' },
  midnight: { name: '午夜', felt: '#122340', rail: '#0d1220', accent: '#9cc0ff', light: '#b8ccff' },
  velvet: { name: '红丝绒', felt: '#5e1422', rail: '#1c0c0e', accent: '#f0c2ae', light: '#ffd0c0' },
  gold: { name: '金殿', felt: '#3b2a12', rail: '#1a1208', accent: '#ffd479', light: '#ffe08a' },
  modern: { name: '现代', felt: '#2c3640', rail: '#202428', accent: '#eef2f6', light: '#f2f6ff' },
};

export type CardSkinId = 'classic' | 'premium' | 'dark' | 'gold' | 'animal' | 'minimal';
export interface CardSkin {
  name: string;
  /** 牌面纸色、边框、黑色花色、红色花色 */
  paper: string;
  frame: string;
  black: string;
  red: string;
  /** 牌背底色、花纹、中央记号 */
  back: string;
  pattern: string;
  mark: string;
}

export const CARD_SKINS: Record<CardSkinId, CardSkin> = {
  classic: { name: '经典', paper: '#fbf8f0', frame: 'rgba(184,144,47,0.55)', black: '#121216', red: '#c0152f', back: '#7d1424', pattern: 'diamond', mark: 'APC' },
  premium: { name: '典藏', paper: '#fbf6e8', frame: 'rgba(160,120,30,0.9)', black: '#14131a', red: '#a8102a', back: '#13213f', pattern: 'diamond', mark: '♛' },
  dark: { name: '黑曜', paper: '#1e1f25', frame: 'rgba(210,190,140,0.6)', black: '#e9e6de', red: '#ff6a7a', back: '#0d0d10', pattern: 'lines', mark: '✦' },
  gold: { name: '鎏金', paper: '#fff8e4', frame: 'rgba(196,150,40,1)', black: '#1a1408', red: '#b1122c', back: '#2a1d08', pattern: 'sunburst', mark: '◆' },
  animal: { name: '动物', paper: '#fdf8ee', frame: 'rgba(120,160,90,0.7)', black: '#1a1a14', red: '#c0152f', back: '#2f5a2a', pattern: 'paws', mark: '🐾' },
  minimal: { name: '极简', paper: '#ffffff', frame: 'rgba(0,0,0,0.12)', black: '#111111', red: '#d0102a', back: '#24262c', pattern: 'none', mark: '' },
};

export type ChipSkinId = 'classic' | 'gold' | 'black' | 'royal' | 'animal';
export interface ChipSkin {
  name: string;
  /** 按面额换色（classic 返回原色） */
  colors: Partial<Record<number, string>>;
}

export const CHIP_SKINS: Record<ChipSkinId, ChipSkin> = {
  classic: { name: '经典', colors: {} },
  gold: { name: '金色', colors: { 1: '#f3e6c0', 5: '#d9b860', 25: '#c9a23e', 100: '#a8822a', 500: '#8a6a1e', 1000: '#e0b84a', 5000: '#6e5212', 25000: '#4e3a0c', 100000: '#2e2208' } },
  black: { name: '黑金', colors: { 1: '#d8d8dc', 5: '#7a7a82', 25: '#55555c', 100: '#1b1b20', 500: '#2c2c34', 1000: '#3a3320', 5000: '#101014', 25000: '#24242a', 100000: '#0a0a0c' } },
  royal: { name: '皇家', colors: { 1: '#e8e4f6', 5: '#8e2a52', 25: '#2a3f8e', 100: '#1d1a3a', 500: '#5a2a8a', 1000: '#c9a23e', 5000: '#6a1a3a', 25000: '#1a2a6a', 100000: '#3a1a5a' } },
  animal: { name: '动物', colors: { 1: '#fff3e0', 5: '#ff9e80', 25: '#8bd3a8', 100: '#5a4636', 500: '#b39ddb', 1000: '#ffd54f', 5000: '#f48fb1', 25000: '#81d4fa', 100000: '#a1887f' } },
};

/** 当前牌桌使用的牌 / 筹码外观（由场景提供；没有提供时就是 classic） */
export const CardSkinContext = createContext<CardSkinId>('classic');
export const ChipSkinContext = createContext<ChipSkinId>('classic');

const own = (o: object, x: unknown) => typeof x === 'string' && Object.prototype.hasOwnProperty.call(o, x);
export const isTableTheme = (x: unknown): x is TableThemeId => own(TABLE_THEMES, x);
export const isCardSkin = (x: unknown): x is CardSkinId => own(CARD_SKINS, x);
export const isChipSkin = (x: unknown): x is ChipSkinId => own(CHIP_SKINS, x);

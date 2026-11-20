import type { Species } from '../../core/player/profile';

export type EarType = 'pointy' | 'round' | 'long' | 'floppy' | 'small' | 'none' | 'koala' | 'side';
export type SnoutType = 'short' | 'long' | 'beak' | 'none' | 'monkey' | 'dragon';
export type TailType = 'cat' | 'bushy' | 'puff' | 'short' | 'curl' | 'tuft' | 'none' | 'dragon' | 'dog' | 'ringed' | 'penguin';

export interface SpeciesLook {
  ear: EarType;
  snout: SnoutType;
  tail: TailType;
  nose: string;
  inner: string; // 耳内 / 腹部的浅色
  muzzle?: string; // 嘴部颜色（默认取浅色）
  limbs?: string; // 四肢颜色覆盖（熊猫）
  features: Partial<Record<'panda' | 'raccoon' | 'tiger' | 'lion' | 'penguin' | 'frog' | 'koala' | 'whiskers' | 'dragon' | 'teeth' | 'foxTips' | 'monkey', boolean>>;
}

export const LOOKS: Record<Species, SpeciesLook> = {
  cat: { ear: 'pointy', snout: 'short', tail: 'cat', nose: '#f08aa0', inner: '#ffd9e0', features: { whiskers: true } },
  dog: { ear: 'floppy', snout: 'long', tail: 'dog', nose: '#2a1d18', inner: '#f1dcc0', features: {} },
  fox: { ear: 'pointy', snout: 'long', tail: 'bushy', nose: '#1d1414', inner: '#fff3e6', muzzle: '#fff6ea', features: { foxTips: true, whiskers: true } },
  panda: { ear: 'round', snout: 'short', tail: 'short', nose: '#1b1b1f', inner: '#f5f5f2', limbs: '#1f1f24', features: { panda: true } },
  rabbit: { ear: 'long', snout: 'short', tail: 'puff', nose: '#f39ab0', inner: '#ffd6e2', features: { teeth: true, whiskers: true } },
  bear: { ear: 'round', snout: 'short', tail: 'short', nose: '#2a1b14', inner: '#c79a72', muzzle: '#d9b08a', features: {} },
  raccoon: { ear: 'pointy', snout: 'short', tail: 'ringed', nose: '#1b1b1f', inner: '#e8e8ea', muzzle: '#f0f0f0', features: { raccoon: true, whiskers: true } },
  frog: { ear: 'none', snout: 'none', tail: 'none', nose: '#3a7a2a', inner: '#e6f5b8', features: { frog: true } },
  lion: { ear: 'round', snout: 'short', tail: 'tuft', nose: '#5a3020', inner: '#f6dca8', muzzle: '#f8e2b8', features: { lion: true, whiskers: true } },
  tiger: { ear: 'round', snout: 'short', tail: 'cat', nose: '#e07a8a', inner: '#fff3e6', muzzle: '#fff6ea', features: { tiger: true, whiskers: true } },
  koala: { ear: 'koala', snout: 'none', tail: 'short', nose: '#2b2b30', inner: '#f2f2f4', features: { koala: true } },
  monkey: { ear: 'side', snout: 'monkey', tail: 'curl', nose: '#5a3a2a', inner: '#f2cfa8', features: { monkey: true } },
  penguin: { ear: 'none', snout: 'beak', tail: 'penguin', nose: '#f5a623', inner: '#ffffff', features: { penguin: true } },
  wolf: { ear: 'pointy', snout: 'long', tail: 'bushy', nose: '#1b1b1f', inner: '#e8ecf0', muzzle: '#eef1f4', features: { whiskers: false } },
  dragon: { ear: 'none', snout: 'dragon', tail: 'dragon', nose: '#1e5a46', inner: '#f3d27a', features: { dragon: true } },
};

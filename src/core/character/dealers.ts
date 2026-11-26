// 动物庄家（21 点、百家乐共用）：使用现有的动物与外观系统。性格只决定台词、动作与节奏，绝不影响牌、洗牌、概率或赔付。
import { type AnimalConfig, type PlayerProfile, type Species, DEFAULT_ANIMAL } from '../player/profile';

export interface DealerInfo {
  species: Species;
  name: string;
  trait: string;
}

export const DEALERS: readonly DealerInfo[] = [
  { species: 'cat', name: '黑爪夫人', trait: '高傲 · 优雅 · 略带得意' },
  { species: 'fox', name: '赤尾先生', trait: '聪明 · 爱逗人 · 自信' },
  { species: 'tiger', name: '虎爷', trait: '威严 · 沉稳 · 有压迫感' },
  { species: 'lion', name: '金鬃', trait: '气场强大 · 说一不二' },
  { species: 'wolf', name: '夜影', trait: '冷静 · 话少 · 目光锐利' },
  { species: 'panda', name: '墨团', trait: '慢条斯理 · 憨厚' },
  { species: 'bear', name: '老棕', trait: '稳重 · 宽厚' },
  { species: 'rabbit', name: '雪球', trait: '紧张 · 可爱 · 容易吃惊' },
  { species: 'monkey', name: '跳跳', trait: '调皮 · 爱闹 · 精力旺盛' },
];

export type DealerChoice = Species | 'auto';

export function isDealerChoice(x: unknown): x is DealerChoice {
  return x === 'auto' || DEALERS.some((d) => d.species === x);
}

/** 荷官制服：在现有服装里搭配，不新增模型 */
function uniform(species: Species): AnimalConfig {
  return { ...DEFAULT_ANIMAL, species, outfit: 'suit', outfitColor: '#1d1d24', accessory: 'bowtie', expression: species === 'cat' || species === 'fox' || species === 'monkey' ? 'mischief' : 'normal', eyebrows: species === 'tiger' || species === 'lion' ? 'angry' : 'none' };
}

export function pickDealer(choice: DealerChoice, rng: () => number): { profile: PlayerProfile; trait: string } {
  const list = choice === 'auto' ? DEALERS : DEALERS.filter((d) => d.species === choice);
  const d = list[Math.floor(rng() * list.length) % list.length] ?? DEALERS[0];
  return { profile: { name: d.name, animal: uniform(d.species) }, trait: d.trait };
}

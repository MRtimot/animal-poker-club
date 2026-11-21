import { Card, RANKS, SUITS, makeCard } from './card';
import { RNG, secureRandom } from '../utils/random';

/** 标准 52 张牌组：创建 / 洗牌 / 发牌 / 回收 / 重置 */
export class Deck {
  private cards: Card[] = [];
  private dealt: Card[] = [];

  constructor(private rng: RNG = secureRandom) {
    this.reset();
  }

  static fullDeck(): Card[] {
    const out: Card[] = [];
    for (const suit of SUITS) for (const rank of RANKS) out.push(makeCard(rank, suit));
    return out;
  }

  /** 重置为完整有序的 52 张牌 */
  reset(): void {
    this.cards = Deck.fullDeck();
    this.dealt = [];
  }

  /** Fisher–Yates 洗牌 */
  shuffle(): void {
    const a = this.cards;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  deal(): Card {
    const c = this.cards.pop();
    if (!c) throw new Error('牌堆已空');
    this.dealt.push(c);
    return c;
  }

  dealMany(n: number): Card[] {
    const out: Card[] = [];
    for (let i = 0; i < n; i++) out.push(this.deal());
    return out;
  }

  /** 弃一张牌（烧牌） */
  burn(): Card {
    return this.deal();
  }

  /** 回收所有已发出的牌放回牌堆（未洗） */
  collect(): void {
    this.cards.push(...this.dealt);
    this.dealt = [];
  }

  get remaining(): number {
    return this.cards.length;
  }

  /** 保存牌堆状态（用于多台服务器之间共享牌局；只在服务器内部使用，从不发给客户端） */
  toState(): { cards: Card[]; dealt: Card[] } {
    return { cards: [...this.cards], dealt: [...this.dealt] };
  }

  static fromState(s: { cards: Card[]; dealt: Card[] }, rng: RNG = secureRandom): Deck {
    const d = new Deck(rng);
    d.cards = [...s.cards];
    d.dealt = [...s.dealt];
    return d;
  }

  get dealtCount(): number {
    return this.dealt.length;
  }

  peekAll(): readonly Card[] {
    return this.cards;
  }
}

// 牌靴：多副牌。每张实体牌有唯一编号（uid），同一张实体牌不可能同时出现两次。
// 内部只存编号（0 ~ 52×副数-1），保存到共享存储时很小；只在服务器 / 本地主机里，从不发给客户端。
import { RANKS, SUITS, makeCard, type Card } from '../cards/card';
import { secureRandom, type RNG } from '../utils/random';

export interface BjCard extends Card {
  /** 实体牌编号，例如 “As-3”（第 3 副牌里的黑桃 A） */
  uid: string;
}

export interface ShoeState {
  order: number[];
  next: number;
  roundStart: number;
  decks: number;
}

export function cardFromCode(code: number): BjCard {
  const deck = Math.floor(code / 52);
  const k = code % 52;
  const c = makeCard(RANKS[k % 13], SUITS[Math.floor(k / 13)]);
  return { ...c, uid: `${c.id}-${deck}` };
}

export class Shoe {
  private order: number[] = [];
  private next = 0;
  /** 这一局从哪里开始发（之前的是弃牌） */
  private roundStart = 0;

  constructor(
    readonly decks: number,
    private rng: RNG = secureRandom,
  ) {
    this.shuffleAll();
  }

  get size() {
    return this.order.length;
  }
  get remaining() {
    return this.order.length - this.next;
  }

  private mix(a: number[]) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** 全部收回重新洗牌（只能在两局之间调用：桌上没有牌） */
  shuffleAll() {
    this.order = this.mix(Array.from({ length: this.decks * 52 }, (_, i) => i));
    this.next = 0;
    this.roundStart = 0;
  }

  /** 新的一局：之前发出的都算弃牌；用掉的比例超过 penetration 就重新洗牌。返回是否洗牌 */
  beginRound(penetration: number): boolean {
    this.roundStart = this.next;
    if (this.next < this.order.length * penetration) return false;
    this.shuffleAll();
    return true;
  }

  /** 发一张牌。牌靴用完时只把弃牌重新洗好接上，桌上正在用的牌不会被重复发出 */
  draw(): BjCard {
    if (this.next >= this.order.length) {
      const inPlay = this.order.slice(this.roundStart);
      const discards = this.mix(this.order.slice(0, this.roundStart));
      if (!discards.length) throw new Error('牌靴已空');
      this.order = [...inPlay, ...discards];
      this.roundStart = 0;
      this.next = inPlay.length;
    }
    return cardFromCode(this.order[this.next++]);
  }

  toState(): ShoeState {
    return { order: [...this.order], next: this.next, roundStart: this.roundStart, decks: this.decks };
  }

  static fromState(s: ShoeState, rng: RNG = secureRandom): Shoe {
    const shoe = new Shoe(s.decks, rng);
    shoe.order = [...s.order];
    shoe.next = s.next;
    shoe.roundStart = s.roundStart;
    return shoe;
  }
}

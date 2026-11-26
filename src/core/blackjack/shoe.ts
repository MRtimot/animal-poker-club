// 牌组：每局一副新的 52 张。每张实体牌有唯一编号（uid），同一张实体牌不可能同时出现两次。
// 内部只存编号，保存到共享存储时很小；只在服务器 / 本地主机里，从不发给客户端。
import { cardFromCode, deckCodes, type PhysicalCard } from '../cards/physical';
import { cryptoRandom, type RNG } from '../utils/random';

/** 21 点的实体牌（与百家乐共用同一种实体牌） */
export type BjCard = PhysicalCard;
export { cardFromCode };

export interface ShoeState {
  order: number[];
  next: number;
  /** 这一局拆开了几副牌（正常 1 副） */
  opened: number;
}

const fresh = deckCodes;

/**
 * 每一局一副新的标准 52 张牌：生成 → Fisher–Yates 洗牌（加密安全随机数）→ 从顶上依次发 → 一局结束整副丢弃。
 * 洗牌只用随机数，不读取任何玩家、下注、余额、连胜连败或庄家性格。
 * 极少数情况（多人、多手、很多小牌）一局把 52 张发完：再拆一副新牌洗好接上（新牌是另外的实体牌，编号不同，不会重复）。
 */
export class Shoe {
  private order: number[] = [];
  private next = 0;
  private opened = 0;

  constructor(private rng: RNG = cryptoRandom) {
    this.newRound();
  }

  get size() {
    return this.order.length;
  }
  get remaining() {
    return this.order.length - this.next;
  }

  /** Fisher–Yates：从最后一张起，与前面（含自己）随机一张交换 */
  private mix(a: number[]) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** 新的一局：丢掉上一局的整副牌，换一副新的 52 张并洗好 */
  newRound() {
    this.opened = 1;
    this.order = this.mix(fresh(0));
    this.next = 0;
  }

  /** 从顶上发一张（发出的牌不会再回到牌堆） */
  draw(): BjCard {
    if (this.next >= this.order.length) this.order.push(...this.mix(fresh(this.opened++)));
    return cardFromCode(this.order[this.next++]);
  }

  toState(): ShoeState {
    return { order: [...this.order], next: this.next, opened: this.opened };
  }

  /** 旧版本保存的多副牌靴也能读：这一局照常发完，下一局换成新的一副 */
  static fromState(s: ShoeState, rng: RNG = cryptoRandom): Shoe {
    const shoe = new Shoe(rng);
    shoe.order = [...s.order];
    shoe.next = s.next;
    shoe.opened = Number.isInteger(s.opened) && s.opened > 0 ? s.opened : Math.max(1, Math.ceil(s.order.length / 52));
    return shoe;
  }
}

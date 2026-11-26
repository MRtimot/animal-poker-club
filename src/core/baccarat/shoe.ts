// 百家乐牌靴：多副标准 52 张牌放在一起，Fisher–Yates 洗牌（加密安全随机数）。
// 发牌从顶上依次取出，发出的牌不会回到牌靴；剩余牌少于切牌位置时，在下一局开始前整个换新牌靴并重新洗牌（一局中途绝不洗牌）。
// 洗牌只用随机数，不读取任何玩家、下注、余额、连胜连败、等级或庄家性格。整个牌序只在服务器 / 本地主机里，从不发给客户端。
import { cardFromCode, deckCodes, type PhysicalCard } from '../cards/physical';
import { cryptoRandom, randomId, type RNG } from '../utils/random';

export type BacCard = PhysicalCard;

export interface BacShoeState {
  order: number[];
  next: number;
  decks: number;
  /** 每换一次新牌靴就换一个编号（界面显示 / 排查用） */
  shoeId: string;
}

export class BacShoe {
  private order: number[] = [];
  private next = 0;
  shoeId = '';

  constructor(
    readonly decks: number,
    private rng: RNG = cryptoRandom,
  ) {
    this.fresh();
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

  /** 换一个新牌靴：decks 副全新的牌，洗好 */
  private fresh() {
    this.order = this.mix(Array.from({ length: this.decks }, (_, d) => deckCodes(d)).flat());
    this.next = 0;
    this.shoeId = `shoe-${randomId(8)}`;
  }

  /** 新的一局：到了切牌位置就换新牌靴。返回是否换了新牌靴 */
  beginRound(reshuffleAt: number): boolean {
    if (this.remaining >= reshuffleAt) return false;
    this.fresh();
    return true;
  }

  /** 从顶上发一张 */
  draw(): BacCard {
    if (this.next >= this.order.length) throw new Error('牌靴已空');
    return cardFromCode(this.order[this.next++]);
  }

  toState(): BacShoeState {
    return { order: [...this.order], next: this.next, decks: this.decks, shoeId: this.shoeId };
  }

  static fromState(s: BacShoeState, rng: RNG = cryptoRandom): BacShoe {
    const shoe = new BacShoe(s.decks, rng);
    shoe.order = [...s.order];
    shoe.next = s.next;
    shoe.shoeId = s.shoeId;
    return shoe;
  }
}

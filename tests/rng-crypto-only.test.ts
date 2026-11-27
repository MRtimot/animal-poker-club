// 发牌随机数：三种玩法默认都只用加密安全随机数。环境没有 crypto.getRandomValues 时直接报错，
// 绝不悄悄退回 Math.random（以前德州的牌组与 21 点控制器默认用 secureRandom，会退回 Math.random）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Deck } from '../src/core/cards/deck';
import { PokerEngine } from '../src/core/table/engine';
import { GameController } from '../src/core/game/controller';
import { BlackjackController } from '../src/core/blackjack/controller';
import { BaccaratController } from '../src/core/baccarat/controller';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';

const prof = (name: string) => ({ name, animal: DEFAULT_ANIMAL, level: 1 });
const realCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

/** 暂时拿掉 crypto（模拟不支持安全随机数的环境） */
function withoutCrypto<T>(fn: () => T): T {
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (realCrypto) Object.defineProperty(globalThis, 'crypto', realCrypto);
  }
}

afterEach(() => vi.restoreAllMocks());

describe('发牌只用加密安全随机数', () => {
  it('RNG-01 有 crypto 时：洗牌、德州发牌不调用 Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    const d = new Deck();
    d.shuffle();
    const e = new PokerEngine({ smallBlind: 10, bigBlind: 20 });
    e.addPlayer('a', 'a', 1000);
    e.addPlayer('b', 'b', 1000);
    e.startHand();
    expect(spy).not.toHaveBeenCalled();
  });

  it('RNG-02 没有 crypto 时：德州牌组 / 牌桌引擎 / 牌局控制器直接报错，不退回 Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    expect(() => withoutCrypto(() => new Deck().shuffle())).toThrow('安全随机数');
    expect(() =>
      withoutCrypto(() => {
        const e = new PokerEngine({ smallBlind: 10, bigBlind: 20 });
        e.addPlayer('a', 'a', 1000);
        e.addPlayer('b', 'b', 1000);
        e.startHand();
      }),
    ).toThrow('安全随机数');
    expect(() =>
      withoutCrypto(() => {
        const c = new GameController(
          [
            { id: 'a', profile: prof('a'), chips: 1000, isAI: false },
            { id: 'b', profile: prof('b'), chips: 1000, isAI: false },
          ],
          { smallBlind: 10, bigBlind: 20, autoRun: false, aiRng: () => 0.5 },
        );
        c.start();
        c.tick(Date.now() + 60_000);
      }),
    ).toThrow('安全随机数');
    expect(spy).not.toHaveBeenCalled();
  });

  it('RNG-03 没有 crypto 时：21 点、百家乐控制器同样报错（不会用 Math.random 洗牌）', () => {
    const spy = vi.spyOn(Math, 'random');
    const seats = [{ id: 'me', profile: prof('me'), chips: 1000, isAI: false }];
    const opts = { solo: true, autoRun: false, aiRng: () => 0.5, dealer: { profile: prof('庄'), trait: '' } } as any;
    expect(() => withoutCrypto(() => new BlackjackController(seats, opts))).toThrow('安全随机数');
    expect(() => withoutCrypto(() => new BaccaratController(seats, opts))).toThrow('安全随机数');
    expect(spy).not.toHaveBeenCalled();
  });
});

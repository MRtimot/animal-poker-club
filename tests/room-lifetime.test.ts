// 在线房间的生命周期：大厅可以长时间等人；断线不等于离开；房主可以回来；只有到了明确的过期时间才关闭；关闭后不留任何东西。
// 用可控的“服务器时间”快进几十分钟到几小时，然后手动触发一次清理（与真实服务器每几秒一次的清理相同）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomServer } from '../server/rooms';
import { MemoryHub } from '../server/store';
import { ROOM_LIFETIME, roomExpiry } from '../server/roomLifetime';
import { DEFAULT_ANIMAL } from '../src/core/player/profile';

const MIN = 60_000;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 5000) {
  const t0 = performance.now();
  while (!cond()) {
    if (performance.now() - t0 > ms) throw new Error('等待超时');
    await wait(5);
  }
}

/** 服务器时间可以快进（setTimeout 仍然是真实时间） */
let skew = 0;
const realNow = Date.now.bind(Date);
vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
const later = (ms: number) => void (skew += ms);
afterEach(() => void (skew = 0));

const SET = { maxPlayers: 4, startingChips: 1000, smallBlind: 10, bigBlind: 20, turnSeconds: 30 };

class Conn {
  msgs: any[] = [];
  room: any = null;
  bj: any = null;
  playerId = '';
  sessionId = '';
  h: ReturnType<RoomServer['connect']>;
  constructor(
    private srv: RoomServer,
    public name: string,
  ) {
    this.h = this.open();
  }
  private open() {
    return this.srv.connect({
      send: (m) => {
        const x = JSON.parse(JSON.stringify(m));
        this.msgs.push(x);
        if (x.t === 'welcome') (this.playerId = x.playerId), (this.sessionId = x.sessionId);
        if (x.t === 'room') this.room = x.room;
        if (x.t === 'bjState') this.bj = x.view;
      },
    });
  }
  send(m: any) {
    this.h.onMessage(JSON.stringify(m));
  }
  async hello(sessionId?: string) {
    this.playerId = '';
    this.send({ t: 'hello', sessionId, profile: { name: this.name, animal: DEFAULT_ANIMAL, level: 1 } });
    await until(() => !!this.playerId);
    return this;
  }
  /** 网络断开 / 切到后台：连接关闭，但没有发送“离开房间” */
  drop() {
    this.h.onClose();
  }
  /** 重新连接（同一个会话：刷新页面 / 回到前台 / 网络恢复） */
  async reconnect() {
    this.h = this.open();
    this.room = null;
    await this.hello(this.sessionId);
    await until(() => this.msgs.some((m) => m.t === 'room'));
    return this;
  }
  async create(s: object = SET) {
    this.send({ t: 'createRoom', settings: s });
    await until(() => !!this.room);
    return this.room.code as string;
  }
  errors() {
    return this.msgs.filter((m) => m.t === 'error').map((m) => m.message as string);
  }
}

function make(o = {}) {
  const hub = new MemoryHub();
  const srv = new RoomServer({ pace: 0.02, turnTimeMs: 600, disconnectGraceMs: 30, store: hub.store('t'), ...o });
  clearInterval((srv as any).sweepTimer);
  const sweep = async () => {
    (srv as any).sweep();
    await wait(40);
  };
  return { srv, hub, sweep };
}

describe('在线房间生命周期', () => {
  it('LT-01 默认时长：大厅等人 2 小时、无人在线保留 30 分钟、结束后保留 30 分钟、断线座位保留 15 分钟、房主 3 分钟后交接', () => {
    expect(ROOM_LIFETIME).toEqual({ waitingMs: 120 * MIN, emptyMs: 30 * MIN, finishedMs: 30 * MIN, seatHoldMs: 15 * MIN, hostGraceMs: 3 * MIN });
    const life = { waitingMs: 120 * MIN, emptyMs: 30 * MIN, finishedMs: 30 * MIN };
    expect(roomExpiry({ status: 'lobby', waitingSince: 1, emptySince: null }, life)).toEqual({ at: 120 * MIN + 1, reason: 'waiting' });
    expect(roomExpiry({ status: 'lobby', waitingSince: 1, emptySince: 10 * MIN }, life)).toEqual({ at: 40 * MIN, reason: 'empty' });
    expect(roomExpiry({ status: 'playing', waitingSince: null, emptySince: null }, life)).toBeNull();
    expect(roomExpiry({ status: 'finished', finishedAt: 5 * MIN, emptySince: null }, life)).toEqual({ at: 35 * MIN, reason: 'finished' });
  });

  it('LT-02 大厅等人：房主在线等了 65 分钟，朋友才用房间代码加入；房间代码一直有效', async () => {
    const { srv, sweep } = make();
    const host = await new Conn(srv, '阿福').hello();
    const code = await host.create();
    for (let i = 0; i < 13; i++) {
      later(5 * MIN);
      await sweep();
    }
    expect(srv.getRoom(code)).toBeTruthy();
    const guest = await new Conn(srv, '布丁').hello();
    guest.send({ t: 'joinRoom', code });
    await until(() => guest.room?.members.length === 2);
    expect(host.room.expiresAt).toBe(srv.getRoom(code)!.waitingSince! + 120 * MIN);
    srv.dispose();
  });

  it('LT-03 房主切到后台（只有他一个人）：25 分钟后回来，房间、房主、座位都在；没有回来就 30 分钟后关闭', async () => {
    const { srv, sweep } = make();
    const host = await new Conn(srv, '阿福').hello();
    const code = await host.create();
    const id = host.playerId;
    host.drop();
    await until(() => srv.getRoom(code)!.members[0].connected === false);
    later(25 * MIN);
    await sweep();
    expect(srv.getRoom(code)).toBeTruthy();
    await host.reconnect();
    expect([host.playerId, host.room?.code, host.room?.hostId]).toEqual([id, code, id]);
    expect(host.room.members[0].connected).toBe(true);
    // 再次离开，这次不回来
    host.drop();
    await until(() => srv.getRoom(code)!.members[0].connected === false);
    later(29 * MIN);
    await sweep();
    expect(srv.getRoom(code)).toBeTruthy();
    later(2 * MIN);
    await sweep();
    expect(srv.getRoom(code)).toBeUndefined();
    const late = await new Conn(srv, '迟到').hello();
    late.send({ t: 'joinRoom', code });
    await until(() => late.errors().length > 0);
    expect(late.errors()[0]).toContain('房间不存在');
    srv.dispose();
  });

  it('LT-04 客人断网 10 秒、10 分钟都能回到同一个座位；超过 15 分钟才让出座位', async () => {
    const { srv, sweep } = make();
    const host = await new Conn(srv, '阿福').hello();
    const code = await host.create();
    const guest = await new Conn(srv, '布丁').hello();
    guest.send({ t: 'joinRoom', code });
    await until(() => host.room?.members.length === 2);
    const gid = guest.playerId;
    guest.drop();
    await until(() => host.room.members.find((m: any) => m.id === gid)?.connected === false);
    later(10 * MIN);
    await sweep();
    await guest.reconnect();
    expect([guest.playerId, guest.room?.code, guest.room.members.length]).toEqual([gid, code, 2]);
    guest.drop();
    await until(() => host.room.members.find((m: any) => m.id === gid)?.connected === false);
    later(16 * MIN);
    await sweep();
    await until(() => host.room.members.length === 1);
    expect(host.room.code).toBe(code);
    srv.dispose();
  });

  it('LT-05 房主断线：3 分钟内回来仍是房主；超过 3 分钟把房主交给在线的客人，房主回来后座位还在', async () => {
    const { srv, sweep } = make();
    const host = await new Conn(srv, '阿福').hello();
    const code = await host.create();
    const guest = await new Conn(srv, '布丁').hello();
    guest.send({ t: 'joinRoom', code });
    await until(() => host.room?.members.length === 2);
    host.drop();
    await until(() => guest.room.members.find((m: any) => m.id === host.playerId)?.connected === false);
    later(2 * MIN);
    await sweep();
    await host.reconnect();
    expect(host.room.hostId).toBe(host.playerId);
    host.drop();
    await until(() => guest.room.members.find((m: any) => m.id === host.playerId)?.connected === false);
    later(4 * MIN);
    await sweep();
    await until(() => guest.room.hostId === guest.playerId);
    await host.reconnect();
    expect([host.room.code, host.room.members.length, host.room.hostId]).toEqual([code, 2, guest.playerId]);
    srv.dispose();
  });

  it('LT-06 21 点牌局进行中：所有人在线、长时间没人下注（3 小时）也不会被删除；共享存储的记录会续期', async () => {
    const { srv, hub, sweep } = make();
    const host = await new Conn(srv, '阿福').hello();
    const code = await host.create({ ...SET, gameMode: 'blackjack-21' });
    const guest = await new Conn(srv, '布丁').hello();
    guest.send({ t: 'joinRoom', code });
    await until(() => host.room?.members.length === 2);
    guest.send({ t: 'ready', ready: true });
    await until(() => host.room.members.every((m: any) => m.ready));
    host.send({ t: 'startGame' });
    await until(() => !!host.bj && host.room.status === 'playing');
    expect(host.room.expiresAt).toBeNull();
    for (let i = 0; i < 18; i++) {
      later(10 * MIN);
      await sweep();
    }
    expect(srv.getRoom(code)?.status).toBe('playing');
    expect(await hub.store('x').loadRoom(code)).not.toBeNull();
    // 牌局中断网再回来：同一局、同一座位，暗牌仍然保密
    guest.drop();
    await until(() => host.room.members.find((m: any) => m.id === guest.playerId)?.connected === false);
    await guest.reconnect();
    await until(() => !!guest.bj);
    expect(guest.bj.roundId).toBe(host.bj.roundId);
    expect(guest.bj.players.some((p: any) => p.id === guest.playerId)).toBe(true);
    srv.dispose();
  });

  it('LT-07 21 点一局中途所有人都断线超过 30 分钟：房间关闭，下注按离桌结算（不会悬空）', async () => {
    const { srv, sweep } = make();
    const a = await new Conn(srv, '阿福').hello();
    const code = await a.create({ ...SET, gameMode: 'blackjack-21' });
    a.send({ t: 'addAI', personality: 'smartCat', difficulty: 'easy' });
    await until(() => a.room?.members.length === 2);
    a.send({ t: 'startGame' });
    await until(() => a.bj?.phase === 'betting');
    a.send({ t: 'bj', cmd: { type: 'bet', amount: 20 }, actionId: 'b1', round: a.bj.round, token: a.bj.token });
    await until(() => a.bj.phase !== 'betting');
    a.drop();
    await until(() => srv.getRoom(code)!.members.find((m) => m.id === a.playerId)?.connected === false);
    later(31 * MIN);
    await sweep();
    expect(srv.getRoom(code)).toBeUndefined();
    srv.dispose();
  });

  it('LT-08 比赛结束：30 分钟内可以看结果、返回大厅；超过后关闭并告诉在线的玩家原因；结束的房间不接受新玩家', async () => {
    const { srv, sweep } = make();
    const host = await new Conn(srv, '阿福').hello();
    const code = await host.create();
    host.send({ t: 'addAI', personality: 'smartCat', difficulty: 'easy' });
    await until(() => host.room?.members.length === 2);
    await (srv as any).mutate(code, null, (tx: any) => ((tx.room.status = 'finished'), (tx.room.finishedAt = Date.now()), (tx.room.game = null), tx.touch()));
    await until(() => host.room.status === 'finished');
    const other = await new Conn(srv, '路人').hello();
    other.send({ t: 'joinRoom', code });
    await until(() => other.errors().length > 0);
    expect(other.errors()[0]).toContain('已经结束');
    later(29 * MIN);
    await sweep();
    expect(srv.getRoom(code)).toBeTruthy();
    later(2 * MIN);
    await sweep();
    await until(() => host.room === null);
    expect(host.errors().at(-1)).toContain('已关闭');
    srv.dispose();
  });

  it('LT-09 大厅超过 2 小时还没开始：在线的人收到原因并回到在线页面；之后用房间代码加入被拒绝', async () => {
    const { srv, sweep } = make();
    const host = await new Conn(srv, '阿福').hello();
    const code = await host.create();
    later(119 * MIN);
    await sweep();
    expect(srv.getRoom(code)).toBeTruthy();
    // 到期了但清理还没来得及运行：加入也会被拒绝
    later(2 * MIN);
    const late = await new Conn(srv, '迟到').hello();
    late.send({ t: 'joinRoom', code });
    await until(() => late.errors().length > 0);
    expect(late.errors()[0]).toContain('已过期');
    await sweep();
    await until(() => host.room === null);
    expect(host.errors().at(-1)).toContain('等待太久');
    srv.dispose();
  });

  it('LT-10 返回大厅会重新计算等待时间；开始游戏后不再计算', async () => {
    const { srv } = make();
    const host = await new Conn(srv, '阿福').hello();
    const code = await host.create();
    host.send({ t: 'addAI', personality: 'smartCat', difficulty: 'easy' });
    await until(() => host.room?.members.length === 2);
    const first = host.room.expiresAt;
    later(90 * MIN);
    host.send({ t: 'startGame' });
    await until(() => host.room.status === 'playing');
    expect(host.room.expiresAt).toBeNull();
    await (srv as any).mutate(code, null, (tx: any) => ((tx.room.status = 'finished'), (tx.room.finishedAt = Date.now()), tx.touch()));
    await until(() => host.room.status === 'finished');
    host.send({ t: 'backToLobby' });
    await until(() => host.room.status === 'lobby');
    expect(host.room.expiresAt).toBeGreaterThan(first + 89 * MIN);
    srv.dispose();
  });

  it('LT-11 关闭后不留下任何东西：房间缓存、计时器、共享存储记录、会话都清空', async () => {
    const { srv, hub, sweep } = make();
    const a = await new Conn(srv, '阿福').hello();
    const code = await a.create({ ...SET, gameMode: 'blackjack-21' });
    a.send({ t: 'addAI', personality: 'smartCat', difficulty: 'easy' });
    await until(() => a.room?.members.length === 2);
    a.send({ t: 'startGame' });
    await until(() => a.bj?.phase === 'betting');
    a.drop();
    await until(() => srv.getRoom(code)!.members.find((m) => m.id === a.playerId)?.connected === false);
    later(31 * MIN);
    await sweep();
    await wait(50);
    expect((srv as any).cache.has(code)).toBe(false);
    expect((srv as any).wake.has(code)).toBe(false);
    expect((srv as any).sessions.size).toBe(0);
    expect(hub.rooms.has(code)).toBe(false);
    srv.dispose();
  });

  it('LT-12 旧版本的房间记录（没有生命周期字段）：第一次修改时开始计时，不会马上过期', async () => {
    const { srv, sweep } = make();
    const a = await new Conn(srv, '阿福').hello();
    const code = await a.create();
    await (srv as any).mutate(code, null, (tx: any) => {
      delete tx.room.createdAt;
      delete tx.room.waitingSince;
      tx.touch();
    });
    const r = srv.getRoom(code)!;
    expect(r.waitingSince).toBeGreaterThan(0);
    later(60 * MIN);
    await sweep();
    expect(srv.getRoom(code)).toBeTruthy();
    srv.dispose();
  });
});

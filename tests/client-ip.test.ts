// 按 IP 限流用的客户端地址：X-Forwarded-For 只在可信代理后面读取，并且取可信代理追加的那一项（审计回归）
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { clientIp, isPrivateAddress } from '../server/clientIp';
import { createServer } from '../server/index';

const req = (remote: string, xff?: string | string[]) => ({ socket: { remoteAddress: remote } as any, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } }) as any;
const PUBLIC = '203.0.113.9';

describe('客户端 IP', () => {
  it('IP-01 直接暴露在公网：不读取 X-Forwarded-For（客户端伪造的地址不能绕过限流）', () => {
    expect(clientIp(req(PUBLIC, '1.2.3.4'), {})).toBe(PUBLIC);
    expect(clientIp(req(PUBLIC, ['1.2.3.4', '5.6.7.8']), {})).toBe(PUBLIC);
    expect(clientIp(req('::ffff:' + PUBLIC, '1.2.3.4'), {})).toBe('::ffff:' + PUBLIC);
  });

  it('IP-02 本机 / 内网的反向代理（Nginx、Caddy）：取代理追加的最后一项，前面客户端自己写的不算', () => {
    expect(clientIp(req('127.0.0.1', '198.51.100.7'), {})).toBe('198.51.100.7');
    expect(clientIp(req('::1', 'fake-1, 198.51.100.7'), {})).toBe('198.51.100.7');
    expect(clientIp(req('10.0.0.5', ['fake', '198.51.100.7']), {})).toBe('198.51.100.7');
    // 代理没有带这个标头：用连接地址
    expect(clientIp(req('127.0.0.1'), {})).toBe('127.0.0.1');
  });

  it('IP-03 Vercel：信任 1 层；APC_TRUST_PROXY 可以指定层数，0 = 永远不读取', () => {
    expect(clientIp(req(PUBLIC, '198.51.100.7'), { VERCEL: '1' })).toBe('198.51.100.7');
    expect(clientIp(req(PUBLIC, 'client, edge'), { APC_TRUST_PROXY: '2' })).toBe('client');
    expect(clientIp(req('127.0.0.1', 'fake'), { APC_TRUST_PROXY: '0' })).toBe('127.0.0.1');
    expect(clientIp(req(PUBLIC, 'x'), { APC_TRUST_PROXY: 'abc' })).toBe(PUBLIC);
  });

  it('IP-04 内网地址判断', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '192.168.0.2', '172.16.0.1', '172.31.255.255', 'fd12::1', 'fe80::1']) expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ['8.8.8.8', '172.32.0.1', '203.0.113.9', '::ffff:8.8.8.8', '2001:db8::1', '']) expect(isPrivateAddress(a), a).toBe(false);
  });
});

describe('连接数限制不能用伪造的 X-Forwarded-For 绕过', () => {
  const saved = process.env.APC_TRUST_PROXY;
  afterEach(() => {
    if (saved === undefined) delete process.env.APC_TRUST_PROXY;
    else process.env.APC_TRUST_PROXY = saved;
  });

  it('IP-05 同一个地址每次换一个假的 X-Forwarded-For：第 3 条连接仍然被拒绝（上限 2）', async () => {
    process.env.APC_TRUST_PROXY = '0'; // 模拟直接暴露在公网（测试的连接都来自本机）
    const srv = await createServer(0, { connLimits: { perIp: 2, perMinute: 100 } });
    const open = (i: number) =>
      new Promise<{ ws: WebSocket; closed: Promise<number> }>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/api/ws`, { headers: { 'x-forwarded-for': `10.9.9.${i}` } });
        const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
        ws.on('open', () => resolve({ ws, closed }));
        ws.on('error', () => undefined);
      });
    try {
      const a = await open(1);
      const b = await open(2);
      const c = await open(3);
      expect(await c.closed).toBe(1013);
      a.ws.close();
      b.ws.close();
    } finally {
      await srv.close();
    }
  });
});

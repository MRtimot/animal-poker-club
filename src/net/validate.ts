// 收到的服务器消息：先检查结构再处理。
// 服务器是自己的，但客户端与服务器可能是不同版本（例如浏览器缓存了旧页面、部署了新服务器），
// 或消息在传输中被截断。结构不对的消息直接丢弃，不能让界面因为一个坏消息崩溃。
import type { ServerMessage } from '../core/protocol';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isArr = Array.isArray;

function validChat(m: unknown): boolean {
  return isObj(m) && isStr(m.id) && isStr(m.from) && isStr(m.text) && isStr(m.kind);
}

function validRoom(r: unknown): boolean {
  if (r === null) return true;
  return isObj(r) && isStr(r.code) && isStr(r.hostId) && isStr(r.status) && isObj(r.settings) && isArr(r.members) && r.members.every((m) => isObj(m) && isStr(m.id));
}

function validView(v: unknown): boolean {
  if (!isObj(v)) return false;
  return (
    isStr(v.viewerId) &&
    isNum(v.handNumber) &&
    isStr(v.phase) &&
    isArr(v.board) &&
    isArr(v.events) &&
    v.events.every((e) => isObj(e) && isStr(e.type) && isNum(e.seq)) &&
    isArr(v.players) &&
    v.players.every((p) => isObj(p) && isStr(p.id) && isNum(p.chips) && isArr(p.hole)) &&
    isNum(v.potTotal) &&
    isNum(v.serverTime)
  );
}

function validBlackjack(v: unknown): boolean {
  if (!isObj(v) || v.kind !== 'blackjack') return false;
  const d = v.dealer;
  return (
    isStr(v.viewerId) &&
    isNum(v.round) &&
    isStr(v.roundId) &&
    isStr(v.phase) &&
    isNum(v.token) &&
    isNum(v.serverTime) &&
    isObj(v.rules) &&
    isObj(d) &&
    isObj(d.profile) &&
    isArr(d.cards) &&
    isArr(v.events) &&
    v.events.every((e) => isObj(e) && isStr(e.type) && isNum(e.seq)) &&
    isArr(v.players) &&
    v.players.every((p) => isObj(p) && isStr(p.id) && isNum(p.balance) && isArr(p.hands) && p.hands.every((h) => isObj(h) && isStr(h.id) && isArr(h.cards)))
  );
}

function validBaccarat(v: unknown): boolean {
  if (!isObj(v) || v.kind !== 'baccarat') return false;
  const h = v.hands;
  return (
    isStr(v.viewerId) &&
    isNum(v.round) &&
    isStr(v.roundId) &&
    isStr(v.phase) &&
    isNum(v.serverTime) &&
    isObj(v.rules) &&
    isObj(v.dealer) &&
    isObj(h) &&
    isObj(h.player) &&
    isObj(h.banker) &&
    isArr(h.player.cards) &&
    isArr(h.banker.cards) &&
    isArr(v.history) &&
    isArr(v.events) &&
    v.events.every((e) => isObj(e) && isStr(e.type) && isNum(e.seq)) &&
    isArr(v.players) &&
    v.players.every((p) => isObj(p) && isStr(p.id) && isNum(p.balance) && isObj(p.bets))
  );
}

/** 解析并检查一条服务器消息；结构不对或未知类型返回 null */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  let msg: unknown;
  if (typeof raw !== 'string') return null;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(msg) || !isStr(msg.t)) return null;
  const m = msg;
  switch (m.t) {
    case 'welcome':
      return isStr(m.sessionId) && isStr(m.playerId) ? (m as unknown as ServerMessage) : null;
    case 'ack':
      return isStr(m.actionId) && typeof m.ok === 'boolean' ? (m as unknown as ServerMessage) : null;
    case 'notice':
    case 'error':
      return isStr(m.message) ? (m as unknown as ServerMessage) : null;
    case 'room':
      return 'room' in m && validRoom(m.room) ? (m as unknown as ServerMessage) : null;
    case 'state':
      return validView(m.view) ? (m as unknown as ServerMessage) : null;
    case 'bjState':
      return validBlackjack(m.view) ? (m as unknown as ServerMessage) : null;
    case 'bacState':
      return validBaccarat(m.view) ? (m as unknown as ServerMessage) : null;
    case 'chat':
      return validChat(m.message) ? (m as unknown as ServerMessage) : null;
    case 'chatHistory':
      return isArr(m.messages) && m.messages.every(validChat) ? (m as unknown as ServerMessage) : null;
    case 'pong':
      return isNum(m.time) ? (m as unknown as ServerMessage) : null;
    case 'account':
      return m.state === null || isObj(m.state) ? (m as unknown as ServerMessage) : null;
    case 'progress':
      return isObj(m.event) && isObj(m.state) ? (m as unknown as ServerMessage) : null;
    default:
      return null;
  }
}

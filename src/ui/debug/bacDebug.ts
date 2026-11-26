// 开发 / 调试面板的百家乐部分（只读）：本局状态、核对结果。正式版里只有 ?debug=1 时显示基本状态，核对与强制结果只在开发模式。
import { duplicateCards, validCard } from '../../core/blackjack/audit';
import { expectedCardCounts, expectedReturns } from '../../core/baccarat/audit';
import { betTotal } from '../../core/baccarat/rules';
import type { BaccaratView } from '../../core/baccarat/types';
import { baccaratRates, type BaccaratStats } from '../../progress/baccaratStats';

const ok = (problem: string | null | false) => (problem ? `✗ ${problem}` : '✓');

export function bacRows(v: BaccaratView, online: boolean, cine: string): [string, string][] {
  const me = v.players.find((p) => p.id === v.viewerId);
  const last = v.events[v.events.length - 1];
  return [
    ['Mode', `BACCARAT (${v.economy}${v.solo ? ', solo' : ''})`],
    ['Round', `#${v.round} ${v.roundId}`],
    ['Phase', v.phase],
    ['Player / Banker', `${v.hands.player.score} (${v.hands.player.cards.length}) / ${v.hands.banker.score} (${v.hands.banker.cards.length})`],
    ['Shoe', `${v.shoe.shoeId} · ${v.shoe.remaining}/${v.shoe.size} · ${v.shoe.decks} decks`],
    ['Bets P/B/T', me ? `${me.bets.player} / ${me.bets.banker} / ${me.bets.tie}${me.placed ? ' (locked)' : ''}` : '—'],
    ['Betting timer', v.turnDeadline ? `${Math.max(0, Math.round((v.turnDeadline - v.serverTime) / 1000))}s` : '—'],
    ['Event seq', last ? String(last.seq) : '—'],
    ['Authority', online ? 'server' : 'local controller'],
    ['Cinematic', cine],
  ];
}

export function bacFairnessRows(v: BaccaratView, s: BaccaratStats): [string, string][] {
  const cards = [...v.hands.player.cards, ...v.hands.banker.cards];
  const dup = duplicateCards(cards.map((c) => c.uid));
  const bad = cards.filter((c) => !validCard(c));
  let rule: string | null = null;
  let pay: string | null = null;
  if (v.result) {
    const want = expectedCardCounts(v.hands.player.cards, v.hands.banker.cards);
    if (want.player !== v.hands.player.cards.length || want.banker !== v.hands.banker.cards.length) rule = `应为 闲 ${want.player} / 庄 ${want.banker} 张`;
    for (const p of v.players) {
      if (!p.returns) continue;
      const exp = expectedReturns(p.bets, v.result.winner);
      if (betTotal(exp) !== betTotal(p.returns)) pay = `${p.name} 应返还 ${betTotal(exp)}`;
    }
  }
  const r = baccaratRates(s);
  return [
    ['— FAIRNESS —', 'dev only'],
    ['RNG', typeof globalThis.crypto?.getRandomValues === 'function' ? 'crypto.getRandomValues · Fisher–Yates · 8-deck shoe' : '✗ no secure RNG'],
    ['Record', `${s.rounds} rounds · P ${s.playerResults} / B ${s.bankerResults} / T ${s.tieResults}`],
    ['Rates', `win ${r.winRate} · P-bet ${r.playerBetWinRate} · B-bet ${r.bankerBetWinRate} · T-bet ${r.tieBetWinRate} · net ${r.profit}`],
    ['Duplicate cards', ok(dup.length > 0 && dup.join(','))],
    ['Invalid cards', ok(bad.length > 0 && bad.map((c) => c.uid).join(','))],
    ['Third-card rule', v.result ? ok(rule) : 'after result'],
    ['Payout check', v.result ? ok(pay) : 'after result'],
  ];
}

// 开发模式的 21 点公平性调试（只读）：核对眼前这一局的牌、赔付与庄家动作，并显示本机统计。
// 正式版不显示；这里的数字只是结果，从不参与发牌。
import { dealerRuleProblem, duplicateCards, expectedPayout, expectedResult, validCard } from '../../core/blackjack/audit';
import type { BjCard } from '../../core/blackjack/shoe';
import type { BlackjackView } from '../../core/blackjack/types';
import { blackjackRates, type BlackjackStats } from '../../progress/blackjackStats';

const ok = (problem: string | null | false) => (problem ? `✗ ${problem}` : '✓');

export function fairnessRows(v: BlackjackView, s: BlackjackStats): [string, string][] {
  const seen: BjCard[] = [...v.dealer.cards.filter((c): c is BjCard => c !== null), ...v.players.flatMap((p) => p.hands.flatMap((h) => h.cards))];
  const dup = duplicateCards(seen.map((c) => c.uid));
  const bad = seen.filter((c) => !validCard(c));
  const settled = v.phase === 'round-end' && v.dealer.revealed;
  const dealer = v.dealer.cards.filter((c): c is BjCard => c !== null);
  let payout: string | null = null;
  let dealerRule: string | null = null;
  if (settled) {
    for (const p of v.players)
      for (const h of p.hands) {
        if (h.result === 'forfeit') continue;
        const want = expectedResult(h.cards, h.fromSplit, dealer);
        if (h.result !== want || h.payout !== expectedPayout(h.bet, want)) payout = `${p.name} 应为 ${want} ${expectedPayout(h.bet, want)}`;
      }
    const live = v.players.some((p) => p.hands.some((h) => h.result !== 'forfeit' && !h.bust && !h.blackjack));
    dealerRule = dealerRuleProblem(dealer, live);
  }
  const r = blackjackRates(s);
  const avg = (n: number) => (s.rounds ? Math.round(n / s.rounds).toLocaleString() : '—');
  return [
    ['— FAIRNESS —', 'dev only'],
    ['Deck', `1 × 52 per round · remaining ${v.shoe.remaining}/${v.shoe.size}`],
    ['RNG', typeof globalThis.crypto?.getRandomValues === 'function' ? 'crypto.getRandomValues · Fisher–Yates' : '✗ no secure RNG'],
    ['Record', `${s.rounds} rounds · W ${s.wins} / L ${s.losses} / P ${s.pushes}`],
    ['Rates', `win ${r.winRate} · push ${r.pushRate} · BJ ${r.blackjackRate} · bust ${r.bustRate} · dealer bust ${r.dealerBustRate}`],
    ['Avg bet / payout', `${avg(s.totalBet)} / ${avg(s.totalPayout)} · net ${r.profit.toLocaleString()}`],
    ['Duplicate cards', ok(dup.length > 0 && dup.join(','))],
    ['Invalid cards', ok(bad.length > 0 && bad.map((c) => c.uid).join(','))],
    ['Payout check', settled ? ok(payout) : 'after reveal'],
    ['Dealer rule', settled ? ok(dealerRule) : 'after reveal'],
  ];
}

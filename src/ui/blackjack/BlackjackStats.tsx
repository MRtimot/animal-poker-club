// 21 点统计（收藏页与玩家档案共用）
import { blackjackRates, type BlackjackStats as Stats } from '../../progress/blackjackStats';
import { formatChips } from '../../utils/format';

export function BlackjackStatsGrid({ s }: { s: Stats }) {
  const r = blackjackRates(s);
  const grid: [string, string | number][] = [
    ['局数', s.rounds],
    ['赢', s.wins],
    ['输', s.losses],
    ['平局', s.pushes],
    ['胜率（不含平局）', r.winRate],
    ['平局率', r.pushRate],
    ['黑杰克', `${s.blackjacks}（${r.blackjackRate}）`],
    ['爆牌', `${s.busts}（${r.bustRate}）`],
    ['庄家爆牌', `${s.dealerBusts}（${r.dealerBustRate}）`],
    ['净输赢', `${r.profit > 0 ? '+' : r.profit < 0 ? '−' : ''}${formatChips(Math.abs(r.profit))}`],
    ['加倍', s.doubleDowns],
    ['分牌', s.splits],
    ['最高连胜', s.bestWinStreak],
    ['单局最高赢取', formatChips(s.largestWin)],
    ['单局最高下注', formatChips(s.largestBet)],
  ];
  return (
    <>
      <h3 style={{ margin: '4px 0 10px' }}>♠ BLACKJACK 21</h3>
      <div className="stat-grid" style={{ marginBottom: 18 }}>
        {grid.map(([k, v]) => (
          <div className="stat" key={k}>
            <b>{v}</b>
            <span>{k}</span>
          </div>
        ))}
      </div>
    </>
  );
}

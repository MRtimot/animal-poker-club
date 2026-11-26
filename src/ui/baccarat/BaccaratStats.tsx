// 百家乐统计（收藏页与玩家档案共用）：全部来自真实结算结果
import { baccaratRates, type BaccaratStats as Stats } from '../../progress/baccaratStats';
import { formatChips } from '../../utils/format';

export function BaccaratStatsGrid({ s }: { s: Stats }) {
  const r = baccaratRates(s);
  const grid: [string, string | number][] = [
    ['局数', s.rounds],
    ['胜率（不含平）', r.winRate],
    ['押闲胜率', `${r.playerBetWinRate}（${s.playerBets} 次）`],
    ['押庄胜率', `${r.bankerBetWinRate}（${s.bankerBets} 次）`],
    ['押和命中', `${r.tieBetWinRate}（${s.tieBets} 次）`],
    ['开出：闲 / 庄 / 和', `${s.playerResults} / ${s.bankerResults} / ${s.tieResults}`],
    ['例牌', s.naturals],
    ['净输赢', `${r.profit > 0 ? '+' : r.profit < 0 ? '−' : ''}${formatChips(Math.abs(r.profit))}`],
    ['单局最高赢取', formatChips(s.largestWin)],
    ['单局最高下注', formatChips(s.largestBet)],
    ['最高连胜', s.bestWinStreak],
  ];
  return (
    <>
      <h3 style={{ margin: '4px 0 10px' }}>♦ BACCARAT</h3>
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

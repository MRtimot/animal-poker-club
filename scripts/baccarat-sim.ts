// 百家乐公平性模拟（开发用，不进入游戏）：npm run sim:baccarat -- 100000
// 使用真正的引擎与加密安全随机数；发现任何问题或明显的分布偏差时以非零状态退出。
import { BAC_CHI_LIMIT, formatBacReport, simulateBaccarat } from '../src/core/baccarat/simulate';

const rounds = Math.max(1, Number(process.argv[2] ?? 100_000) || 100_000);
const t = Date.now();
const r = simulateBaccarat({ rounds });
console.log(formatBacReport(r));
console.log(`用时 ${((Date.now() - t) / 1000).toFixed(1)} 秒`);
const skew = r.chiRank > BAC_CHI_LIMIT.rank || r.chiSuit > BAC_CHI_LIMIT.suit;
if (skew) console.log('⚠️ 分布偏差超过临界值（p = 0.001）。随机系统偶尔也会出现，请再跑一次确认是否持续出现。');
process.exit(r.problemCount || skew ? 1 : 0);

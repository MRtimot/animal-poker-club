// 21 点公平性模拟（开发用，不进入游戏）：npm run sim:blackjack -- 100000 [玩家数]
// 使用真正的引擎与加密安全随机数；发现任何问题或明显的分布偏差时以非零状态退出。
import { CHI_LIMIT, formatReport, simulate } from '../src/core/blackjack/simulate';

const rounds = Math.max(1, Number(process.argv[2] ?? 100_000) || 100_000);
const players = Number(process.argv[3] ?? 1) || 1;
const t = Date.now();
const r = simulate({ rounds, players });
console.log(formatReport(r));
console.log(`用时 ${((Date.now() - t) / 1000).toFixed(1)} 秒`);
const skew = r.chiRank > CHI_LIMIT.rank || r.chiSuit > CHI_LIMIT.suit || r.chiUpCard > CHI_LIMIT.upCard;
if (skew) console.log('⚠️ 分布偏差超过临界值（p = 0.001）。随机系统偶尔也会出现，请再跑一次确认是否持续出现。');
process.exit(r.problemCount || skew ? 1 : 0);

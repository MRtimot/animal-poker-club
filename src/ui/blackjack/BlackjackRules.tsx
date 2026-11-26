// 21 点规则说明（按这张牌桌实际生效的规则显示）
import type { BlackjackRules as Rules } from '../../core/blackjack/rules';
import { DEFAULT_RULES } from '../../core/blackjack/rules';
import { parseCards } from '../../core/cards/card';
import { Btn, MiniCard, Modal } from '../common/ui';

const EXAMPLES: [string, string, string][] = [
  ['黑杰克', '最初两张：A + 10 / J / Q / K', 'As Kh'],
  ['软 17', 'A 当 11；再来一张也不会爆', 'Ah 6d'],
  ['硬 17', 'A 只能当 1', 'As 6d Tc'],
  ['普通 21', '三张以上凑成 21，不是黑杰克', '7s 7h 7d'],
  ['爆牌', '超过 21，立刻输掉这一手', 'Kc 8d 5s'],
];

export function BlackjackRulesModal({ rules = DEFAULT_RULES, onClose }: { rules?: Rules; onClose: () => void }) {
  return (
    <Modal title="📖 21 点规则" onClose={onClose} width={640} actions={<Btn onClick={onClose}>我知道了</Btn>}>
      <div className="small" style={{ lineHeight: 1.8 }}>
        <p>
          目标：比<b className="gold">庄家</b>更接近 <b className="gold">21 点</b>，但不能超过。你只和庄家比，不和其他玩家比。
        </p>
        <p>
          2~10 按牌面，J / Q / K 算 10，A 自动算 1 或 11。<b>要牌</b>再拿一张；<b>停牌</b>结束这一手；<b>加倍</b>只限最初两张牌，下注翻倍、只再拿一张；<b>分牌</b>把最初两张牌面相同的牌（例如 8 + 8、K + K；10 + K 不行）分成两手，各自下注，只能分一次，分牌后不能加倍（分 A 每手只补一张，补成 21 不算黑杰克）。
        </p>
        <p>
          庄家没有选择：不足 17 必须要牌，17 点及以上（含软 17）一律停牌。庄家明牌是 A 或 10 点时会先看暗牌，已经是黑杰克就直接翻开。
        </p>
        <p>
          赔付：赢 1:1，黑杰克 {rules.blackjackPayout[0]}:{rules.blackjackPayout[1]}，平局退回下注。每一局都换一副新的 52 张牌，用加密安全随机数洗牌。本桌限额 {rules.minBet}–{rules.maxBet}。
        </p>
        <p className="muted">没有保险（Insurance）。庄家的性格只影响台词和动作，不影响牌。只使用虚拟筹码，没有任何真钱交易。</p>
      </div>
      <table className="rules-table">
        <tbody>
          {EXAMPLES.map(([name, desc, cards]) => (
            <tr key={name}>
              <td style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{name}</td>
              <td className="muted">{desc}</td>
              <td>
                <div className="rules-cards">
                  {parseCards(cards).map((c) => (
                    <MiniCard key={c.id} card={c} />
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

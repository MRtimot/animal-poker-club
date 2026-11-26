// 百家乐规则说明（按这张牌桌实际生效的规则显示；赔率与抽水公开显示，不隐藏）
import type { BaccaratRules } from '../../core/baccarat/rules';
import { DEFAULT_BAC_RULES } from '../../core/baccarat/rules';
import { parseCards } from '../../core/cards/card';
import { Btn, MiniCard, Modal } from '../common/ui';

const EXAMPLES: [string, string, string][] = [
  ['点数', 'A = 1，2–9 按牌面，10 / J / Q / K = 0，只看个位：7 + 8 = 5', '7s 8h'],
  ['例牌', '最初两张 8 或 9：双方都不再补牌', '4d 5c'],
  ['闲补牌', '闲家前两张 0–5 补第三张，6–7 停', '2s 3h 9c'],
  ['和局', '双方点数一样', '6d Kh'],
];

const BANKER_TABLE: [string, string][] = [
  ['0–2', '补牌'],
  ['3', '闲第三张不是 8 就补'],
  ['4', '闲第三张是 2–7 补'],
  ['5', '闲第三张是 4–7 补'],
  ['6', '闲第三张是 6–7 补'],
  ['7', '停牌'],
];

export function BaccaratRulesModal({ rules = DEFAULT_BAC_RULES, onClose }: { rules?: BaccaratRules; onClose: () => void }) {
  return (
    <Modal title="📖 百家乐规则" onClose={onClose} width={660} actions={<Btn onClick={onClose}>我知道了</Btn>}>
      <div className="small" style={{ lineHeight: 1.8 }}>
        <p>
          押<b className="gold">闲</b>、<b className="gold">庄</b>或<b className="gold">和</b>，猜哪一方的点数更接近 9。补不补牌完全由规则决定，没有人可以选择要牌或停牌。
        </p>
        <p>
          赔率：<b>闲 1:1</b> · <b>庄 1:1（盈利抽 {rules.bankerCommissionPct}%，向下取整）</b> · <b>和 {rules.tiePays}:1</b>。开和局时押闲 / 庄的下注退回。每个区 {rules.minBet}–{rules.maxBet}。
        </p>
        <p>
          庄家补牌：闲没补第三张时，庄 0–5 补、6–7 停；闲补了第三张时按下表。牌靴 {rules.decks} 副牌，剩 {rules.reshuffleAt} 张时在下一局前换新牌靴（一局中途不洗牌）。
        </p>
        <p className="muted">
          每一局都是独立的：最近的结果只是记录，不能用来预测下一局。动物庄家的性格只影响台词和动作；外观（牌桌、牌、筹码）只是画面，不影响牌或赔付。只使用虚拟筹码，没有任何真钱交易。
        </p>
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
      <table className="rules-table" style={{ marginTop: 10 }}>
        <tbody>
          <tr>
            <td style={{ fontWeight: 800 }}>庄家前两张</td>
            <td style={{ fontWeight: 800 }}>闲补了第三张时</td>
          </tr>
          {BANKER_TABLE.map(([t, r]) => (
            <tr key={t}>
              <td>{t}</td>
              <td className="muted">{r}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

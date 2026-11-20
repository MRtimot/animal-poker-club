import { parseCards } from '../../core/cards/card';
import { Btn, MiniCard, Modal } from './ui';

const RANKINGS: [string, string, string][] = [
  ['皇家同花顺', '同一花色的 10、J、Q、K、A', 'Ah Kh Qh Jh Th'],
  ['同花顺', '同一花色的五张连续牌', '9s 8s 7s 6s 5s'],
  ['四条', '四张相同点数的牌', 'Qs Qh Qd Qc 3s'],
  ['葫芦', '三条 + 一对', 'Ks Kh Kd 4c 4s'],
  ['同花', '五张同一花色的牌', 'Ad Jd 8d 5d 2d'],
  ['顺子', '五张点数连续的牌（花色不限）', 'Ts 9h 8d 7c 6s'],
  ['三条', '三张相同点数的牌', '7s 7h 7d Kc 2s'],
  ['两对', '两组对子', 'Js Jh 5d 5c As'],
  ['一对', '两张相同点数的牌', 'As Ah 9d 6c 3s'],
  ['高牌', '以上皆不是，比最大的单张', 'Ks Jh 8d 5c 2s'],
];

export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="📖 德州扑克规则" onClose={onClose} width={640} actions={<Btn onClick={onClose}>我知道了</Btn>}>
      <div className="small" style={{ lineHeight: 1.8 }}>
        <p>
          每位玩家获得 <b className="gold">2 张底牌</b>，桌面中央依次发出 <b className="gold">5 张公共牌</b>（翻牌 3 张、转牌 1 张、河牌 1 张）。用底牌与公共牌中任意 5 张组成最大的牌型。
        </p>
        <p>
          每一轮可以选择：<b>弃牌</b>（放弃本局）、<b>过牌</b>（无人下注时不加钱）、<b>跟注</b>（补齐当前下注）、<b>加注</b>（提高下注）、<b>全押</b>（押上全部筹码）。
        </p>
        <p>
          庄家左边两位分别下 <b>小盲注</b> 与 <b>大盲注</b>。全押的玩家只能赢取自己参与的底池，多出的部分形成 <b>边池</b>。最后留在牌桌上的动物就是今天的 <b className="gold">扑克王</b>！
        </p>
        <p className="muted">本游戏仅使用虚拟筹码，不涉及任何真实货币。</p>
      </div>
      <h3 style={{ margin: '14px 0 8px' }}>牌型大小（从大到小）</h3>
      <table className="rules-table">
        <tbody>
          {RANKINGS.map(([name, desc, cards], i) => (
            <tr key={name}>
              <td style={{ width: 28 }} className="gold">
                {i + 1}
              </td>
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

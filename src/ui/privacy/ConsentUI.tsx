// Cookie 与本机存储：电脑版底部的说明条 + 设置面板。
// 说明条不遮挡游戏（牌局中不显示），做出选择后不再出现；之后可以在首页页脚或设置里重新打开。
import { useEffect, useState } from 'react';
import { saveConsent, useConsent } from '../../privacy/consent';
import { useGame } from '../../store/gameStore';
import { useIsPC } from '../../utils/pc';
import { Btn, Modal } from '../common/ui';
import { useGameNoticeOpen } from '../notice/GameNotice';

const ESSENTIAL: [string, string][] = [
  ['登录会话（Cookie：apc_sid、apc_nonce）', '只在使用账号登录时设置；HttpOnly，网页脚本读不到。用于保持登录。'],
  ['在线房间（本标签页：apc-session、apc-last-room）', '刷新页面或断线后回到原来的座位。关闭标签页后自动清除。'],
  ['游戏存档（apc-profile）', '游客的等级、经验、动物、角色与成就，只保存在这台电脑上。'],
  ['账号离线缓存（apc-account-cache、apc-account-outbox）', '登录玩家在网络断开时查看资料、恢复网络后补发修改。'],
  ['你的选择（apc-consent、apc-guest-ok）', '记住这里的设置，以及你选择以游客身份游玩。'],
  ['游戏说明（apc-game-notice）', '记住你已经看过“虚拟娱乐游戏”说明，之后不再重复显示。'],
];

function ConsentBanner() {
  const open = useConsent((s) => s.openSettings);
  return (
    <section className="consent-bar" role="region" aria-label="Cookie 与本机存储">
      <div className="consent-text">
        <b>Cookie 与本机存储</b>
        <span>
          我们只使用让游戏正常运行所必需的存储（登录、断线重连、游戏存档），<strong>不使用任何分析或广告追踪</strong>。
          画质、音量等偏好设置也会保存在这台电脑上，你可以选择不保存。
        </span>
      </div>
      <div className="consent-actions">
        <button type="button" className="consent-link" onClick={open}>
          管理偏好
        </button>
        <Btn kind="ghost" onClick={() => saveConsent({ preferences: false })}>
          仅必要
        </Btn>
        <Btn onClick={() => saveConsent({ preferences: true })}>全部接受</Btn>
      </div>
    </section>
  );
}

function ConsentSettings() {
  const consent = useConsent((s) => s.consent);
  const close = useConsent((s) => s.closeSettings);
  const [prefs, setPrefs] = useState(consent ? consent.preferences : true);
  useEffect(() => setPrefs(consent ? consent.preferences : true), [consent]);
  return (
    <Modal
      title="Cookie 与本机存储设置"
      onClose={close}
      width={620}
      actions={
        <>
          <Btn kind="ghost" onClick={() => saveConsent({ preferences: false })}>
            仅必要
          </Btn>
          <Btn onClick={() => saveConsent({ preferences: prefs })}>保存设置</Btn>
        </>
      }
    >
      <div className="consent-cats">
        <div className="consent-cat">
          <div className="consent-cat-head">
            <div>
              <b>必要</b>
              <small>游戏正常运行所需，无法关闭</small>
            </div>
            <span className="consent-pill on">始终开启</span>
          </div>
          <ul>
            {ESSENTIAL.map(([k, v]) => (
              <li key={k}>
                <span>{k}</span>
                <small>{v}</small>
              </li>
            ))}
          </ul>
        </div>
        <label className="consent-cat consent-cat-toggle">
          <div className="consent-cat-head">
            <div>
              <b>偏好设置</b>
              <small>画质、音量、镜头、语音、教程完成状态等（apc-settings）。关闭后只在本次打开期间有效，已保存的设置会被删除。</small>
            </div>
            <input type="checkbox" role="switch" checked={prefs} onChange={(e) => setPrefs(e.target.checked)} aria-label="保存偏好设置" />
          </div>
        </label>
        <div className="consent-cat consent-cat-off">
          <div className="consent-cat-head">
            <div>
              <b>分析</b>
              <small>未使用：本游戏不加载任何分析、广告或追踪脚本，也不收集使用统计。</small>
            </div>
            <span className="consent-pill">未使用</span>
          </div>
        </div>
        {consent && <p className="consent-when">上次保存：{new Date(consent.timestamp).toLocaleString('zh-CN')}</p>}
      </div>
    </Modal>
  );
}

/** 挂在应用最外层：电脑版、还没做出选择、不在牌局中时显示说明条；设置面板可从页脚 / 设置页打开 */
export function ConsentLayer() {
  const pc = useIsPC();
  const consent = useConsent((s) => s.consent);
  const settingsOpen = useConsent((s) => s.settingsOpen);
  const screen = useGame((s) => s.screen);
  // 游戏说明显示时先不出现说明条（不叠在一起），点“继续”后再出现
  const noticeOpen = useGameNoticeOpen();
  return (
    <>
      {/* 设置面板打开时说明条留在下面（被遮罩盖住），关闭后焦点能回到“管理偏好”按钮 */}
      {pc && !consent && screen !== 'game' && !noticeOpen && <ConsentBanner />}
      {settingsOpen && <ConsentSettings />}
    </>
  );
}

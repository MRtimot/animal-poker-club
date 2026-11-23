// 全屏相关的界面（只在手机 / 平板出现；电脑版不显示，也不改变电脑版的任何行为）
// 状态与操作全部来自 display/fullscreen.ts，这里只负责显示。
import { useFullscreen, clearDisplayNotice, displayMode, toggle, type MobileDisplayMode } from '../../display/fullscreen';
import { hapticsSupported } from '../../display/haptics';
import { FULLSCREEN_PREF_NAME, type FullscreenPreference, useSettings } from '../../store/settingsStore';
import { useIsPC } from '../../utils/pc';
import { Btn, Seg } from './ui';

function FsIcon({ exit }: { exit: boolean }) {
  // 四个角：进入 = 向外展开，退出 = 向内收拢
  const d = exit
    ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'
    : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5';
  return (
    <svg className="fs-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 牌桌顶栏里的全屏按钮：只在手机 / 平板、且浏览器支持网页全屏时出现 */
export function FullscreenButton({ className = 'gbar-btn' }: { className?: string }) {
  const pc = useIsPC();
  const supported = useFullscreen((s) => s.supported);
  const active = useFullscreen((s) => s.active);
  const standalone = useFullscreen((s) => s.standalone);
  const failed = useFullscreen((s) => s.failed);
  // 不能真正网页全屏（iPhone 浏览器、请求被拒绝、应用模式）时不显示：游戏已经使用沉浸式显示
  if (pc || !supported || (failed && !active) || (standalone && !active)) return null;
  const label = active ? '退出全屏' : '进入全屏';
  return (
    <button type="button" className={`${className} fs-btn${active ? ' on' : ''}`} aria-label={label} title={label} aria-pressed={active} onClick={() => void toggle()}>
      <FsIcon exit={active} />
    </button>
  );
}

/** 进入全屏 / 无法全屏时的短暂提示（1~2 秒后自动淡出，不一直显示） */
export function FullscreenNotice() {
  const notice = useFullscreen((s) => s.notice);
  const pc = useIsPC();
  if (!notice || pc) return null;
  // 不显示任何技术信息：没能全屏时只说明已经使用沉浸式显示
  const text = notice.kind === 'entered' ? '已进入全屏' : '已使用沉浸式显示';
  return (
    <div key={notice.id} className={`fs-notice ${notice.kind}`} role="status" aria-live="polite" onAnimationEnd={() => clearDisplayNotice(notice.id)}>
      <FsIcon exit={false} />
      <span>{text}</span>
    </div>
  );
}

/** 设置里的“显示”部分（手机 / 平板）：全屏偏好、立即进入 / 退出、触感反馈 */
export function DisplaySettings() {
  const pc = useIsPC();
  const fs = useFullscreen();
  const pref = useSettings((s) => s.fullscreenPreference);
  const haptics = useSettings((s) => s.haptics);
  const set = useSettings((s) => s.set);
  if (pc) return null;
  const mode = displayMode(fs, pref);
  // 这台设备能否真正网页全屏（请求被拒绝过的浏览器本次也按不能处理）
  const native = fs.supported && !fs.failed;
  const status: Record<MobileDisplayMode, string> = {
    'native-fullscreen': '全屏',
    'immersive-fallback': '沉浸式显示',
    'standalone-pwa': '应用模式',
    browser: '普通页面',
  };
  const note =
    mode === 'standalone-pwa'
      ? '已经从主屏幕以应用方式打开，没有浏览器地址栏；是否显示系统状态栏由手机决定。'
      : native
        ? pref === 'auto'
          ? '自动会根据设备能力选择最佳显示方式：点“开始游戏 / 创建房间 / 加入房间”时进入全屏；你自己退出后，本次不会再自动进入。'
          : pref === 'on'
            ? '每次进入游戏时都进入全屏。'
            : '不会自动进入全屏，可以随时手动进入。'
        : pref === 'off'
          ? '不会请求全屏，使用普通页面显示。'
          : '自动会根据设备能力选择最佳显示方式。当前浏览器限制下（例如 iPhone 上的浏览器），游戏会自动使用沉浸式显示：占满可用屏幕，并避开刘海、灵动岛和底部横条。';
  return (
    <>
      <div className="field">
        <label>
          📱 全屏 <span className="fs-status">当前：{status[mode]}</span>
        </label>
        {mode !== 'standalone-pwa' && (
          <Seg
            options={(Object.keys(FULLSCREEN_PREF_NAME) as FullscreenPreference[]).map((v) => ({ value: v, label: FULLSCREEN_PREF_NAME[v] }))}
            value={pref}
            onChange={(v) => set({ fullscreenPreference: v })}
          />
        )}
        <div className="small muted" style={{ marginTop: 6 }}>
          {note}
        </div>
        {/* 只在真正能网页全屏的浏览器上提供“进入全屏”，不让按钮看起来能做到浏览器不允许的事 */}
        {native && mode !== 'standalone-pwa' && (
          <div style={{ marginTop: 8 }}>
            <Btn kind="ghost" size="sm" onClick={() => void toggle()}>
              {fs.active ? '退出全屏' : '现在进入全屏'}
            </Btn>
          </div>
        )}
      </div>
      {hapticsSupported() && (
        <label className="toggle">
          <span>📳 触感反馈（下注、出局时震动）</span>
          <input type="checkbox" checked={haptics} onChange={(e) => set({ haptics: e.target.checked })} />
        </label>
      )}
    </>
  );
}

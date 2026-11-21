import { useState } from 'react';
import { QUALITY_NAME, Quality, ROOM_NAME, RoomTheme, useSettings } from '../../store/settingsStore';
import { useGame } from '../../store/gameStore';
import { useProfile } from '../../store/profileStore';
import { useAccount } from '../../store/accountStore';
import { BackButton, Btn, Modal, Seg } from '../common/ui';
import { net } from '../../net/netClient';

export function QuickSettings() {
  const s = useSettings();
  const slider = (label: string, key: 'musicVolume' | 'sfxVolume' | 'ambientVolume') => (
    <div className="field">
      <label>
        {label}：{Math.round(s[key] * 100)}%
      </label>
      <input className="range" type="range" min={0} max={1} step={0.05} value={s[key]} onChange={(e) => s.set({ [key]: Number(e.target.value) } as any)} />
    </div>
  );
  return (
    <>
      <div className="field">
        <label>扑克房间</label>
        <Seg options={(Object.keys(ROOM_NAME) as RoomTheme[]).map((r) => ({ value: r, label: ROOM_NAME[r] }))} value={s.room} onChange={(r) => s.set({ room: r })} />
        <div className="small muted" style={{ marginTop: 6 }}>
          豪华赌场：木材、皮革与吧台 · 夜景高层：落地窗外的城市夜景 · 森林小屋：壁炉与窗外森林
        </div>
      </div>
      <div className="field">
        <label>画质</label>
        <Seg options={(Object.keys(QUALITY_NAME) as Quality[]).map((q) => ({ value: q, label: QUALITY_NAME[q] }))} value={s.quality} onChange={(q) => s.set({ quality: q, autoQuality: false })} />
        <div className="small muted" style={{ marginTop: 6 }}>
          低：无阴影，适合旧手机 · 中：基础阴影与反射 · 高：柔和阴影 + 灰尘光束 · 极高：高清阴影 + 景深
        </div>
      </div>
      <label className="toggle">
        <span>⚡ 自动画质（帧率不足时自动降低画质）</span>
        <input type="checkbox" checked={s.autoQuality} onChange={(e) => s.set({ autoQuality: e.target.checked })} />
      </label>
      {slider('🎵 背景音乐', 'musicVolume')}
      {slider('🔊 音效', 'sfxVolume')}
      {slider('🌃 环境声音', 'ambientVolume')}
      <label className="toggle">
        <span>🎥 自动镜头（下注、全押、摊牌、获胜时自动移动）</span>
        <input type="checkbox" checked={s.autoCamera} onChange={(e) => s.set({ autoCamera: e.target.checked })} />
      </label>
      <label className="toggle">
        <span>📈 显示帧率（FPS）</span>
        <input type="checkbox" checked={s.showFps} onChange={(e) => s.set({ showFps: e.target.checked })} />
      </label>
    </>
  );
}

export function SettingsScreen() {
  const setScreen = useGame((s) => s.setScreen);
  const toast = useGame((s) => s.toast);
  const serverUrl = useSettings((s) => s.serverUrl);
  const setS = useSettings((s) => s.set);
  const resetAll = useProfile((s) => s.resetAll);
  const signedIn = useAccount((s) => s.status === 'signedIn');
  const [url, setUrl] = useState(serverUrl);
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="screen side-screen">
      <BackButton onClick={() => setScreen('home')} label="首页" />
      <div className="panel side-panel">
        <div className="panel-head">
          <h2 className="grow">⚙️ 设置</h2>
        </div>
        <QuickSettings />
        <div className="field" style={{ marginTop: 10 }}>
          <label>在线服务器地址（留空 = 使用当前网站自带的服务器）</label>
          <div className="row">
            <input className="input" placeholder="例如 ws://192.168.1.8:3001" value={url} onChange={(e) => setUrl(e.target.value)} />
            <Btn
              size="sm"
              onClick={() => {
                setS({ serverUrl: url.trim() });
                net.disconnect();
                setTimeout(() => net.connect(), 100);
                toast('服务器地址已保存', 'success');
              }}
            >
              保存
            </Btn>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          <Btn
            kind="ghost"
            onClick={() => {
              setS({ tutorialDone: false });
              toast('下次进入牌桌时会再次显示新手教程');
            }}
          >
            📘 重新观看新手教程
          </Btn>
          {signedIn ? (
            <Btn kind="ghost" onClick={() => setScreen('profile')}>
              👤 账号与云端存档
            </Btn>
          ) : (
            <Btn kind="red" onClick={() => setConfirm(true)}>
              🗑️ 重置本机游客数据
            </Btn>
          )}
        </div>
        <div className="grow" />
        <p className="small muted" style={{ marginTop: 16, lineHeight: 1.7 }}>
          《动物扑克俱乐部》只使用虚拟筹码，没有充值、提现或任何真钱玩法。{signedIn ? '你的游戏进度保存在云端服务器，设置会自动同步到你的其他设备。' : '游客数据只保存在这台设备的浏览器中，登录后可以保存到云端。'}
          <br />
          创始人：<b className="gold">Timothy Ong</b>（Founder of APEX）
        </p>
      </div>
      {confirm && (
        <Modal
          title="确定要重置吗？"
          onClose={() => setConfirm(false)}
          actions={
            <>
              <Btn kind="ghost" onClick={() => setConfirm(false)}>
                取消
              </Btn>
              <Btn
                kind="red"
                onClick={() => {
                  resetAll();
                  setConfirm(false);
                  toast('所有数据已重置');
                }}
              >
                重置
              </Btn>
            </>
          }
        >
          <p className="muted">等级、经验、成就、统计和保存的角色都会被清除，且无法恢复。</p>
        </Modal>
      )}
    </div>
  );
}

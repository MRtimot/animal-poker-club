// 回到前台后浏览器不允许自动恢复声音（iPhone Safari 常见）：显示一个很轻的“点击继续声音”。
// 点它（或页面任何地方）都会在同一个手势里恢复声音；第一次打开游戏时不显示（那时点任何地方都会开始声音）。
import { useSyncExternalStore } from 'react';
import { sound, type AudioStatus } from '../../audio/sound';
import { useSettings } from '../../store/settingsStore';

export function useAudioStatus(): AudioStatus {
  return useSyncExternalStore(sound.subscribe, sound.getStatus, sound.getStatus);
}

export function AudioResumeHint() {
  const status = useAudioStatus();
  const muted = useSettings((s) => s.muted);
  if (status !== 'locked' || !sound.everReady || muted) return null;
  return (
    <button type="button" className="audio-resume" onClick={() => sound.unlock()}>
      🔊 点击继续声音
    </button>
  );
}

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFx } from '../../store/fxStore';
import { useSettings } from '../../store/settingsStore';
import type { CameraMode } from '../../store/gameStore';
import { SeatLayout, boardPos } from '../layout';
import { DUR, ease, smoothDamp } from '../../animation/motion';
import { prefersReducedMotion } from '../../utils/reducedMotion';

/** 当前镜头焦点（景深使用） */
export const cameraFocus = new THREE.Vector3(0, 1, 0);

const BOARD_CENTER = new THREE.Vector3(boardPos(2)[0], 1.0, boardPos(2)[2]);
const tmpV = new THREE.Vector3();

/** 牌局 HUD 占用的屏幕区域（与 gameHud.css 中的 --hud-top / --hud-bottom 一致） */
export function hudInsets(w: number, h: number): { top: number; bottom: number } {
  if (w <= 760) return { top: 54, bottom: 196 };
  if (w <= 1100 && h > w) return { top: 60, bottom: 210 };
  if (h <= 520 && w >= 600) return { top: 48, bottom: 104 };
  if (w >= 1800 && h >= 1000) return { top: 68, bottom: 150 };
  return { top: 60, bottom: 132 };
}

/**
 * 摄像机系统：普通视角 / 玩家视角 + 自动镜头（行动、全押、摊牌环绕、获胜特写）
 */
export function CameraRig({ mode, layout }: { mode: CameraMode; layout: Map<string, SeatLayout> }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3(0, 1, 0));
  const base = useRef(new THREE.Vector3().copy(camera.position));
  const vel = useRef({ px: { v: 0 }, py: { v: 0 }, pz: { v: 0 }, lx: { v: 0 }, ly: { v: 0 }, lz: { v: 0 } });
  const introStart = useRef(performance.now());
  const tmpPos = useRef(new THREE.Vector3()).current;
  const tmpLook = useRef(new THREE.Vector3()).current;

  // 从自由视角切回：从当前位置平滑过渡
  useEffect(() => {
    base.current.copy(camera.position);
  }, [mode, camera]);

  // 镜头取景避开 HUD：把画面中心移到顶栏与底部操作区之间（镜头位移，不改变透视），离开牌桌时恢复
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const { top, bottom } = hudInsets(size.width, size.height);
    const shift = Math.round((bottom - top) / 2);
    cam.setViewOffset(size.width, size.height, 0, shift, size.width, size.height);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  useEffect(
    () => () => {
      const cam = camera as THREE.PerspectiveCamera;
      cam.clearViewOffset();
      cam.updateProjectionMatrix();
    },
    [camera],
  );

  // 进入牌桌：镜头从高处远处缓慢推进
  useEffect(() => {
    introStart.current = performance.now();
    base.current.set(0, 15, 16);
    look.current.set(0, 0.6, 0);
    camera.position.copy(base.current);
  }, [camera]);

  useFrame((_, dt) => {
    if (mode === 'free') return;
    const aspect = size.width / size.height;
    const portrait = aspect < 0.9;
    const auto = useSettings.getState().autoCamera;
    const calm = prefersReducedMotion();

    // 竖屏（手机）水平视野很窄：加大视场角，保证两侧的动物也在画面内
    const cam = camera as THREE.PerspectiveCamera;
    const wantFov = portrait ? (mode === 'overview' ? 64 : 58) : 45;
    const fovDiff = wantFov - cam.fov;
    if (Math.abs(fovDiff) > 0.01) {
      cam.fov = Math.abs(fovDiff) < 0.1 ? wantFov : cam.fov + fovDiff * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }

    // 基础机位
    if (mode === 'overview') {
      // 默认牌桌镜头：完整的牌桌 + 所有座位与名牌 + 公共牌区 + 一点环境；
      // 视线略微看向远端，越过自己动物的头顶，并给顶栏与底部操作区留出空间
      // 手机横屏（高度很小）：镜头拉远一些，让名牌、牌桌与底部操作区都放得下
      const short = !portrait && size.height < 520;
      const dist = portrait ? 10.8 : short ? 12.2 : aspect < 1.4 ? 11.8 : 10.2;
      const h = portrait ? 13.6 : short ? 13.4 : aspect < 1.4 ? 12.4 : 10.6;
      tmpPos.set(0, h, dist);
      tmpLook.set(0, 0, portrait ? -2.8 : short ? -1.9 : aspect < 1.4 ? -1.2 : -1.5);
    } else {
      // 玩家视角：越过右肩看向牌桌
      tmpPos.set(portrait ? 1.0 : 1.45, portrait ? 5.6 : 3.9, portrait ? 7.4 : 5.6);
      tmpLook.set(0, 1.0, portrait ? 0.4 : 0);
    }

    let speed = 2.2;
    const cue = auto ? useFx.getState().cue : null;
    // 减少动态效果：镜头只做很小的提示性移动，不环绕、不震动
    const amp = calm ? 0.35 : 1;
    if (cue) {
      const t = (performance.now() - cue.start) / 1000;
      const d = cue.duration / 1000;
      if (t > d) {
        useFx.getState().setCue(null);
      } else {
        const seat = cue.playerId ? layout.get(cue.playerId) : undefined;
        const fade = Math.min(1, t / 0.3) * Math.min(1, (d - t) / 0.5) * amp;
        if (cue.type === 'flop' || cue.type === 'turn' || cue.type === 'river') {
          // 公共牌镜头：翻牌关注、转牌靠近、河牌最靠近也最慢（制造期待感）
          const amt = cue.type === 'flop' ? 0.32 : cue.type === 'turn' ? 0.42 : 0.55;
          tmpV.set(0, portrait ? 9.5 : 6.4, portrait ? 6.4 : 4.6);
          tmpPos.lerp(tmpV, fade * amt);
          tmpLook.lerp(BOARD_CENTER, fade * 0.8);
          speed = cue.type === 'river' ? 1.3 : 1.8;
        } else if (cue.type === 'showdown' && !calm) {
          // 镜头慢慢环绕牌桌
          const a = t * 0.35 + 0.2;
          const r = portrait ? 10 : 8.2;
          const orbit = new THREE.Vector3(Math.sin(a) * r * 0.5, portrait ? 8 : 5.2, Math.cos(a) * r);
          tmpPos.lerp(orbit, fade);
          tmpLook.lerp(new THREE.Vector3(0, 1, 0), fade);
          speed = 1.6;
        } else if (seat) {
          const head = new THREE.Vector3(...seat.head);
          const dir = new THREE.Vector3(seat.seat[0], 0, seat.seat[2]).normalize();
          if (cue.type === 'win') {
            const p = head.clone().add(dir.clone().multiplyScalar(-4.2)).add(new THREE.Vector3(0, 0.6, 0));
            tmpPos.lerp(p, fade);
            tmpLook.lerp(head.clone().add(new THREE.Vector3(0, -0.6, 0)), fade);
            speed = 2.4;
          } else if (cue.type === 'allin') {
            // 快速推进，但保留完整的上半身和推出的筹码
            const p = head.clone().add(dir.clone().multiplyScalar(-4.6)).add(new THREE.Vector3(0, 1.1, 0));
            tmpPos.lerp(p, fade * 0.8);
            tmpLook.lerp(head.clone().add(new THREE.Vector3(0, -0.9, 0)), fade * 0.8);
            speed = 2.4; // 全押：镜头慢慢推进
          } else {
            // 行动镜头：轻微靠近
            tmpPos.lerp(head.clone().add(dir.clone().multiplyScalar(-5.5)).add(new THREE.Vector3(0, 1.5, 0)), fade * 0.25);
            tmpLook.lerp(head.clone().add(new THREE.Vector3(0, -0.8, 0)), fade * 0.3);
            speed = 1.8;
          }
        }
      }
    }

    // 开场推进时速度从慢到快
    const ip = Math.min(1, (performance.now() - introStart.current) / DUR.intro);
    if (ip < 1) speed = Math.min(speed, 0.6 + ease.inOutCubic(ip) * 1.8);

    // 带惯性的镜头运动：speed 越大，跟随越快（平滑时间越短）
    const smooth = 1.1 / speed;
    const V = vel.current;
    const d = Math.min(dt, 0.25);
    const b = base.current;
    b.set(smoothDamp(b.x, tmpPos.x, V.px, smooth, d), smoothDamp(b.y, tmpPos.y, V.py, smooth, d), smoothDamp(b.z, tmpPos.z, V.pz, smooth, d));
    const L = look.current;
    L.set(smoothDamp(L.x, tmpLook.x, V.lx, smooth * 0.9, d), smoothDamp(L.y, tmpLook.y, V.ly, smooth * 0.9, d), smoothDamp(L.z, tmpLook.z, V.lz, smooth * 0.9, d));
    camera.position.copy(b);

    // 极轻微的手持感（几乎察觉不到），重大时刻再叠加一次克制的震动（减少动态效果时都关闭）
    const tt = performance.now() / 1000;
    if (!calm) {
      camera.position.x += Math.sin(tt * 0.37) * 0.012;
      camera.position.y += Math.sin(tt * 0.53 + 1) * 0.008;
    }
    const sh = useFx.getState().shake;
    const st = (performance.now() - sh.start) / 1000;
    if (!calm && sh.amp > 0 && st < 0.6) {
      const a = sh.amp * Math.exp(-st * 7);
      camera.position.x += Math.sin(st * 41) * a;
      camera.position.y += Math.sin(st * 33 + 1.3) * a * 0.5;
    }
    cameraFocus.copy(L);
    camera.lookAt(look.current);
  });
  return null;
}

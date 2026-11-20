import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFx } from '../../store/fxStore';
import { useSettings } from '../../store/settingsStore';
import type { CameraMode } from '../../store/gameStore';
import { SeatLayout, boardPos } from '../layout';
import { DUR, ease } from '../../animation/motion';

const BOARD_CENTER = new THREE.Vector3(boardPos(2)[0], 1.0, boardPos(2)[2]);
const tmpV = new THREE.Vector3();

/**
 * 摄像机系统：普通视角 / 玩家视角 + 自动镜头（行动、全押、摊牌环绕、获胜特写）
 */
export function CameraRig({ mode, layout }: { mode: CameraMode; layout: Map<string, SeatLayout> }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3(0, 1, 0));
  const base = useRef(new THREE.Vector3().copy(camera.position));
  const introStart = useRef(performance.now());
  const tmpPos = useRef(new THREE.Vector3()).current;
  const tmpLook = useRef(new THREE.Vector3()).current;

  // 从自由视角切回：从当前位置平滑过渡
  useEffect(() => {
    base.current.copy(camera.position);
  }, [mode, camera]);

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

    // 竖屏（手机）水平视野很窄：加大视场角，保证两侧的动物也在画面内
    const cam = camera as THREE.PerspectiveCamera;
    const wantFov = portrait ? (mode === 'overview' ? 68 : 58) : 45;
    const fovDiff = wantFov - cam.fov;
    if (Math.abs(fovDiff) > 0.01) {
      cam.fov = Math.abs(fovDiff) < 0.1 ? wantFov : cam.fov + fovDiff * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
    }

    // 基础机位
    if (mode === 'overview') {
      // 足够高，让视线越过自己动物的头顶看到自己的手牌
      const dist = portrait ? 7.4 : aspect < 1.4 ? 8.2 : 7.6;
      const h = portrait ? 15.2 : aspect < 1.4 ? 11.2 : 10.4;
      tmpPos.set(0, h, dist);
      tmpLook.set(0, 0, portrait ? 0.9 : 0);
    } else {
      // 玩家视角：越过右肩看向牌桌
      tmpPos.set(portrait ? 1.0 : 1.45, portrait ? 5.6 : 3.9, portrait ? 7.4 : 5.6);
      tmpLook.set(0, 1.0, portrait ? 0.4 : 0);
    }

    let speed = 2.2;
    const cue = auto ? useFx.getState().cue : null;
    if (cue) {
      const t = (performance.now() - cue.start) / 1000;
      const d = cue.duration / 1000;
      if (t > d) {
        useFx.getState().setCue(null);
      } else {
        const seat = cue.playerId ? layout.get(cue.playerId) : undefined;
        const fade = Math.min(1, t / 0.3) * Math.min(1, (d - t) / 0.5);
        if (cue.type === 'flop' || cue.type === 'turn' || cue.type === 'river') {
          // 公共牌镜头：翻牌关注、转牌靠近、河牌最靠近也最慢（制造期待感）
          const amt = cue.type === 'flop' ? 0.32 : cue.type === 'turn' ? 0.42 : 0.55;
          tmpV.set(0, portrait ? 9.5 : 6.4, portrait ? 6.4 : 4.6);
          tmpPos.lerp(tmpV, fade * amt);
          tmpLook.lerp(BOARD_CENTER, fade * 0.8);
          speed = cue.type === 'river' ? 1.3 : 1.8;
        } else if (cue.type === 'showdown') {
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
            speed = 5;
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

    const k = 1 - Math.exp(-speed * dt);
    base.current.lerp(tmpPos, k);
    look.current.lerp(tmpLook, k);
    camera.position.copy(base.current);

    // 镜头震动（全押等重大时刻）：快速衰减
    const sh = useFx.getState().shake;
    const st = (performance.now() - sh.start) / 1000;
    if (sh.amp > 0 && st < 0.7) {
      const a = sh.amp * Math.exp(-st * 6);
      camera.position.x += Math.sin(st * 63) * a;
      camera.position.y += Math.sin(st * 51 + 1.3) * a * 0.6;
      camera.position.z += Math.sin(st * 47 + 2.1) * a * 0.5;
    }
    camera.lookAt(look.current);
  });
  return null;
}

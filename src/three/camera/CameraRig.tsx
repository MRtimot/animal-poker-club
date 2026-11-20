import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useFx } from '../../store/fxStore';
import { useSettings } from '../../store/settingsStore';
import type { CameraMode } from '../../store/gameStore';
import type { SeatLayout } from '../layout';

/**
 * 摄像机系统：普通视角 / 玩家视角 + 自动镜头（行动、全押、摊牌环绕、获胜特写）
 */
export function CameraRig({ mode, layout }: { mode: CameraMode; layout: Map<string, SeatLayout> }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3(0, 1, 0));
  const tmpPos = new THREE.Vector3();
  const tmpLook = new THREE.Vector3();

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
        if (cue.type === 'showdown') {
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
            const p = head.clone().add(dir.clone().multiplyScalar(-3.4)).add(new THREE.Vector3(0, 0.3, 0));
            tmpPos.lerp(p, fade * 0.85);
            tmpLook.lerp(head.clone().add(new THREE.Vector3(0, -0.5, 0)), fade * 0.85);
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

    const k = 1 - Math.exp(-speed * dt);
    camera.position.lerp(tmpPos, k);
    look.current.lerp(tmpLook, k);
    camera.lookAt(look.current);
  });
  return null;
}

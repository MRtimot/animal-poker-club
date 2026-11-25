// 角色入座（德州扑克与 21 点共用）：从桌外走来 → 拉开椅子 → 坐下
import { ReactNode, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SeatLayout } from '../layout';
import { STAGGER, arc, damp, ease, settle } from '../../animation/motion';
import type { Species } from '../../core/player/profile';
import { useFx } from '../../store/fxStore';
import { chairJolt } from '../../animation/defeat/defeatStore';

/** 从某个座位看向另一个座位需要转头的角度（相对于正对牌桌中心） */
export function yawToward(from: SeatLayout, to: SeatLayout): number {
  const fx = -Math.sin(from.angle);
  const fz = -Math.cos(from.angle);
  const rx = -Math.cos(from.angle);
  const rz = Math.sin(from.angle);
  const dx = to.seat[0] - from.seat[0];
  const dz = to.seat[2] - from.seat[2];
  return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
}

const HOP: Partial<Record<Species, boolean>> = { rabbit: true, frog: true, monkey: true };
const HEAVY: Partial<Record<Species, boolean>> = { panda: true, bear: true, koala: true, lion: true };
const ARRIVAL_ANIM: Partial<Record<Species, 'stretch' | 'settle' | 'happy' | 'wave'>> = {
  panda: 'stretch', bear: 'stretch', koala: 'stretch', fox: 'settle', cat: 'settle', rabbit: 'happy', frog: 'happy', monkey: 'wave', dog: 'wave',
};

/**
 * 角色入场：从桌子外侧走（或跳）到座位 → 拉开椅子 → 跳上椅子坐下 → 伸懒腰 / 整理衣服 → 进入待机
 * 熊猫慢慢走、兔子快速蹦过来，重的动物会左右摇摆。
 */
const jAxis = new THREE.Vector3();
const jQuat = new THREE.Quaternion();
const jPivot = new THREE.Vector3();
const jOff = new THREE.Vector3();
const jTmp = new THREE.Vector3();

export function SeatEntrance({ layout, species, playerId, order, chair, children }: {
  layout: SeatLayout;
  species: Species;
  playerId: string;
  order: number;
  chair: ReactNode;
  children: ReactNode;
}) {
  const animal = useRef<THREE.Group>(null!);
  const chairRef = useRef<THREE.Group>(null!);
  const st = useRef({ start: performance.now() + 500 + order * STAGGER.seatEntrance, done: false, chairOff: 0, jPush: 0, jTilt: 0 });
  const hop = !!HOP[species];
  const heavy = !!HEAVY[species];
  const walkMs = hop ? 850 : heavy ? 1750 : 1200;
  const dirX = Math.sin(layout.angle);
  const dirZ = Math.cos(layout.angle);
  useFrame((_, dt) => {
    const s = st.current;
    const a = animal.current;
    const c = chairRef.current;
    if (!a || !c) return;
    const now = performance.now();
    const t = now - s.start;
    const total = walkMs + 420;
    let dist = 0;
    let y = 0;
    let roll = 0;
    let chairWant = 0;
    if (t < 0) {
      a.visible = false;
      chairWant = 0;
    } else if (t < walkMs) {
      a.visible = true;
      const p = t / walkMs;
      dist = 3.2 * (1 - ease.inOutSine(p));
      const steps = hop ? 3 : heavy ? 5 : 6;
      const ph = p * steps * Math.PI;
      y = -0.3 + (hop ? Math.abs(Math.sin(ph)) * 0.38 : Math.abs(Math.sin(ph)) * 0.06);
      roll = heavy ? Math.sin(ph) * 0.09 : Math.sin(ph) * 0.03;
      chairWant = p > 0.45 ? 0.5 : 0; // 快到时拉开椅子
    } else if (t < total) {
      a.visible = true;
      // 跳上椅子
      const p = (t - walkMs) / 420;
      y = -0.3 + 0.3 * ease.outCubic(p) + arc(p, 0.32);
      chairWant = 0.5 * (1 - ease.inOutCubic(p));
    } else {
      a.visible = true;
      y = settle((t - total) / 1000, 0.05, 20, 9);
      if (!s.done) {
        s.done = true;
        const anim = ARRIVAL_ANIM[species] ?? 'settle';
        useFx.getState().play(playerId, anim);
      }
    }
    // 失败演出：输家的椅子被冲击撞得往后滑、向后翘起再落回地面，动物跟着失去平衡（只是画面）
    const dj = chairJolt(playerId, now, heavy);
    const active = dj.push > 0 || dj.tilt > 0;
    s.jPush = active ? dj.push : damp(s.jPush, 0, 5, dt);
    s.jTilt = active ? dj.tilt : damp(s.jTilt, 0, 8, dt);
    s.chairOff = damp(s.chairOff, chairWant, 9, dt);
    a.position.set(dirX * dist, y, dirZ * dist);
    a.rotation.set(0, 0, roll);
    c.position.set(dirX * s.chairOff, 0, dirZ * s.chairOff);
    c.quaternion.identity();
    if (s.jPush > 0.0005 || s.jTilt > 0.0005) {
      // 以椅子后腿着地的位置为支点向后翘
      jAxis.set(dirZ, 0, -dirX);
      jQuat.setFromAxisAngle(jAxis, s.jTilt);
      jPivot.set(layout.seat[0] + dirX * 0.45, 0, layout.seat[2] + dirZ * 0.45);
      jOff.copy(jPivot).applyQuaternion(jQuat).negate().add(jPivot);
      c.quaternion.copy(jQuat);
      c.position.add(jOff).add(jTmp.set(dirX * s.jPush, 0, dirZ * s.jPush));
      a.quaternion.premultiply(jQuat);
      a.position.add(jOff).add(jTmp.set(dirX * s.jPush * 0.85, 0, dirZ * s.jPush * 0.85));
    }
  });
  return (
    <>
      <group ref={chairRef}>{chair}</group>
      <group ref={animal} visible={false}>
        {children}
      </group>
    </>
  );
}

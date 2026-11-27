// 失败演出在各个牌桌场景里共用的部分（德州、21 点、百家乐）：
// · useDefeatLook：其他动物一个接一个转头看向输家；输家看向赢家（处决者）
// · DefeatIsolationLight：从输家头顶打下的冷色聚光，把输家从变暗的房间里孤立出来
// 只读失败演出的状态（animation/defeat），不改变任何牌局状态。
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useDefeat } from '../../animation/defeat/defeatStore';
import { damp } from '../../animation/motion';
import { DEFEAT_ISOLATE } from '../effects/DefeatFX';
import { FACE_DROP } from '../camera/defeatCamera';
import type { SeatLayout } from '../layout';
import { yawToward } from './SeatEntrance';

export function useDefeatLook(id: string, layout: SeatLayout | undefined, all: Map<string, SeatLayout>): { yaw: number; from: number } | null {
  const dseq = useDefeat((s) => s.seq);
  return useMemo(() => {
    if (!dseq || !layout) return null;
    const targetId = id === dseq.loserId ? dseq.winnerId : dseq.loserId;
    const from = id === dseq.loserId ? dseq.at.realize : dseq.lookers[id];
    const t = targetId ? all.get(targetId) : undefined;
    if (!t || from === undefined) return null;
    return { yaw: yawToward(layout, t), from };
  }, [dseq, id, layout, all]);
}

/**
 * 输家头顶的冷色聚光（21 点 / 百家乐使用；德州的同一盏灯与赢家聚光共用）。
 * 一直保持“可见”、只改亮度：显示 / 隐藏灯光会让所有材质重新编译而卡顿。
 */
export function DefeatIsolationLight({ layout }: { layout: Map<string, SeatLayout> }) {
  const light = useRef<THREE.SpotLight>(null!);
  const target = useMemo(() => new THREE.Object3D(), []);
  const level = useRef(0);
  useFrame((_, dt) => {
    const d = useDefeat.getState();
    const loser = d.seq && d.phase && d.phase !== 'recover' ? layout.get(d.seq.loserId) : undefined;
    const want = loser ? (DEFEAT_ISOLATE[d.phase!] ?? 0.05) * (d.seq!.cut === 'short' ? 0.6 : 1) : 0;
    level.current = damp(level.current, want, loser ? 2.4 : 3, dt);
    if (loser) {
      target.position.set(loser.head[0], loser.head[1] - FACE_DROP - 0.2, loser.head[2]);
      light.current.position.set(loser.seat[0] * 0.92, 6.6, loser.seat[2] * 0.92);
    }
    light.current.intensity = level.current < 0.002 ? 0 : level.current * 60;
  });
  return (
    <>
      <primitive object={target} />
      <spotLight ref={light} target={target} angle={0.32} penumbra={0.8} decay={2} color="#dfe6ff" intensity={0} />
    </>
  );
}

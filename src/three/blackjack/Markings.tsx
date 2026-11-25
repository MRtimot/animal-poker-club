// 21 点桌面印记：弧形赔率文字、每个座位的下注圈、牌靴与弃牌盒（复用德州牌桌的压印工艺）
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { BlackjackRules } from '../../core/blackjack/rules';
import { TABLE_Y, type SeatLayout } from '../layout';
import { cardBackTexture } from '../textures';
import { embossDecal } from '../realism';
import { DISCARD_POS, SHOE_POS, handBetPos } from './layout';

const W = 4.6;
const D = 1.5;
const PX = 230;

/** 沿圆弧写字（圆心在庄家一侧，文字朝玩家弯） */
function arcText(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, r: number, font: string, spacing: number) {
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const widths = [...text].map((c) => g.measureText(c).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0);
  let a = total / 2 / r;
  [...text].forEach((c, i) => {
    a -= widths[i] / 2 / r;
    g.save();
    g.translate(cx + Math.sin(a) * -r, cy + Math.cos(a) * r);
    g.rotate(a);
    g.fillText(c, 0, 0);
    g.restore();
    a -= widths[i] / 2 / r;
  });
}

export function BlackjackMarkings({ rules, layout, seats }: { rules: BlackjackRules; layout: Map<string, SeatLayout>; seats: string[] }) {
  const pays = `${rules.blackjackPayout[0]} TO ${rules.blackjackPayout[1]}`;
  const { map, normalMap, mat } = useMemo(() => {
    const w = Math.round(W * PX);
    const h = Math.round(D * PX);
    const d = embossDecal(
      w,
      h,
      (g) => {
        const cx = w / 2;
        const cy = -2.9 * PX;
        const gold = 'rgba(232, 208, 146, 0.62)';
        g.fillStyle = gold;
        arcText(g, `BLACKJACK PAYS ${pays}`, cx, cy, 3.48 * PX, `700 ${Math.round(0.21 * PX)}px Georgia, "Times New Roman", serif`, 0.035 * PX);
        g.fillStyle = 'rgba(226, 210, 170, 0.42)';
        arcText(g, 'DEALER MUST STAND ON ALL 17s', cx, cy, 3.84 * PX, `600 ${Math.round(0.115 * PX)}px Georgia, "Times New Roman", serif`, 0.03 * PX);
        g.strokeStyle = 'rgba(226, 204, 140, 0.3)';
        g.lineWidth = 3;
        for (const r of [3.28, 3.7]) {
          g.beginPath();
          g.arc(cx, cy, r * PX, Math.PI / 2 - 0.56, Math.PI / 2 + 0.56);
          g.stroke();
        }
      },
      1.4,
    );
    const mat = new THREE.MeshStandardMaterial({ map: d.map, normalMap: d.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 });
    return { ...d, mat };
  }, [pays]);
  const { ringGeo, ringMat } = useMemo(
    () => ({
      ringGeo: new THREE.RingGeometry(0.25, 0.268, 48),
      ringMat: new THREE.MeshStandardMaterial({ color: '#e2cc8c', transparent: true, opacity: 0.38, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    }),
    [],
  );
  useEffect(
    () => () => {
      map.dispose();
      normalMap.dispose();
      mat.dispose();
    },
    [map, normalMap, mat],
  );
  useEffect(
    () => () => {
      ringGeo.dispose();
      ringMat.dispose();
    },
    [ringGeo, ringMat],
  );
  return (
    <group>
      <mesh position={[0, TABLE_Y + 0.0015, 0.42]} rotation={[-Math.PI / 2, 0, 0]} material={mat} receiveShadow renderOrder={1}>
        <planeGeometry args={[W, D]} />
      </mesh>
      {seats.map((id) => {
        const l = layout.get(id);
        if (!l) return null;
        const p = handBetPos(l, 0, 1);
        return <mesh key={id} geometry={ringGeo} material={ringMat} position={[p[0], TABLE_Y + 0.002, p[2]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1} />;
      })}
    </group>
  );
}

/** 牌靴（露出下一张牌的牌背）与弃牌盒：黑漆木 + 黄铜，低调 */
export function ShoeAndDiscard({ used }: { used: number }) {
  const back = useMemo(() => cardBackTexture(), []);
  // 弃牌越来越厚（最多半盒）
  const h = 0.02 + Math.min(1, used) * 0.22;
  return (
    <group>
      <group position={[SHOE_POS[0], TABLE_Y, SHOE_POS[2]]} rotation={[0, -0.5, 0]}>
        <mesh castShadow receiveShadow position={[0, 0.17, -0.12]}>
          <boxGeometry args={[0.66, 0.34, 0.95]} />
          <meshStandardMaterial color="#17120f" roughness={0.28} metalness={0.15} />
        </mesh>
        <mesh castShadow position={[0, 0.15, 0.38]} rotation={[-0.55, 0, 0]}>
          <boxGeometry args={[0.6, 0.03, 0.34]} />
          <meshStandardMaterial color="#221a15" roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.172, 0.385]} rotation={[-0.55 - Math.PI / 2 + Math.PI, 0, 0]}>
          <planeGeometry args={[0.5, 0.3]} />
          <meshStandardMaterial map={back} roughness={0.45} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.345, -0.12]}>
          <boxGeometry args={[0.68, 0.012, 0.97]} />
          <meshStandardMaterial color="#b8924a" roughness={0.35} metalness={0.8} />
        </mesh>
      </group>
      <group position={[DISCARD_POS[0], TABLE_Y, DISCARD_POS[2]]} rotation={[0, 0.5, 0]}>
        <mesh receiveShadow position={[0, 0.012, 0]}>
          <boxGeometry args={[0.66, 0.024, 0.86]} />
          <meshStandardMaterial color="#17120f" roughness={0.3} metalness={0.15} />
        </mesh>
        {[-0.33, 0.33].map((x) => (
          <mesh key={x} castShadow position={[x, 0.1, 0]}>
            <boxGeometry args={[0.02, 0.2, 0.86]} />
            <meshStandardMaterial color="#b8924a" roughness={0.35} metalness={0.8} />
          </mesh>
        ))}
        <mesh castShadow position={[0, 0.024 + h / 2, 0]}>
          <boxGeometry args={[0.5, h, 0.7]} />
          <meshStandardMaterial attach="material-0" color="#efe8d8" />
          <meshStandardMaterial attach="material-1" color="#efe8d8" />
          <meshStandardMaterial attach="material-2" map={back} />
          <meshStandardMaterial attach="material-3" color="#efe8d8" />
          <meshStandardMaterial attach="material-4" color="#efe8d8" />
          <meshStandardMaterial attach="material-5" color="#efe8d8" />
        </mesh>
      </group>
    </group>
  );
}

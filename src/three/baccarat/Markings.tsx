// 百家乐桌面印记：闲 / 庄两个牌框、和局赔率、弧形赔率说明、每个座位的闲 / 和 / 庄下注圈（复用德州牌桌的压印工艺）。
// 颜色跟随牌桌主题（纯外观）。
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { BaccaratRules } from '../../core/baccarat/rules';
import { TABLE_Y, type SeatLayout } from '../layout';
import { embossDecal } from '../realism';
import { HAND_X, HAND_Z, bacSpotPos } from './layout';

const W = 4.8;
const D = 4.2;
const PX = 210;

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

/** 圆角矩形路径（不用 ctx.roundRect：较旧的 Safari 没有） */
function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function BaccaratMarkings({ rules, layout, seats, accent }: { rules: BaccaratRules; layout: Map<string, SeatLayout>; seats: string[]; accent: string }) {
  const { map, normalMap, mat } = useMemo(() => {
    const w = Math.round(W * PX);
    const h = Math.round(D * PX);
    // 画布中心对应桌面 (0, z0)
    const z0 = -0.2;
    const toPx = (x: number, z: number): [number, number] => [w / 2 + x * PX, h / 2 + (z - z0) * PX];
    const d = embossDecal(
      w,
      h,
      (g) => {
        const line = rgba(accent, 0.55);
        const text = rgba(accent, 0.7);
        g.lineWidth = 4;
        for (const [side, label, sub] of [
          ['player', 'PLAYER  闲', '1 TO 1'],
          ['banker', 'BANKER  庄', '1 TO 1 · 5% COMMISSION'],
        ] as const) {
          const cx = side === 'player' ? -HAND_X : HAND_X;
          const [x0, y0] = toPx(cx - 0.82, HAND_Z - 0.62);
          const bw = 1.64 * PX;
          const bh = 2.25 * PX;
          g.strokeStyle = line;
          roundRectPath(g, x0, y0, bw, bh, 26);
          g.stroke();
          g.fillStyle = text;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.font = `700 ${Math.round(0.17 * PX)}px Georgia, "Times New Roman", "Songti SC", serif`;
          const [lx, ly] = toPx(cx, HAND_Z + 1.42);
          g.fillText(label, lx, ly);
          g.font = `600 ${Math.round(0.09 * PX)}px Georgia, serif`;
          g.fillText(sub, lx, ly + 0.17 * PX);
        }
        g.fillStyle = text;
        g.font = `700 ${Math.round(0.15 * PX)}px Georgia, "Songti SC", serif`;
        const [tx, ty] = toPx(0, HAND_Z - 0.18);
        g.fillText('TIE 和', tx, ty);
        g.font = `600 ${Math.round(0.1 * PX)}px Georgia, serif`;
        g.fillText(`${rules.tiePays} TO 1`, tx, ty + 0.15 * PX);
        g.fillStyle = rgba(accent, 0.42);
        const [cx, cy] = toPx(0, -3.2);
        arcText(g, 'BANKER PAYS 1 TO 1 LESS 5% · TIE PAYS 8 TO 1', cx, cy, 4.95 * PX, `600 ${Math.round(0.1 * PX)}px Georgia, serif`, 0.025 * PX);
      },
      1.4,
    );
    const mat = new THREE.MeshStandardMaterial({ map: d.map, normalMap: d.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 });
    return { ...d, mat };
  }, [accent, rules.tiePays]);
  const rings = useMemo(() => {
    const geo = new THREE.RingGeometry(0.15, 0.166, 40);
    const make = (c: string) => new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.5, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    return { geo, player: make('#6fa8ff'), banker: make('#ff7a7a'), tie: make(accent) };
  }, [accent]);
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
      rings.geo.dispose();
      rings.player.dispose();
      rings.banker.dispose();
      rings.tie.dispose();
    },
    [rings],
  );
  return (
    <group>
      <mesh position={[0, TABLE_Y + 0.0015, -0.2]} rotation={[-Math.PI / 2, 0, 0]} material={mat} receiveShadow renderOrder={1}>
        <planeGeometry args={[W, D]} />
      </mesh>
      {seats.map((id) => {
        const l = layout.get(id);
        if (!l) return null;
        return (['player', 'tie', 'banker'] as const).map((s) => {
          const p = bacSpotPos(l, s);
          return <mesh key={id + s} geometry={rings.geo} material={rings[s]} position={[p[0], TABLE_Y + 0.002, p[2]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1} />;
        });
      })}
    </group>
  );
}

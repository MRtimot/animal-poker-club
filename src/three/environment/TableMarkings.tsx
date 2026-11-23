// 桌面印记：公共牌区域（与公共牌坐标精确对齐的五个牌位）、低调压印的俱乐部标志、当前行动玩家前的柔光
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BOARD_GAP, BOARD_SCALE, CARD_H, CARD_W, TABLE_Y, boardPos, type SeatLayout } from '../layout';
import { embossDecal } from '../realism';
import { damp } from '../../animation/motion';
import { prefersReducedMotion } from '../../utils/reducedMotion';

// 牌位比公共牌略大一圈；区域包住五个牌位
const SLOT_W = CARD_W * BOARD_SCALE + 0.06;
const SLOT_D = CARD_H * BOARD_SCALE + 0.07;
const INNER_W = BOARD_GAP * 4 + SLOT_W + 0.16;
const INNER_D = SLOT_D + 0.16;
const ZONE_W = INNER_W + 0.08;
const ZONE_D = INNER_D + 0.08;
const PX = 260; // 每个世界单位的像素数

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** 公共牌区域：一块略深的绒布 + 五个牌位细线（牌位中心就是 boardPos，发牌一定落在框里） */
function BoardZone() {
  const cz = boardPos(2)[2];
  const { map, normalMap, mat } = useMemo(() => {
    const w = Math.round(ZONE_W * PX);
    const h = Math.round(ZONE_D * PX);
    const d = embossDecal(
      w,
      h,
      (g) => {
        const zx = ((ZONE_W - INNER_W) / 2) * PX;
        const zy = ((ZONE_D - INNER_D) / 2) * PX;
        roundRect(g, zx, zy, INNER_W * PX, INNER_D * PX, 0.12 * PX);
        g.fillStyle = 'rgba(8, 30, 20, 0.22)';
        g.fill();
        g.lineWidth = 2.5;
        g.strokeStyle = 'rgba(226, 204, 140, 0.26)';
        g.stroke();
        for (let i = 0; i < 5; i++) {
          const x = (boardPos(i)[0] + ZONE_W / 2 - SLOT_W / 2) * PX;
          const y = (ZONE_D / 2 - SLOT_D / 2) * PX;
          roundRect(g, x, y, SLOT_W * PX, SLOT_D * PX, 0.05 * PX);
          g.lineWidth = 2;
          g.strokeStyle = 'rgba(236, 226, 196, 0.16)';
          g.stroke();
        }
      },
      1.2,
    );
    const mat = new THREE.MeshStandardMaterial({
      map: d.map,
      normalMap: d.normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
      transparent: true,
      depthWrite: false,
      roughness: 0.95,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    return { ...d, mat };
  }, []);
  useEffect(
    () => () => {
      map.dispose();
      normalMap.dispose();
      mat.dispose();
    },
    [map, normalMap, mat],
  );
  return (
    <mesh position={[0, TABLE_Y + 0.0015, cz]} rotation={[-Math.PI / 2, 0, 0]} material={mat} receiveShadow renderOrder={1}>
      <planeGeometry args={[ZONE_W, ZONE_D]} />
    </mesh>
  );
}

/** 俱乐部标志：压印在绒布上的“爪印黑桃”与细小字母，低对比度，不和公共牌抢视线 */
function Emblem() {
  const W = 1.5;
  const D = 0.62;
  const { map, normalMap, mat } = useMemo(() => {
    const w = 512;
    const h = Math.round((512 * D) / W);
    const d = embossDecal(
      w,
      h,
      (g) => {
        const ink = 'rgba(64, 132, 96, 0.55)';
        g.fillStyle = ink;
        g.strokeStyle = ink;
        // 爪印：四个脚趾 + 黑桃形掌垫
        const cx = w / 2;
        const cy = h * 0.36;
        const toes: [number, number, number][] = [
          [-34, -22, 11],
          [-12, -36, 12],
          [12, -36, 12],
          [34, -22, 11],
        ];
        for (const [x, y, r] of toes) {
          g.beginPath();
          g.ellipse(cx + x, cy + y, r * 0.85, r, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.beginPath();
        g.moveTo(cx, cy - 18);
        g.bezierCurveTo(cx + 40, cy + 2, cx + 30, cy + 34, cx + 8, cy + 28);
        g.lineTo(cx + 14, cy + 42);
        g.lineTo(cx - 14, cy + 42);
        g.lineTo(cx - 8, cy + 28);
        g.bezierCurveTo(cx - 30, cy + 34, cx - 40, cy + 2, cx, cy - 18);
        g.fill();
        // 两侧细线 + 字母
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(w * 0.12, cy + 8);
        g.lineTo(w * 0.36, cy + 8);
        g.moveTo(w * 0.64, cy + 8);
        g.lineTo(w * 0.88, cy + 8);
        g.stroke();
        g.font = '600 22px Georgia, "Times New Roman", serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('A N I M A L   P O K E R   C L U B', cx, h * 0.84);
      },
      5,
    );
    const mat = new THREE.MeshStandardMaterial({
      map: d.map,
      normalMap: d.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      transparent: true,
      depthWrite: false,
      roughness: 0.92,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    return { ...d, mat };
  }, []);
  useEffect(
    () => () => {
      map.dispose();
      normalMap.dispose();
      mat.dispose();
    },
    [map, normalMap, mat],
  );
  return (
    <mesh position={[0, TABLE_Y + 0.0015, 1.18]} rotation={[-Math.PI / 2, 0, 0]} material={mat} receiveShadow renderOrder={1}>
      <planeGeometry args={[W, D]} />
    </mesh>
  );
}

export function TableMarkings() {
  return (
    <group>
      <BoardZone />
      <Emblem />
    </group>
  );
}

/** 当前行动玩家面前的桌面柔光：暖金色、缓慢呼吸，换人时平滑移动过去 */
export function TurnGlow({ layout, mine }: { layout?: SeatLayout; mine: boolean }) {
  const mesh = useRef<THREE.Mesh>(null!);
  const st = useRef({ angle: layout?.angle ?? 0, level: 0 });
  const { tex, mat } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: '#ffcf7a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    return { tex, mat };
  }, []);
  useEffect(
    () => () => {
      tex.dispose();
      mat.dispose();
    },
    [tex, mat],
  );
  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const s = st.current;
    const want = layout ? (mine ? 0.34 : 0.24) : 0;
    s.level = damp(s.level, want, 5, dt);
    if (layout) {
      // 沿桌边最短方向转过去
      let d = layout.angle - s.angle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      s.angle += d * Math.min(1, dt * 7);
    }
    const breathe = prefersReducedMotion() ? 1 : 0.85 + Math.sin(performance.now() / 600) * 0.15;
    mat.opacity = s.level * breathe;
    m.visible = mat.opacity > 0.005;
    const r = 2.5;
    m.position.set(Math.sin(s.angle) * r, TABLE_Y + 0.004, Math.cos(s.angle) * r);
    m.rotation.set(-Math.PI / 2, 0, s.angle);
  });
  return (
    <mesh ref={mesh} material={mat} renderOrder={2} visible={false}>
      <planeGeometry args={[1.9, 1.15]} />
    </mesh>
  );
}

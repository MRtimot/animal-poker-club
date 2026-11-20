import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Card } from '../../core/cards/card';
import { cardBackTexture, cardFaceTexture } from '../textures';
import { CARD_H, CARD_W, DECK_POS, V3 } from '../layout';
import { sound } from '../../audio/sound';

const cardGeo = new THREE.BoxGeometry(CARD_W, 0.008, CARD_H);
const edgeMat = new THREE.MeshStandardMaterial({ color: '#f1ece0', roughness: 0.6 });
let backMat: THREE.MeshStandardMaterial | null = null;
const faceMats = new Map<string, THREE.MeshStandardMaterial>();
const glowMat = new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.0, depthWrite: false });
const glowGeo = new THREE.PlaneGeometry(CARD_W * 1.18, CARD_H * 1.14);

function getBack() {
  if (!backMat) backMat = new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.45 });
  return backMat;
}
function getFace(card: Card) {
  let m = faceMats.get(card.id);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: cardFaceTexture(card), roughness: 0.4 });
    faceMats.set(card.id, m);
  }
  return m;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export interface Card3DProps {
  card: Card | null;
  target: V3;
  yaw?: number;
  tilt?: number;
  faceUp: boolean;
  /** 发牌延迟（毫秒） */
  delay?: number;
  from?: V3;
  highlight?: boolean;
  flightMs?: number;
  silent?: boolean;
}

/**
 * 3D 扑克牌：从牌堆飞出 → 旋转 → 移动 → 落地轻弹 → 翻面。
 * 目标改变（例如弃牌）时平滑移动；牌面可见性改变时播放 180° 翻牌动画。
 */
export function Card3D({ card, target, yaw = 0, tilt = 0, faceUp, delay = 0, from = DECK_POS, highlight = false, flightMs = 520, silent }: Card3DProps) {
  const ref = useRef<THREE.Group>(null!);
  const glow = useRef<THREE.Mesh>(null!);
  const st = useRef({
    start: performance.now() + delay,
    landed: false,
    landTime: 0,
    flip: Math.PI, // 当前翻转角
    flipFrom: Math.PI,
    flipStart: -1,
    pos: new THREE.Vector3(...from),
    soundPlayed: false,
  });
  const myGlow = useMemo(() => glowMat.clone(), []);
  useEffect(() => () => myGlow.dispose(), [myGlow]);

  const materials = useMemo(() => {
    const face = card ? getFace(card) : getBack();
    return [edgeMat, edgeMat, face, getBack(), edgeMat, edgeMat];
  }, [card]);

  useEffect(() => {
    // 牌面朝向变化 → 翻牌动画
    const s = st.current;
    if (!s.landed) return;
    const want = faceUp && card ? 0 : Math.PI;
    if (Math.abs(want - s.flip) > 0.01) {
      s.flipFrom = s.flip;
      s.flipStart = performance.now();
      if (!silent) sound.play('flip');
    }
  }, [faceUp, card, silent]);

  useFrame(() => {
    const s = st.current;
    const g = ref.current;
    const now = performance.now();
    const tgt = new THREE.Vector3(...target);
    if (now < s.start) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const want = faceUp && card ? 0 : Math.PI;

    if (!s.landed) {
      if (!s.soundPlayed) {
        s.soundPlayed = true;
        if (!silent) sound.play('card');
      }
      const p = Math.min(1, (now - s.start) / flightMs);
      const e = easeOut(p);
      const fromV = new THREE.Vector3(...from);
      s.pos.lerpVectors(fromV, tgt, e);
      s.pos.y += Math.sin(p * Math.PI) * 0.55;
      g.position.copy(s.pos);
      g.rotation.set(tilt * e, yaw + (1 - e) * Math.PI * 1.6, Math.PI, 'YXZ');
      s.flip = Math.PI;
      if (p >= 1) {
        s.landed = true;
        s.landTime = now;
        if (want === 0) {
          s.flipFrom = Math.PI;
          s.flipStart = now + 80;
          if (!silent) sound.play('flip', 0.08);
        }
      }
      return;
    }

    // 落地后：跟随目标（平滑），轻微弹跳
    s.pos.lerp(tgt, 0.12);
    const since = (now - s.landTime) / 1000;
    const bounce = since < 0.35 ? Math.abs(Math.sin(since * 18)) * 0.05 * (1 - since / 0.35) : 0;

    // 翻牌
    let flipLift = 0;
    if (s.flipStart >= 0) {
      const fp = Math.min(1, Math.max(0, (now - s.flipStart) / 380));
      const e = fp < 0.5 ? 2 * fp * fp : 1 - Math.pow(-2 * fp + 2, 2) / 2;
      s.flip = s.flipFrom + (want - s.flipFrom) * e;
      flipLift = Math.sin(fp * Math.PI) * 0.22;
      if (fp >= 1) {
        s.flip = want;
        s.flipStart = -1;
      }
    } else {
      s.flip = want;
    }
    g.position.set(s.pos.x, s.pos.y + bounce + flipLift, s.pos.z);
    g.rotation.set(tilt, yaw, s.flip, 'YXZ');

    // 获胜牌发光
    const gm = myGlow;
    gm.opacity += ((highlight ? 0.55 + Math.sin(now / 200) * 0.2 : 0) - gm.opacity) * 0.15;
    glow.current.visible = gm.opacity > 0.02;
  });

  return (
    <group ref={ref} visible={false}>
      <mesh geometry={cardGeo} material={materials} castShadow receiveShadow />
      <mesh ref={glow} geometry={glowGeo} material={myGlow} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.006, 0]} visible={false} />
    </group>
  );
}

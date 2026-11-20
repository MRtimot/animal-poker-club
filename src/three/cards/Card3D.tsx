import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Card } from '../../core/cards/card';
import { cardBackTexture, cardFaceTexture } from '../textures';
import { CARD_H, CARD_W, DECK_POS, V3 } from '../layout';
import { sound } from '../../audio/sound';
import { DUR, arc, clamp01, damp, ease, settle } from '../../animation/motion';

const cardGeo = new THREE.BoxGeometry(CARD_W, 0.008, CARD_H);
const edgeMat = new THREE.MeshStandardMaterial({ color: '#f1ece0', roughness: 0.6 });
let backMat: THREE.MeshStandardMaterial | null = null;
const faceMats = new Map<string, THREE.MeshStandardMaterial>();
const glowMat = new THREE.MeshBasicMaterial({ color: '#ffd84a', transparent: true, opacity: 0.0, depthWrite: false });
const glowGeo = new THREE.PlaneGeometry(CARD_W * 1.18, CARD_H * 1.14);
const glintMat = new THREE.MeshBasicMaterial({ color: '#fff3c8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const glintGeo = new THREE.PlaneGeometry(CARD_W * 1.02, CARD_H * 1.02);

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

export interface Card3DProps {
  card: Card | null;
  target: V3;
  yaw?: number;
  tilt?: number;
  faceUp: boolean;
  /** 发牌延迟（毫秒） */
  delay?: number;
  from?: V3;
  /** 起飞时的朝向（回收旧牌时从正面开始） */
  fromFaceUp?: boolean;
  fromYaw?: number;
  highlight?: boolean;
  flightMs?: number;
  /** 飞行弧线高度 */
  arcHeight?: number;
  /** 落地后再翻面的停顿（毫秒），河牌用更长的停顿制造期待感 */
  revealPause?: number;
  /** 目标位置改变时，开始移动前的等待（例如弃牌：先让动物做动作） */
  moveDelay?: number;
  /** 落地后隐藏（回收到牌堆的旧牌） */
  vanishOnLand?: boolean;
  silent?: boolean;
}

const tmpA = new THREE.Vector3();

/**
 * 卡牌动画控制器：
 * 牌堆抽出 → 沿弧线飞行并旋转、轻微倾斜 → 落桌压一下、弹回、稳定 → 3D 翻面（0°→90°→180°，抬起 + 光泽）
 * 目标改变（弃牌、回收）时沿小弧线滑动，从不瞬移。
 */
export function Card3D({
  card, target, yaw = 0, tilt = 0, faceUp, delay = 0, from = DECK_POS, fromFaceUp = false, fromYaw, highlight = false,
  flightMs = DUR.cardFlight, arcHeight = 0.6, revealPause = 80, moveDelay = 0, vanishOnLand = false, silent,
}: Card3DProps) {
  const ref = useRef<THREE.Group>(null!);
  const glow = useRef<THREE.Mesh>(null!);
  const glint = useRef<THREE.Mesh>(null!);
  const st = useRef({
    start: performance.now() + delay,
    landed: false,
    landTime: 0,
    flip: fromFaceUp ? 0 : Math.PI,
    flipFrom: Math.PI,
    flipStart: -1,
    pos: new THREE.Vector3(...from),
    yaw: fromYaw ?? yaw,
    tilt: 0,
    moveFrom: new THREE.Vector3(),
    moveTo: new THREE.Vector3(...target),
    moveStart: -1,
    soundPlayed: false,
    gone: false,
  });
  const myGlow = useMemo(() => glowMat.clone(), []);
  const myGlint = useMemo(() => glintMat.clone(), []);
  useEffect(
    () => () => {
      myGlow.dispose();
      myGlint.dispose();
    },
    [myGlow, myGlint],
  );

  const materials = useMemo(() => {
    const face = card ? getFace(card) : getBack();
    return [edgeMat, edgeMat, face, getBack(), edgeMat, edgeMat];
  }, [card]);

  const want = faceUp && card ? 0 : Math.PI;

  useEffect(() => {
    // 牌面朝向变化 → 翻牌动画
    const s = st.current;
    if (!s.landed) return;
    if (Math.abs(want - s.flip) > 0.01 && s.flipStart < 0) {
      s.flipFrom = s.flip;
      s.flipStart = performance.now();
      if (!silent) sound.play('flip');
    }
  }, [want, silent]);

  const tKey = target.join(',');
  useEffect(() => {
    // 目标位置改变 → 等待后沿弧线移动
    const s = st.current;
    tmpA.set(...target);
    if (!s.landed) {
      s.moveTo.copy(tmpA);
      return;
    }
    if (tmpA.distanceTo(s.moveTo) < 0.001) return;
    s.moveFrom.copy(s.pos);
    s.moveTo.copy(tmpA);
    s.moveStart = performance.now() + moveDelay;
  }, [tKey]); // eslint-disable-line

  useFrame((_, dt) => {
    const s = st.current;
    const g = ref.current;
    if (!g) return;
    const now = performance.now();
    if (now < s.start || s.gone) {
      g.visible = false;
      return;
    }
    g.visible = true;

    if (!s.landed) {
      if (!s.soundPlayed) {
        s.soundPlayed = true;
        if (!silent) sound.play('card');
      }
      const p = clamp01((now - s.start) / flightMs);
      const e = ease.outCubic(p);
      tmpA.set(...from);
      s.pos.lerpVectors(tmpA, s.moveTo, e);
      s.pos.y += arc(p, arcHeight);
      // 旋转着飞出，逐渐减速对准目标朝向；飞行中轻微倾斜
      const startYaw = fromYaw ?? yaw;
      const spin = vanishOnLand ? 0.5 : 1.6;
      const yNow = startYaw + (yaw - startYaw) * e + (1 - e) * Math.PI * spin;
      const roll = Math.sin(p * Math.PI) * (vanishOnLand ? 0.12 : 0.3);
      s.flip = fromFaceUp ? ease.inOutCubic(clamp01(p * 1.5)) * Math.PI : Math.PI;
      g.position.copy(s.pos);
      g.rotation.set(tilt * e + roll * 0.5, yNow, s.flip + roll, 'YXZ');
      glint.current.visible = false;
      if (p >= 1) {
        s.landed = true;
        s.landTime = now;
        s.yaw = yaw;
        s.tilt = tilt;
        if (vanishOnLand) {
          s.gone = true;
          g.visible = false;
          return;
        }
        if (want === 0) {
          s.flipFrom = Math.PI;
          s.flipStart = now + revealPause;
          if (!silent) sound.play('flip', revealPause / 1000);
        }
      }
      return;
    }

    // 落地后的移动补间（弃牌滑到弃牌区等）
    if (s.moveStart >= 0) {
      if (now >= s.moveStart) {
        const mp = clamp01((now - s.moveStart) / DUR.cardMove);
        const e = ease.inOutCubic(mp);
        s.pos.lerpVectors(s.moveFrom, s.moveTo, e);
        s.pos.y += arc(mp, Math.min(0.35, s.moveFrom.distanceTo(s.moveTo) * 0.22));
        if (mp >= 1) {
          s.moveStart = -1;
          s.landTime = now; // 再次落桌弹一下
        }
      }
    } else {
      s.pos.x = damp(s.pos.x, s.moveTo.x, 14, dt);
      s.pos.y = damp(s.pos.y, s.moveTo.y, 14, dt);
      s.pos.z = damp(s.pos.z, s.moveTo.z, 14, dt);
    }
    const moving = s.moveStart >= 0 && now >= s.moveStart;
    s.yaw = damp(s.yaw, yaw, moving ? 7 : 10, dt);
    s.tilt = damp(s.tilt, tilt, 9, dt);

    // 落桌：先往下压一点 → 弹回 → 稳定
    const since = (now - s.landTime) / 1000;
    const bounce = settle(since, 0.03);

    // 3D 翻面：0° → 90°（侧面）→ 180°，同时抬起并在显示正面时闪一下光
    let flipLift = 0;
    let glintOp = 0;
    if (s.flipStart >= 0) {
      if (now >= s.flipStart) {
        const fp = clamp01((now - s.flipStart) / DUR.cardFlip);
        const e = ease.inOutCubic(fp);
        s.flip = s.flipFrom + (want - s.flipFrom) * e;
        flipLift = arc(fp, 0.26);
        glintOp = want === 0 ? Math.max(0, 1 - Math.abs(fp - 0.7) * 3.4) * 0.6 : 0;
        if (fp >= 1) {
          s.flip = want;
          s.flipStart = -1;
          s.landTime = now;
        }
      }
    } else {
      s.flip = want;
    }
    g.position.set(s.pos.x, s.pos.y + bounce + flipLift, s.pos.z);
    g.rotation.set(s.tilt, s.yaw, s.flip, 'YXZ');

    // 获胜牌发光 + 翻面光泽
    myGlow.opacity = damp(myGlow.opacity, highlight ? 0.55 + Math.sin(now / 200) * 0.2 : 0, 8, dt);
    glow.current.visible = myGlow.opacity > 0.02;
    myGlint.opacity = damp(myGlint.opacity, glintOp, 28, dt);
    glint.current.visible = myGlint.opacity > 0.02;
  });

  return (
    <group ref={ref} visible={false}>
      <mesh geometry={cardGeo} material={materials} castShadow receiveShadow />
      <mesh ref={glow} geometry={glowGeo} material={myGlow} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.006, 0]} visible={false} />
      <mesh ref={glint} geometry={glintGeo} material={myGlint} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0055, 0]} visible={false} />
    </group>
  );
}

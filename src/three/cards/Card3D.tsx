import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Card } from '../../core/cards/card';
import { cardBackTexture, cardFaceTexture } from '../textures';
import { CARD_H, CARD_W, DECK_POS, V3 } from '../layout';
import { sound } from '../../audio/sound';
import { DUR, arc, clamp01, damp, ease, settle } from '../../animation/motion';
import { shadowGeo, shadowMaterial } from '../realism';
import { TABLE_Y } from '../layout';

// —— 写实卡牌几何：圆角、真实厚度、纸张边缘 ——
const CARD_T = 0.006;
const CORNER = 0.038;
function cardShape() {
  const w = CARD_W / 2;
  const h = CARD_H / 2;
  const r = CORNER;
  const sh = new THREE.Shape();
  sh.moveTo(-w + r, -h);
  sh.lineTo(w - r, -h);
  sh.quadraticCurveTo(w, -h, w, -h + r);
  sh.lineTo(w, h - r);
  sh.quadraticCurveTo(w, h, w - r, h);
  sh.lineTo(-w + r, h);
  sh.quadraticCurveTo(-w, h, -w, h - r);
  sh.lineTo(-w, -h + r);
  sh.quadraticCurveTo(-w, -h, -w + r, -h);
  return sh;
}
function capGeo(up: boolean) {
  const g = new THREE.ShapeGeometry(cardShape(), 5);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / CARD_W + 0.5, pos.getY(i) / CARD_H + 0.5);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  g.translate(0, up ? CARD_T / 2 : -CARD_T / 2, 0);
  return g;
}
const faceGeo = capGeo(true);
const backGeo = capGeo(false);
const edgeGeo = (() => {
  const g = new THREE.ExtrudeGeometry(cardShape(), { depth: CARD_T, bevelEnabled: false, curveSegments: 5 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -CARD_T / 2, 0);
  return g;
})();
const hiddenMat = new THREE.MeshBasicMaterial({ visible: false });
const edgeMat = new THREE.MeshStandardMaterial({ color: '#ece6d8', roughness: 0.7 });
const edgeMats = [hiddenMat, edgeMat];
let backMat: THREE.MeshPhysicalMaterial | null = null;
const faceMats = new Map<string, THREE.MeshPhysicalMaterial>();
const glowMat = new THREE.MeshBasicMaterial({ color: '#ffd98a', transparent: true, opacity: 0.0, depthWrite: false });
const glowGeo = new THREE.PlaneGeometry(CARD_W * 1.12, CARD_H * 1.09);
const glintMat = new THREE.MeshBasicMaterial({ color: '#fff3c8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const glintGeo = new THREE.PlaneGeometry(CARD_W * 0.98, CARD_H * 0.98);

// 覆膜纸牌：略带清漆光泽，灯光下会出现柔和的高光
function getBack() {
  if (!backMat) backMat = new THREE.MeshPhysicalMaterial({ map: cardBackTexture(), roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 });
  return backMat;
}
function getFace(card: Card) {
  let m = faceMats.get(card.id);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ map: cardFaceTexture(card), roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 });
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
  /** 摊牌时逐个翻开：翻面前的等待（毫秒） */
  flipDelay?: number;
}

const tmpA = new THREE.Vector3();

/**
 * 卡牌动画控制器：
 * 牌堆抽出 → 沿弧线飞行并旋转、轻微倾斜 → 落桌压一下、弹回、稳定 → 3D 翻面（0°→90°→180°，抬起 + 光泽）
 * 目标改变（弃牌、回收）时沿小弧线滑动，从不瞬移。
 */
export function Card3D({
  card, target, yaw = 0, tilt = 0, faceUp, delay = 0, from = DECK_POS, fromFaceUp = false, fromYaw, highlight = false,
  flightMs = DUR.cardFlight, arcHeight = 0.22, revealPause = 80, moveDelay = 0, vanishOnLand = false, silent, flipDelay = 0,
}: Card3DProps) {
  const ref = useRef<THREE.Group>(null!);
  const glow = useRef<THREE.Mesh>(null!);
  const glint = useRef<THREE.Mesh>(null!);
  const shadow = useRef<THREE.Mesh>(null!);
  const st = useRef({
    jitter: 0,
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
  const myShadow = useMemo(() => shadowMaterial('rect', 0.6).clone(), []);
  useEffect(
    () => () => {
      myGlow.dispose();
      myGlint.dispose();
      myShadow.dispose();
    },
    [myGlow, myGlint, myShadow],
  );

  const faceMat = card ? getFace(card) : getBack();

  const want = faceUp && card ? 0 : Math.PI;

  useEffect(() => {
    // 牌面朝向变化 → 翻牌动画
    const s = st.current;
    if (!s.landed) return;
    if (Math.abs(want - s.flip) > 0.01 && s.flipStart < 0) {
      s.flipFrom = s.flip;
      s.flipStart = performance.now() + flipDelay;
      if (!silent) sound.play('flip', flipDelay / 1000, { x: s.pos.x, z: s.pos.z });
    }
  }, [want, silent]); // eslint-disable-line

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

  /** 接触阴影：贴在桌面上，牌抬得越高阴影越淡、越大 */
  const placeShadow = (x: number, y: number, z: number, ry: number) => {
    const sh = shadow.current;
    const above = Math.max(0, y - TABLE_Y);
    sh.position.set(x + above * 0.08, TABLE_Y + 0.0012, z + above * 0.05);
    sh.rotation.set(-Math.PI / 2, 0, ry);
    const k = 1 + above * 1.4;
    sh.scale.set(CARD_W * 1.3 * k, CARD_H * 1.25 * k, 1);
    myShadow.opacity = 0.6 / (1 + above * 7);
  };

  useFrame((_, dt) => {
    const s = st.current;
    const g = ref.current;
    if (!g) return;
    const now = performance.now();
    if (now < s.start || s.gone) {
      g.visible = false;
      shadow.current.visible = false;
      return;
    }
    g.visible = true;
    shadow.current.visible = true;

    if (!s.landed) {
      if (!s.soundPlayed) {
        s.soundPlayed = true;
        if (!silent) sound.play('card', 0, { x: s.moveTo.x, z: s.moveTo.z });
      }
      const p = clamp01((now - s.start) / flightMs);
      const e = ease.outCubic(p);
      tmpA.set(...from);
      s.pos.lerpVectors(tmpA, s.moveTo, e);
      s.pos.y += arc(p, arcHeight);
      // 旋转着飞出，逐渐减速对准目标朝向；飞行中轻微倾斜
      const startYaw = fromYaw ?? yaw;
      // 荷官发牌：低平的弧线，只有很少的旋转
      const spin = vanishOnLand ? 0.2 : 0.45;
      const yNow = startYaw + (yaw - startYaw) * e + (1 - e) * Math.PI * spin;
      const roll = Math.sin(p * Math.PI) * (vanishOnLand ? 0.05 : 0.08);
      s.flip = fromFaceUp ? ease.inOutCubic(clamp01(p * 1.5)) * Math.PI : Math.PI;
      g.position.copy(s.pos);
      g.rotation.set(tilt * e + roll * 0.5, yNow, s.flip + roll, 'YXZ');
      glint.current.visible = false;
      placeShadow(s.pos.x, s.pos.y, s.pos.z, yNow);
      if (p >= 1) {
        s.landed = true;
        s.landTime = now;
        s.yaw = yaw;
        s.tilt = tilt;
        // 落桌时的摩擦：极轻微的转动后停住
        s.jitter = (Math.random() - 0.5) * 0.06;
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
    const jit = s.jitter * Math.exp(-since * 9);
    g.position.set(s.pos.x, s.pos.y + bounce + flipLift, s.pos.z);
    g.rotation.set(s.tilt, s.yaw + jit, s.flip, 'YXZ');
    placeShadow(s.pos.x, s.pos.y + bounce + flipLift + (s.tilt ? 0.08 : 0), s.pos.z, s.yaw + jit);

    // 获胜牌发光 + 翻面光泽
    myGlow.opacity = damp(myGlow.opacity, highlight ? 0.55 + Math.sin(now / 200) * 0.2 : 0, 8, dt);
    glow.current.visible = myGlow.opacity > 0.02;
    myGlint.opacity = damp(myGlint.opacity, glintOp, 28, dt);
    glint.current.visible = myGlint.opacity > 0.02;
  });

  return (
    <>
    <mesh ref={shadow} geometry={shadowGeo} material={myShadow} visible={false} renderOrder={1} />
    <group ref={ref} visible={false}>
      <mesh geometry={faceGeo} material={faceMat} castShadow receiveShadow />
      <mesh geometry={backGeo} material={getBack()} castShadow />
      <mesh geometry={edgeGeo} material={edgeMats} />
      <mesh ref={glow} geometry={glowGeo} material={myGlow} rotation={[-Math.PI / 2, 0, 0]} position={[0, -CARD_T, 0]} visible={false} />
      <mesh ref={glint} geometry={glintGeo} material={myGlint} rotation={[-Math.PI / 2, 0, 0]} position={[0, CARD_T / 2 + 0.001, 0]} visible={false} />
    </group>
    </>
  );
}

/**
 * 卡牌本体（不含发牌动画）：与牌桌上的卡牌共用同一套几何体与材质（不会重复创建资源）。
 * 牌面朝 +Y；父级负责位置与翻面（绕 Z 轴旋转 π 即背面朝上）。首页的滚动展示使用它。
 */
export function CardBody({ card }: { card: Card }) {
  const faceMat = getFace(card);
  return (
    <>
      <mesh geometry={faceGeo} material={faceMat} castShadow receiveShadow />
      <mesh geometry={backGeo} material={getBack()} castShadow />
      <mesh geometry={edgeGeo} material={edgeMats} />
    </>
  );
}

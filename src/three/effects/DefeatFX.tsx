// 失败演出的 3D 效果（只在演出期间挂载，结束后全部卸载并释放显存）：
// · 灯光：克制的暗红轮廓光（危险信号）、孤立输家的冷色顶光、冲击瞬间的闪光
// · 冲击：烟雾（爆开 → 扩散 → 慢慢散去）、灰尘与碎屑、纸牌碎片、散开的筹码
// 没有任何血液、伤口或身体碎片；粒子数量按设备档位（手机 / 低画质 / 减少动态效果）减少。
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { setDefeatPhase, useDefeat, type DefeatSequence } from '../../animation/defeat/defeatStore';
import { PHASE_ORDER, type DefeatPhase } from '../../animation/defeat/defeatRules';
import { TABLE_Y, type SeatLayout } from '../layout';
import { FACE_DROP } from '../camera/defeatCamera';

const GRAVITY = -7.5;

/**
 * 每个阶段的红色轮廓光与孤立输家的顶光强度（0~1）。
 * 注意：演出不新增任何灯光（新增 / 显示灯光会让 three.js 重新编译所有材质，造成明显卡顿）：
 * 红色轮廓光复用场景的轮廓光（SceneLights），孤立顶光复用赢家聚光灯（WinnerLight），闪光是现有灯光的瞬间增亮。
 */
export const DEFEAT_RED: Partial<Record<DefeatPhase, number>> = { reaction: 0.35, tension: 1, insert: 1, silence: 0.9, impact: 0.8, aftermath: 0.7, blackout: 0.5, defeated: 0.4 };
export const DEFEAT_ISOLATE: Partial<Record<DefeatPhase, number>> = { realize: 0.55, reaction: 0.8, tension: 1, insert: 0.9, silence: 0.9, impact: 0.7, aftermath: 0.75, blackout: 0.5, defeated: 0.4 };

/** 冲击闪光的亮度（0~1，冲击后约 0.3 秒内衰减） */
export function defeatFlash(now: number): number {
  const s = useDefeat.getState().seq;
  const t0 = s?.at.impact;
  if (!s || t0 === undefined || useDefeat.getState().skipped) return 0;
  const t = (now - t0) / 1000;
  return t >= 0 && t < 0.5 ? Math.exp(-t * 16) * s.profile.flash * (s.cut === 'short' ? 0.6 : 1) : 0;
}

/** 计时器可能因为页面繁忙而晚到：每一帧按时间表校正当前阶段（只会往后走） */
function syncPhase(now: number) {
  const d = useDefeat.getState();
  const s = d.seq;
  if (!s || !d.phase || d.skipped || d.phase === 'recover') return;
  let want: DefeatPhase = d.phase;
  for (const ph of PHASE_ORDER) {
    const at = s.at[ph];
    if (at !== undefined && now >= at && PHASE_ORDER.indexOf(ph) > PHASE_ORDER.indexOf(want)) want = ph;
  }
  // “出局”画面与恢复只由导演（玩家的选择）决定
  if (want !== d.phase && want !== 'recover' && (s.cut === 'short' || want !== 'defeated' || now >= (s.at.defeated ?? Infinity))) setDefeatPhase(s.key, want);
}

/** 柔和的烟雾贴图（本地生成，不加载任何文件） */
function smokeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 7; i++) {
    const x = 64 + (Math.random() - 0.5) * 34;
    const y = 64 + (Math.random() - 0.5) * 34;
    const r = 26 + Math.random() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.32)');
    grd.addColorStop(0.55, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Particle {
  p: THREE.Vector3;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  size: number;
  delay: number;
}

function burstParticles(n: number, origin: THREE.Vector3, speed: [number, number], up: [number, number], size: [number, number]): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed[0] + Math.random() * (speed[1] - speed[0]);
    out.push({
      p: origin.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.2, (Math.random() - 0.5) * 0.3)),
      v: new THREE.Vector3(Math.cos(a) * s, up[0] + Math.random() * (up[1] - up[0]), Math.sin(a) * s),
      spin: new THREE.Vector3(Math.random() * 14 - 7, Math.random() * 14 - 7, Math.random() * 14 - 7),
      size: size[0] + Math.random() * (size[1] - size[0]),
      delay: Math.random() * 0.06,
    });
  }
  return out;
}

const tmpObj = new THREE.Object3D();

/** 抛物线运动，落到桌面 / 地面后停住（只是画面） */
function ballistic(pt: Particle, t: number, floor: number, out: THREE.Vector3) {
  const tt = Math.max(0, t - pt.delay);
  out.set(pt.p.x + pt.v.x * tt, pt.p.y + pt.v.y * tt + 0.5 * GRAVITY * tt * tt, pt.p.z + pt.v.z * tt);
  if (out.y < floor) {
    // 落地：找到落地时刻，之后停在那里
    const a = 0.5 * GRAVITY;
    const b = pt.v.y;
    const cc = pt.p.y - floor;
    const disc = b * b - 4 * a * cc;
    const tl = disc >= 0 ? (-b - Math.sqrt(disc)) / (2 * a) : tt;
    const land = Math.max(0, Math.min(tt, tl));
    out.set(pt.p.x + pt.v.x * land, floor, pt.p.z + pt.v.z * land);
    return true;
  }
  return false;
}

function ImpactBurst({ seq, layout }: { seq: DefeatSequence; layout: Map<string, SeatLayout> }) {
  const L = layout.get(seq.loserId);
  const prof = seq.profile;
  const head = useMemo(() => (L ? new THREE.Vector3(L.head[0], L.head[1] - FACE_DROP - 0.15, L.head[2]) : new THREE.Vector3(0, 1.8, 0)), [L]);
  const tableHit = useMemo(() => (L ? new THREE.Vector3(L.cards[0], TABLE_Y + 0.05, L.cards[2]) : new THREE.Vector3(0, TABLE_Y, 0)), [L]);
  const scale = seq.cut === 'short' ? 0.6 : 1;

  // 烟雾：每片独立的材质（独立透明度），卸载时全部释放
  const smokeTex = useMemo(() => smokeTexture(), []);
  const smoke = useMemo(() => {
    const n = Math.max(3, Math.round(prof.smoke * scale));
    return Array.from({ length: n }, (_, i) => {
      // 深浅不一的暖灰：靠近地面的更暗，上面被吊灯照亮的稍亮
      const mat = new THREE.SpriteMaterial({ map: smokeTex, color: new THREE.Color().setHSL(0.07, 0.1, 0.1 + Math.random() * 0.16), transparent: true, opacity: 0, depthWrite: false });
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const sp = 0.5 + Math.random() * 1.1;
      // 一部分从桌面（输家的牌）爆开，一部分在输家身边
      const low = i % 3 === 0;
      const from = low ? tableHit : head;
      return {
        mat,
        start: from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.2) * 0.35, (Math.random() - 0.5) * 0.5)),
        v: new THREE.Vector3(Math.cos(a) * sp, (low ? 0.15 : 0.2) + Math.random() * 0.45, Math.sin(a) * sp),
        size: 0.3 + Math.random() * 0.35,
        grow: 1.2 + Math.random() * 1.4,
        life: 2.6 + Math.random() * 1.8,
        rot: (Math.random() - 0.5) * 0.8,
        peak: 0.22 + Math.random() * 0.2,
      };
    });
  }, [prof.smoke, scale, head, tableHit, smokeTex]);
  const sprites = useRef<(THREE.Sprite | null)[]>([]);

  // 灰尘与碎屑、纸牌碎片、散开的筹码
  const debris = useMemo(() => burstParticles(Math.round(prof.debris * scale), head, [0.6, 2.6], [1.2, 3.6], [0.012, 0.035]), [prof.debris, scale, head]);
  const frags = useMemo(() => burstParticles(Math.round(prof.fragments * scale), tableHit, [0.8, 2.2], [2.2, 4.2], [0.05, 0.11]), [prof.fragments, scale, tableHit]);
  const chips = useMemo(() => burstParticles(Math.round(prof.looseChips * scale), tableHit, [0.5, 1.4], [0.8, 1.8], [1, 1]), [prof.looseChips, scale, tableHit]);
  const dustGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const dustMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#c9b394', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }), []);
  const fragGeo = useMemo(() => new THREE.PlaneGeometry(0.7, 1), []);
  const fragMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f3eee2', roughness: 0.7, side: THREE.DoubleSide, transparent: true }), []);
  const chipGeo = useMemo(() => new THREE.CylinderGeometry(0.075, 0.075, 0.022, 18), []);
  const chipMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8c1d2b', roughness: 0.45, metalness: 0.1 }), []);
  useEffect(
    () => () => {
      smokeTex.dispose();
      for (const s of smoke) s.mat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      fragGeo.dispose();
      fragMat.dispose();
      chipGeo.dispose();
      chipMat.dispose();
    },
    [smokeTex, smoke, dustGeo, dustMat, fragGeo, fragMat, chipGeo, chipMat],
  );
  const dustRef = useRef<THREE.InstancedMesh>(null!);
  const fragRef = useRef<THREE.InstancedMesh>(null!);
  const chipRef = useRef<THREE.InstancedMesh>(null!);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const t0 = seq.at.impact;
    if (t0 === undefined) return syncPhase(performance.now());
    const now = performance.now();
    syncPhase(now);
    const t = (now - t0) / 1000;
    // 冲击之前也保持挂载并参与渲染（透明 / 缩放为 0）：材质在演出开始时就编译好，冲击那一刻不会卡顿
    const visible = true;
    const before = t < 0;
    // 烟雾：爆开（0.12 秒）→ 扩散 → 慢慢散去
    smoke.forEach((s, i) => {
      const sp = sprites.current[i];
      if (!sp) return;
      sp.visible = visible && t < s.life;
      if (!sp.visible) return;
      if (before) {
        sp.position.copy(s.start);
        sp.scale.setScalar(0.001);
        s.mat.opacity = 0;
        return;
      }
      const k = 1 - Math.exp(-t * 1.6);
      sp.position.set(s.start.x + s.v.x * k * 1.4, s.start.y + s.v.y * k * 1.6 + t * 0.05, s.start.z + s.v.z * k * 1.4);
      const sc = s.size * (1 + s.grow * (1 - Math.exp(-t * 1.2)));
      sp.scale.set(sc, sc, 1);
      s.mat.rotation = s.rot * t;
      const fadeIn = Math.min(1, t / 0.12);
      const fadeOut = Math.max(0, 1 - t / s.life);
      s.mat.opacity = s.peak * fadeIn * fadeOut * fadeOut;
    });
    // 灰尘：抛出去落到桌面，然后慢慢消失
    if (dustRef.current) {
      dustRef.current.visible = visible && t < 3.2;
      debris.forEach((pt, i) => {
        ballistic(pt, Math.max(0, t), TABLE_Y + 0.004, tmp);
        tmpObj.position.copy(tmp);
        tmpObj.rotation.set(pt.spin.x * t, pt.spin.y * t, pt.spin.z * t);
        tmpObj.scale.setScalar(before ? 0.0001 : pt.size);
        tmpObj.updateMatrix();
        dustRef.current.setMatrixAt(i, tmpObj.matrix);
      });
      dustRef.current.instanceMatrix.needsUpdate = true;
      dustMat.opacity = before ? 0 : 0.85 * Math.max(0, Math.min(1, (3.2 - t) / 1.2));
    }
    // 纸牌碎片：旋转着飞起，落在桌上
    if (fragRef.current) {
      fragRef.current.visible = visible && t < 4.5;
      frags.forEach((pt, i) => {
        const landed = ballistic(pt, Math.max(0, t), TABLE_Y + 0.006, tmp);
        tmpObj.position.copy(tmp);
        if (landed) tmpObj.rotation.set(-Math.PI / 2, pt.spin.y, 0);
        else tmpObj.rotation.set(pt.spin.x * t, pt.spin.y * t, pt.spin.z * t);
        tmpObj.scale.setScalar(before ? 0.0001 : pt.size);
        tmpObj.updateMatrix();
        fragRef.current.setMatrixAt(i, tmpObj.matrix);
      });
      fragRef.current.instanceMatrix.needsUpdate = true;
      fragMat.opacity = before ? 0 : Math.max(0, Math.min(1, (4.5 - t) / 1.2));
    }
    // 散开的筹码：跳起、滑开、停住
    if (chipRef.current) {
      chipRef.current.visible = visible;
      chips.forEach((pt, i) => {
        const landed = ballistic(pt, Math.max(0, t), TABLE_Y + 0.012, tmp);
        tmpObj.position.copy(tmp);
        if (landed) tmpObj.rotation.set(0, pt.spin.y * 0.2, 0);
        else tmpObj.rotation.set(pt.spin.x * t * 0.6, 0, pt.spin.z * t * 0.6);
        tmpObj.scale.setScalar(before ? 0.0001 : 1);
        tmpObj.updateMatrix();
        chipRef.current.setMatrixAt(i, tmpObj.matrix);
      });
      chipRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {smoke.map((s, i) => (
        <sprite key={i} ref={(r) => (sprites.current[i] = r)} material={s.mat} visible={false} renderOrder={5} />
      ))}
      {debris.length > 0 && <instancedMesh ref={dustRef} args={[dustGeo, dustMat, debris.length]} visible={false} frustumCulled={false} />}
      {frags.length > 0 && <instancedMesh ref={fragRef} args={[fragGeo, fragMat, frags.length]} visible={false} frustumCulled={false} castShadow />}
      {chips.length > 0 && <instancedMesh ref={chipRef} args={[chipGeo, chipMat, chips.length]} visible={false} frustumCulled={false} castShadow />}
    </group>
  );
}

/** 失败演出的 3D 部分：只在演出期间挂载（灯光变化在 SceneLights / WinnerLight 里，不新增灯光） */
export function DefeatFX({ layout }: { layout: Map<string, SeatLayout> }) {
  const seq = useDefeat((s) => s.seq);
  const skipped = useDefeat((s) => s.skipped);
  if (!seq || skipped) return null;
  return <ImpactBurst key={seq.key} seq={seq} layout={layout} />;
}

/**
 * 预热：在牌桌上一直挂着一组几乎看不见的同类型材质（缩放接近 0，藏在桌面下），
 * 让烟雾 / 灰尘 / 碎片 / 筹码的着色器在进入牌桌时就编译好——演出开始和冲击时不会因为编译着色器而卡顿。
 */
export function DefeatWarmup() {
  const res = useMemo(() => {
    const tex = smokeTexture();
    return {
      tex,
      sprite: new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }),
      dustGeo: new THREE.PlaneGeometry(1, 1),
      dust: new THREE.MeshBasicMaterial({ color: '#c9b394', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
      fragGeo: new THREE.PlaneGeometry(0.7, 1),
      frag: new THREE.MeshStandardMaterial({ color: '#f3eee2', roughness: 0.7, side: THREE.DoubleSide, transparent: true }),
      chipGeo: new THREE.CylinderGeometry(0.075, 0.075, 0.022, 18),
      chip: new THREE.MeshStandardMaterial({ color: '#8c1d2b', roughness: 0.45, metalness: 0.1 }),
    };
  }, []);
  useEffect(
    () => () => {
      res.tex.dispose();
      res.sprite.dispose();
      res.dustGeo.dispose();
      res.dust.dispose();
      res.fragGeo.dispose();
      res.frag.dispose();
      res.chipGeo.dispose();
      res.chip.dispose();
    },
    [res],
  );
  const tiny = (m: THREE.InstancedMesh | null) => {
    if (!m) return;
    tmpObj.position.set(0, -5, 0);
    tmpObj.rotation.set(0, 0, 0);
    tmpObj.scale.setScalar(0.0001);
    tmpObj.updateMatrix();
    m.setMatrixAt(0, tmpObj.matrix);
    m.instanceMatrix.needsUpdate = true;
  };
  return (
    <group position={[0, -5, 0]}>
      <sprite material={res.sprite} scale={0.0001} />
      <instancedMesh ref={tiny} args={[res.dustGeo, res.dust, 1]} frustumCulled={false} />
      <instancedMesh ref={tiny} args={[res.fragGeo, res.frag, 1]} frustumCulled={false} castShadow />
      <instancedMesh ref={tiny} args={[res.chipGeo, res.chip, 1]} frustumCulled={false} castShadow />
    </group>
  );
}

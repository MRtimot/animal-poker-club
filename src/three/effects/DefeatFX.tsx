// 失败演出的 3D 效果（只在演出期间挂载，结束后全部卸载并释放显存）：
// · 灯光：克制的暗红轮廓光（危险信号）、孤立输家的冷色顶光、冲击瞬间的闪光
// · 冲击：烟雾（爆开 → 扩散 → 慢慢散去）、灰尘与碎屑、纸牌碎片、散开的筹码
// · 出局处决（完整版）：头部脱离身体（头部的复制品沿预先算好的轨迹翻滚、落地、弹起、滚动、停住），
//   断开处迸出风格化的暗红 / 黑色碎片（简化的细长粒子，很快消失）——没有写实的伤口、身体内部或血液模拟。
// 粒子数量按设备档位（手机 / 低画质 / 减少动态效果）减少。
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { setDefeatPhase, useDefeat, type DefeatSequence } from '../../animation/defeat/defeatStore';
import { DECAP_CUT_MS, PHASE_ORDER, type DefeatPhase } from '../../animation/defeat/defeatRules';
import { getHead, headLaunch, sampleHeadFall, simulateHeadFall, type HeadFall } from '../../animation/defeat/decapitation';
import { sound } from '../../audio/sound';
import { useFx } from '../../store/fxStore';
import { TABLE_Y, type SeatLayout } from '../layout';
import { FACE_DROP } from '../camera/defeatCamera';

const GRAVITY = -7.5;

/**
 * 每个阶段的红色轮廓光与孤立输家的顶光强度（0~1）。
 * 注意：演出不新增任何灯光（新增 / 显示灯光会让 three.js 重新编译所有材质，造成明显卡顿）：
 * 红色轮廓光复用场景的轮廓光（SceneLights），孤立顶光复用赢家聚光灯（WinnerLight），闪光是现有灯光的瞬间增亮。
 */
export const DEFEAT_RED: Partial<Record<DefeatPhase, number>> = {
  reaction: 0.3,
  tension: 0.85,
  lastword: 0.9,
  prep: 1,
  ecu: 1,
  insert: 1,
  silence: 0.95,
  impact: 1,
  headfall: 0.95,
  collapse: 0.8,
  // 余波：暗红慢慢褪去，黑屏前完全消失
  aftermath: 0.45,
  blackout: 0,
  defeated: 0,
};
export const DEFEAT_ISOLATE: Partial<Record<DefeatPhase, number>> = {
  realize: 0.55,
  winner: 0.5,
  reaction: 0.8,
  tension: 1,
  lastword: 1,
  prep: 1,
  ecu: 1,
  insert: 0.9,
  silence: 0.9,
  impact: 0.7,
  headfall: 0.85,
  collapse: 0.85,
  aftermath: 0.75,
  blackout: 0.5,
  defeated: 0.4,
};

/** 地面高度（地毯表面稍高一点） */
const FLOOR_Y = 0.01;

/**
 * 当前这一帧的房间灯光状态（SceneLights 每帧写入）：环境里的壁灯、桌边与烟雾按它变暗、染上克制的暗红。
 * red：0~1 暗红强度；env：0~1 房间亮度倍率；flash：冲击闪光 0~1。
 */
export const defeatAccent = { red: 0, env: 1, flash: 0 };

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
function smokeTexture(res = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = res;
  const g = c.getContext('2d')!;
  const u = res / 128;
  for (let i = 0; i < 7; i++) {
    const x = res / 2 + (Math.random() - 0.5) * 34 * u;
    const y = res / 2 + (Math.random() - 0.5) * 34 * u;
    const r = (26 + Math.random() * 30) * u;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.32)');
    grd.addColorStop(0.55, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, res, res);
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
const tmpV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

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
  const smokeTex = useMemo(() => smokeTexture(prof.smokeRes), [prof.smokeRes]);
  const smoke = useMemo(() => {
    const n = Math.max(3, Math.round(prof.smoke * scale));
    return Array.from({ length: n }, (_, i) => {
      // 深浅不一的暖灰：靠近地面的更暗，上面被吊灯照亮的稍亮
      const tone = new THREE.Color().setHSL(0.07, 0.1, 0.1 + Math.random() * 0.16);
      const mat = new THREE.SpriteMaterial({ map: smokeTex, color: tone.clone(), transparent: true, opacity: 0, depthWrite: false });
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
      const sp = 0.5 + Math.random() * 1.1;
      // 一部分从桌面（输家的牌）爆开，一部分在输家身边
      const low = i % 3 === 0;
      const from = low ? tableHit : head;
      return {
        mat,
        tone,
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
  // 火星：很少、很短，从桌面迸出（与灰尘同一种材质类型，不会触发新的着色器编译）
  const sparks = useMemo(() => burstParticles(Math.round(prof.sparks * scale), tableHit, [2.2, 4.6], [0.8, 2.6], [0.35, 0.7]), [prof.sparks, scale, tableHit]);
  const sparkMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffb05a', transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }), []);
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
      sparkMat.dispose();
    },
    [smokeTex, smoke, dustGeo, dustMat, fragGeo, fragMat, chipGeo, chipMat, sparkMat],
  );
  const sparkRef = useRef<THREE.InstancedMesh>(null!);
  const dustRef = useRef<THREE.InstancedMesh>(null!);
  const fragRef = useRef<THREE.InstancedMesh>(null!);
  const chipRef = useRef<THREE.InstancedMesh>(null!);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const smokeTint = useMemo(() => new THREE.Color(), []);

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
      // 烟雾跟着房间的灯光变化：闪光时被照亮，房间变暗时跟着变暗，红光里带一点暗红
      const lit = 0.55 + 0.6 * defeatAccent.env + defeatAccent.flash * 1.6;
      s.mat.color.copy(s.tone).multiplyScalar(lit).lerp(smokeTint.set('#3a0c10'), defeatAccent.red * 0.3);
    });
    // 火星：0.6 秒内迸出、拉成细线、熄灭
    if (sparkRef.current) {
      sparkRef.current.visible = visible && t < 0.8;
      sparks.forEach((pt, i) => {
        const tt = Math.max(0, t - pt.delay);
        const life = pt.size;
        ballistic(pt, Math.max(0, t), TABLE_Y + 0.004, tmp);
        tmpObj.position.copy(tmp);
        tmpV.set(pt.v.x, pt.v.y + GRAVITY * tt, pt.v.z).normalize();
        tmpObj.quaternion.setFromUnitVectors(UP, tmpV);
        const k = before || tt > life ? 0.0001 : 1 - tt / life;
        tmpObj.scale.set(0.012 * k, 0.11 * k, 1);
        tmpObj.updateMatrix();
        sparkRef.current.setMatrixAt(i, tmpObj.matrix);
      });
      sparkRef.current.instanceMatrix.needsUpdate = true;
    }
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
      {sparks.length > 0 && <instancedMesh ref={sparkRef} args={[dustGeo, sparkMat, sparks.length]} visible={false} frustumCulled={false} />}
      {frags.length > 0 && <instancedMesh ref={fragRef} args={[fragGeo, fragMat, frags.length]} visible={false} frustumCulled={false} castShadow={prof.shadows} />}
      {chips.length > 0 && <instancedMesh ref={chipRef} args={[chipGeo, chipMat, chips.length]} visible={false} frustumCulled={false} castShadow={prof.shadows} />}
    </group>
  );
}

interface Shard {
  v: THREE.Vector3;
  len: number;
  width: number;
  life: number;
  delay: number;
}

/** 断开处迸出的风格化碎片：细长的暗红 / 黑色粒子，从断开处向上、向两侧散开，0.4~0.8 秒内缩小消失 */
function makeShards(n: number, along: THREE.Vector3): Shard[] {
  const out: Shard[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 1.2 + Math.random() * 2.6;
    out.push({
      v: new THREE.Vector3(Math.cos(a) * sp * 0.6 + along.x * 0.6, 1.4 + Math.random() * 2.4, Math.sin(a) * sp * 0.6 + along.z * 0.6),
      len: 0.07 + Math.random() * 0.14,
      width: 0.018 + Math.random() * 0.02,
      life: 0.4 + Math.random() * 0.4,
      delay: Math.random() * 0.05,
    });
  }
  return out;
}

const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpQ2 = new THREE.Quaternion();
const tmpBox = new THREE.Box3();
const restPose = new THREE.Object3D();
const tmpSize = new THREE.Vector3();

/**
 * 出局处决：头部脱离身体并掉落。
 * 斩首那一刻（冲击 + DECAP_CUT_MS，这时镜头正切开到桌面）：隐藏输家原来的头部，在同一位置放一个复制品
 * （共用原来的几何体与材质：不上传新的显存、不编译新的着色器），复制品沿预先算好的轨迹运动；
 * 每次落地播放一声闷响，开始滚动时播放滚动声。卸载（演出结束 / 跳过 / 离开牌桌）时移除复制品、恢复原来的头部。
 */
function SeveredHead({ seq, layout }: { seq: DefeatSequence; layout: Map<string, SeatLayout> }) {
  const L = layout.get(seq.loserId);
  const prof = seq.profile;
  const root = useRef<THREE.Group>(null!);
  const st = useRef<{
    done: boolean;
    src: THREE.Object3D | null;
    clone: THREE.Object3D | null;
    fall: HeadFall | null;
    q0: THREE.Quaternion;
    neck: THREE.Vector3;
    played: number;
    rolled: boolean;
    restQ: THREE.Quaternion;
    settle: [number, number];
  }>({
    done: false,
    src: null,
    clone: null,
    fall: null,
    q0: new THREE.Quaternion(),
    neck: new THREE.Vector3(),
    played: 0,
    rolled: false,
    restQ: new THREE.Quaternion(),
    settle: [Infinity, Infinity],
  });
  const side = useMemo(() => {
    const d = L ? new THREE.Vector2(L.seat[0], L.seat[2]).normalize() : new THREE.Vector2(0, 1);
    const sg = seq.decap?.side ?? 1;
    return { dir: [d.x, d.y] as [number, number], side: [-d.y * sg, d.x * sg] as [number, number] };
  }, [L, seq.decap?.side]);
  // 暗红与近黑两种颜色：两个同类型的材质（与灰尘 / 火星完全相同的设置，共用已经编译好的着色器）
  const nRed = Math.max(4, Math.round(prof.fragments * 1.3));
  const nDark = Math.max(2, Math.round(prof.fragments * 0.6));
  const shardGeo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const redMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#5e0b17', transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false }), []);
  const darkMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#140507', transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false }), []);
  const shards = useMemo(() => {
    const along = new THREE.Vector3(side.side[0], 0, side.side[1]);
    return { red: makeShards(nRed, along), dark: makeShards(nDark, along) };
  }, [nRed, nDark, side]);
  const redRef = useRef<THREE.InstancedMesh>(null!);
  const darkRef = useRef<THREE.InstancedMesh>(null!);

  useEffect(
    () => () => {
      const s = st.current;
      if (s.clone) s.clone.removeFromParent();
      // 复制品与原来的头部共用几何体与材质：只移除，不释放（释放会让原来的头部也消失）
      if (s.src) s.src.visible = true;
      s.clone = null;
      s.src = null;
      shardGeo.dispose();
      redMat.dispose();
      darkMat.dispose();
    },
    [shardGeo, redMat, darkMat],
  );

  const updateShards = (mesh: THREE.InstancedMesh | null, list: Shard[], t: number, neck: THREE.Vector3) => {
    if (!mesh) return;
    mesh.visible = t >= 0 && t < 1;
    list.forEach((sh, i) => {
      const tt = t - sh.delay;
      const alive = tt >= 0 && tt < sh.life;
      const k = alive ? 1 - tt / sh.life : 0;
      tmpObj.position.set(neck.x + sh.v.x * Math.max(0, tt), neck.y + sh.v.y * Math.max(0, tt) + 0.5 * GRAVITY * Math.max(0, tt) * Math.max(0, tt), neck.z + sh.v.z * Math.max(0, tt));
      tmpV.set(sh.v.x, sh.v.y + GRAVITY * Math.max(0, tt), sh.v.z).normalize();
      tmpObj.quaternion.setFromUnitVectors(UP, tmpV);
      tmpObj.scale.set(alive ? sh.width * (0.4 + 0.6 * k) : 0.0001, alive ? sh.len * (0.5 + 0.5 * k) : 0.0001, 1);
      tmpObj.updateMatrix();
      mesh.setMatrixAt(i, tmpObj.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  useFrame(() => {
    const t0 = seq.at.impact;
    if (t0 === undefined || !L) return;
    const cutAt = t0 + DECAP_CUT_MS;
    const now = performance.now();
    const s = st.current;
    if (!s.done && now >= cutAt) {
      s.done = true;
      const src = getHead(seq.loserId);
      if (src && root.current) {
        src.updateWorldMatrix(true, true);
        src.matrixWorld.decompose(tmpPos, tmpQuat, tmpScale);
        const clone = src.clone(true);
        clone.name = 'severed-head';
        clone.visible = true;
        clone.position.copy(tmpPos);
        clone.quaternion.copy(tmpQuat);
        clone.scale.copy(tmpScale);
        root.current.add(clone);
        // 头部的近似半径：水平尺寸的一半（不算帽子的高度）
        tmpBox.setFromObject(src).getSize(tmpSize);
        const radius = Math.max(0.12, ((tmpSize.x + tmpSize.z) / 4) * 0.85);
        const { vel, spin } = headLaunch(side.dir, side.side);
        s.fall = simulateHeadFall({ start: [tmpPos.x, tmpPos.y, tmpPos.z], vel, spin, radius, floorY: FLOOR_Y });
        s.q0.copy(tmpQuat);
        s.neck.set(tmpPos.x, tmpPos.y - radius * 0.75, tmpPos.z);
        // 停住时的朝向：脸（头部的 +Z）转向镜头所在的一侧，微微仰起、侧躺——一眼就能认出是这只动物的头
        // （最后一次落地之后的滚动里慢慢转到这个朝向）
        const fwd = tmpV.set(side.side[0] * 2.9 + side.dir[0] * 1.3, 0, side.side[1] * 2.9 + side.dir[1] * 1.3).normalize();
        restPose.position.set(0, 0, 0);
        restPose.quaternion.identity();
        restPose.lookAt(fwd);
        restPose.rotateX(-0.45);
        restPose.rotateZ(0.55 * (seq.decap?.side ?? 1));
        s.restQ.copy(restPose.quaternion);
        const lastHit = s.fall.contacts.length ? s.fall.contacts[s.fall.contacts.length - 1].t : 0.6;
        s.settle = [lastHit, Math.max(lastHit + 0.5, s.fall.restAt + 0.25)];
        src.visible = false;
        s.src = src;
        s.clone = clone;
      }
    }
    const t = (now - cutAt) / 1000;
    if (s.clone && s.fall) {
      const { p, q } = sampleHeadFall(s.fall, t);
      s.clone.position.set(p[0], p[1], p[2]);
      s.clone.quaternion.copy(tmpQ2.set(q[0], q[1], q[2], q[3]).multiply(s.q0));
      const [a, b] = s.settle;
      if (t > a) {
        const x = Math.min(1, (t - a) / (b - a));
        s.clone.quaternion.slerp(s.restQ, x * x * (3 - 2 * x));
      }
      // 落地的闷响与画面同步；第一次落地时镜头轻轻一震
      const contacts = s.fall.contacts;
      while (s.played < contacts.length && contacts[s.played].t <= t) {
        const c = contacts[s.played++];
        sound.cineThud(c.speed);
        if (s.played === 1 && !seq.reduced) useFx.getState().doShake(prof.shake * 0.35);
      }
      if (!s.rolled && contacts.length && t >= contacts[contacts.length - 1].t + 0.02) {
        s.rolled = true;
        sound.cineRoll(Math.max(0.2, s.fall.restAt - contacts[contacts.length - 1].t));
      }
    }
    if (s.clone) {
      updateShards(redRef.current, shards.red, t, s.neck);
      updateShards(darkRef.current, shards.dark, t, s.neck);
    }
  });

  return (
    <group ref={root}>
      <instancedMesh ref={redRef} args={[shardGeo, redMat, shards.red.length]} visible={false} frustumCulled={false} />
      <instancedMesh ref={darkRef} args={[shardGeo, darkMat, shards.dark.length]} visible={false} frustumCulled={false} />
    </group>
  );
}

/** 失败演出的 3D 部分：只在演出期间挂载（灯光变化在 SceneLights / WinnerLight 里，不新增灯光） */
export function DefeatFX({ layout }: { layout: Map<string, SeatLayout> }) {
  const seq = useDefeat((s) => s.seq);
  const skipped = useDefeat((s) => s.skipped);
  if (!seq || skipped) return null;
  return (
    <>
      <ImpactBurst key={seq.key} seq={seq} layout={layout} />
      {seq.cut === 'full' && seq.decap && <SeveredHead key={seq.key + '-head'} seq={seq} layout={layout} />}
    </>
  );
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

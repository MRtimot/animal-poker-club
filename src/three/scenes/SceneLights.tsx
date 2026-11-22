import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { useSettings, type Quality } from '../../store/settingsStore';
import { useFx } from '../../store/fxStore';
import { damp, ease } from '../../animation/motion';
import { LAMP_Y } from '../environment/ClubEnvironment';

/** 不同牌局状态下的灯光：[环境亮度, 桌面主光] —— 变化自然、克制，不做 RGB 灯光秀 */
const STATE_LIGHT: Record<string, [number, number]> = {
  none: [1, 1],
  action: [0.95, 1.02],
  flop: [0.9, 1.08],
  turn: [0.88, 1.1],
  river: [0.78, 1.14],
  allin: [0.55, 1.16],
  showdown: [0.66, 1.18],
  win: [0.72, 1.06],
  intro: [1, 1],
};

const FILL = {
  casino: { hemiSky: '#ffd9b0', hemiGround: '#2a1610', rim: '#9ab8ff', fill: '#ff9a60' },
  penthouse: { hemiSky: '#cfd8ff', hemiGround: '#1c1a20', rim: '#8fb0ff', fill: '#ffc890' },
  cabin: { hemiSky: '#ffd0a0', hemiGround: '#2a1a10', rim: '#a0b8ff', fill: '#ff8a40' },
} as const;

/**
 * 灯光系统：吊灯主光（带阴影，照亮桌面）+ 冷色轮廓光 + 暖色补光 + 低强度环境光。
 * 读取牌局状态（镜头提示 / 大底池紧张度）平滑调整亮度。
 */
export function SceneLights({ quality }: { quality: Quality }) {
  const room = useSettings((s) => s.room);
  const C = FILL[room];
  const shadows = quality !== 'low';
  const mapSize = quality === 'ultra' ? 4096 : quality === 'high' ? 2048 : 1024;
  const spot = useRef<THREE.SpotLight>(null!);
  const hemi = useRef<THREE.HemisphereLight>(null!);
  const amb = useRef<THREE.AmbientLight>(null!);
  const rim = useRef<THREE.DirectionalLight>(null!);
  const born = useRef(performance.now());
  const lv = useRef({ env: 1, key: 1 });

  useFrame((_, dt) => {
    const now = performance.now();
    // 场景出现时灯光逐渐亮起
    const intro = 0.1 + 0.9 * ease.inOutSine(Math.min(1, (now - born.current) / 1800));
    const fx = useFx.getState();
    const cue = fx.cue;
    const [envW, keyW] = STATE_LIGHT[cue ? cue.type : 'none'] ?? STATE_LIGHT.none;
    // 大底池：环境略暗、桌面略亮
    const t = fx.tension;
    const l = fx.light;
    const lt = (now - l.start) / l.duration;
    const pulse = l.duration > 0 && lt >= 0 && lt < 1 ? l.level * Math.min(1, lt * 5) * (1 - ease.inQuad(lt)) : 0;
    lv.current.env = damp(lv.current.env, envW * (1 - t * 0.18), 1.6, dt);
    lv.current.key = damp(lv.current.key, keyW * (1 + t * 0.08) * (1 + pulse * 0.12), 1.8, dt);
    const env = lv.current.env * intro;
    if (spot.current) spot.current.intensity = 165 * intro * lv.current.key;
    if (hemi.current) hemi.current.intensity = 0.32 * env;
    if (amb.current) amb.current.intensity = 0.08 * env;
    if (rim.current) rim.current.intensity = 0.55 * env;
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={[C.hemiSky, C.hemiGround, 0.32]} />
      <ambientLight ref={amb} intensity={0.08} color="#ffe2c0" />
      {/* 主光：吊灯向下照亮牌桌，产生清晰的接触阴影 */}
      <spotLight
        ref={spot}
        position={[0, LAMP_Y - 0.1, 0.2]}
        angle={0.72}
        penumbra={0.65}
        intensity={165}
        decay={2}
        color="#ffe4bd"
        castShadow={shadows}
        shadow-mapSize-width={mapSize}
        shadow-mapSize-height={mapSize}
        shadow-camera-near={3}
        shadow-camera-far={12}
        shadow-bias={-0.00025}
        shadow-normalBias={0.015}
        shadow-radius={quality === 'medium' ? 2 : 4}
      />
      {/* 轮廓光：从房间深处打来的冷色光，勾勒动物与筹码的边缘 */}
      <directionalLight ref={rim} position={[-6, 7, -9]} intensity={0.55} color={C.rim} />
      {/* 暖色补光：模拟壁灯反射，避免暗部死黑 */}
      <pointLight position={[7, 4.2, 6]} intensity={14} color={C.fill} distance={16} decay={2} />
      <pointLight position={[-7, 4.2, 5]} intensity={8} color={C.fill} distance={14} decay={2} />
    </>
  );
}

/**
 * 本地生成的环境反射（不加载任何外部 HDR 文件）：给金属、漆面、玻璃和眼睛提供真实的反射。
 * 在整个画布里只挂载一次（App 中），切换场景时不会重新生成——
 * 之前每个场景各自挂载一份，每次切换页面都会在显卡上残留约 2 张贴图（内存泄漏）。
 */
export function SharedEnvironment() {
  const quality = useSettings((s) => s.quality);
  const room = useSettings((s) => s.room);
  if (quality === 'low') return null;
  return (
    <Environment resolution={quality === 'medium' ? 64 : 256} frames={1}>
      <Lightformer intensity={2.2} color="#ffe2b8" position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[5, 5, 1]} form="circle" />
      <Lightformer intensity={0.5} color="#ffb070" position={[-8, 2.5, 0]} rotation-y={Math.PI / 2} scale={[10, 2, 1]} />
      <Lightformer intensity={0.45} color="#ffb070" position={[8, 2.5, 0]} rotation-y={-Math.PI / 2} scale={[10, 2, 1]} />
      <Lightformer intensity={0.3} color={room === 'penthouse' ? '#8fa8ff' : '#ffcf90'} position={[0, 3, -9]} scale={[14, 4, 1]} />
    </Environment>
  );
}

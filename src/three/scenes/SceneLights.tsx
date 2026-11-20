import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import type { Quality } from '../../store/settingsStore';
import { useFx } from '../../store/fxStore';
import { ease } from '../../animation/motion';

/** 暖色俱乐部灯光：吊灯主光（带阴影）+ 半球环境光 + 暖色补光 */
export function SceneLights({ quality }: { quality: Quality }) {
  const shadows = quality !== 'low';
  const mapSize = quality === 'ultra' ? 2048 : quality === 'high' ? 2048 : 1024;
  const spot = useRef<THREE.SpotLight>(null!);
  const hemi = useRef<THREE.HemisphereLight>(null!);
  const born = useRef(performance.now());
  // 灯光控制：场景出现时逐渐亮起；全押 / 获胜时桌面灯光增强，然后缓慢恢复
  useFrame(() => {
    const now = performance.now();
    const intro = 0.12 + 0.88 * ease.inOutSine(Math.min(1, (now - born.current) / 1600));
    const l = useFx.getState().light;
    const lt = (now - l.start) / l.duration;
    const boost = l.duration > 0 && lt >= 0 && lt < 1 ? l.level * Math.min(1, lt * 6) * (1 - ease.inQuad(lt)) : 0;
    if (spot.current) spot.current.intensity = 140 * intro * (1 + boost * 0.7);
    if (hemi.current) hemi.current.intensity = 0.55 * (0.4 + intro * 0.6) * (1 - boost * 0.25);
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={['#ffe2b8', '#3a2418', 0.55]} />
      <ambientLight intensity={0.18} color="#ffd9a8" />
      <spotLight
        ref={spot}
        position={[0, 8.4, 0.5]}
        angle={0.62}
        penumbra={0.55}
        intensity={140}
        decay={2}
        color="#ffe7c0"
        castShadow={shadows}
        shadow-mapSize-width={mapSize}
        shadow-mapSize-height={mapSize}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <pointLight position={[7, 4.5, 6]} intensity={30} color="#ff9a5a" distance={18} decay={2} />
      <pointLight position={[-7, 4.5, -6]} intensity={26} color="#ff7ab0" distance={18} decay={2} />
      <pointLight position={[0, 4, -10]} intensity={18} color="#7ad8ff" distance={16} decay={2} />
      {(quality === 'high' || quality === 'ultra') && (
        // 本地生成的环境反射（不加载任何外部 HDR 文件）
        <Environment resolution={128} frames={1}>
          <Lightformer intensity={2} color="#ffd9a0" position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[8, 8, 1]} />
          <Lightformer intensity={1.2} color="#ff7ab0" position={[-8, 3, 0]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} />
          <Lightformer intensity={1.2} color="#7ad8ff" position={[8, 3, 0]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} />
        </Environment>
      )}
    </>
  );
}

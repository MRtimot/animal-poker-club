import * as THREE from 'three';

// 共享几何体与材质缓存：降低内存占用与 GPU 状态切换
export const GEO = {
  sphere: new THREE.SphereGeometry(1, 28, 20),
  sphereLow: new THREE.SphereGeometry(1, 14, 10),
  halfSphere: new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 24),
  cylOpen: new THREE.CylinderGeometry(1, 1, 1, 24, 1, true),
  cone: new THREE.ConeGeometry(1, 1, 20),
  box: new THREE.BoxGeometry(1, 1, 1),
  capsule: new THREE.CapsuleGeometry(1, 1, 6, 12),
  torus: new THREE.TorusGeometry(1, 0.12, 10, 32),
  torusThin: new THREE.TorusGeometry(1, 0.05, 8, 32),
  halfTorus: new THREE.TorusGeometry(1, 0.08, 8, 24, Math.PI),
  arc: new THREE.TorusGeometry(1, 0.18, 8, 16, Math.PI),
};

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: string, opts: { rough?: number; metal?: number; emissive?: string; ei?: number; opacity?: number } = {}) {
  const key = `${color}|${opts.rough ?? 0.75}|${opts.metal ?? 0}|${opts.emissive ?? ''}|${opts.ei ?? 0}|${opts.opacity ?? 1}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.75,
      metalness: opts.metal ?? 0,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
    });
    if (opts.emissive) {
      m.emissive.set(opts.emissive);
      m.emissiveIntensity = opts.ei ?? 1;
    }
    matCache.set(key, m);
  }
  return m;
}

export function shade(hex: string, factor: number): string {
  const c = new THREE.Color(hex);
  if (factor >= 1) c.lerp(new THREE.Color('#ffffff'), Math.min(1, factor - 1));
  else c.multiplyScalar(factor);
  return '#' + c.getHexString();
}

export const GOLD = { rough: 0.25, metal: 0.9 };

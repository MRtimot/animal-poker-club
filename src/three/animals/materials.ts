import * as THREE from 'three';
import { fabricNormal, furNormal, leatherNormal } from '../realism';

/** 表面类型：毛发 / 织物（斜纹、针织、帆布）/ 皮革 */
export type Surface = 'fur' | 'twill' | 'knit' | 'canvas' | 'leather';

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

export function mat(color: string, opts: { rough?: number; metal?: number; emissive?: string; ei?: number; opacity?: number; surface?: Surface } = {}) {
  const key = `${color}|${opts.rough ?? 0.75}|${opts.metal ?? 0}|${opts.emissive ?? ''}|${opts.ei ?? 0}|${opts.opacity ?? 1}|${opts.surface ?? ''}`;
  let m = matCache.get(key);
  if (!m && opts.surface && !opts.emissive && !opts.metal && (opts.opacity ?? 1) >= 1) {
    const c = new THREE.Color(color);
    const sf = opts.surface;
    if (sf === 'fur') {
      // 毛发近似：顺毛方向的法线 + sheen（掠射角的柔和光晕，像真实毛发的轮廓光）
      m = new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.82,
        normalMap: furNormal(),
        normalScale: new THREE.Vector2(0.55, 0.55),
        sheen: 1,
        sheenRoughness: 0.5,
        sheenColor: c.clone().lerp(new THREE.Color('#ffffff'), 0.45),
      });
    } else if (sf === 'leather') {
      m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4, normalMap: leatherNormal(), normalScale: new THREE.Vector2(0.4, 0.4) });
    } else {
      // 织物：细小的编织法线 + 轻微 sheen
      m = new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.88,
        normalMap: fabricNormal(sf),
        normalScale: new THREE.Vector2(0.45, 0.45),
        sheen: 0.5,
        sheenRoughness: 0.7,
        sheenColor: c.clone().lerp(new THREE.Color('#ffffff'), 0.25),
      });
    }
    matCache.set(key, m);
  }
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

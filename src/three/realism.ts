// 写实材质：程序化生成的 PBR 贴图（颜色 / 法线 / 粗糙度），不加载任何外部图片
import * as THREE from 'three';
import { seededRandom } from '../core/utils/random';

const cache = new Map<string, any>();
function memo<T>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d', { willReadFrequently: true })! };
}

function tex(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: [number, number]; aniso?: number } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) t.repeat.set(...opts.repeat);
  return t;
}

/** 平滑噪声：低分辨率随机图放大（双线性插值），多层叠加 */
function smoothNoise(g: CanvasRenderingContext2D, w: number, h: number, seed: number, octaves: [number, number][]) {
  const rng = seededRandom(seed);
  for (const [cells, alpha] of octaves) {
    const { c: small, g: sg } = canvas(cells, cells);
    const img = sg.createImageData(cells, cells);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(rng() * 255);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    sg.putImageData(img, 0, 0);
    g.globalAlpha = alpha;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(small, 0, 0, w, h);
  }
  g.globalAlpha = 1;
}

/** 高度图 → 法线贴图（可平铺） */
function heightToNormal(src: HTMLCanvasElement, strength: number) {
  const w = src.width;
  const h = src.height;
  const sd = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const { c, g } = canvas(w, h);
  const out = g.createImageData(w, h);
  const H = (x: number, y: number) => sd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

function grain(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number) {
  const rng = seededRandom(seed);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

export interface PBRMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap?: THREE.Texture;
}

// ───────────── 桌布 ─────────────

/** 专业扑克桌绒布：细纤维法线、大尺度颜色变化、玩家位置轻微磨损、印刷的下注线 */
export function feltMaps(): PBRMaps {
  return memo('felt', () => {
    const S = 1024;
    const { c, g } = canvas(S, S);
    g.fillStyle = '#1d5e3d';
    g.fillRect(0, 0, S, S);
    // 大尺度颜色变化
    const { c: n, g: ng } = canvas(S, S);
    smoothNoise(ng, S, S, 11, [[6, 1], [14, 0.5], [40, 0.25]]);
    g.globalCompositeOperation = 'soft-light';
    g.globalAlpha = 0.35;
    g.drawImage(n, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    // 边缘略暗、中央被灯照得略亮
    const v = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.5);
    v.addColorStop(0, 'rgba(255,255,230,0.05)');
    v.addColorStop(0.8, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = v;
    g.fillRect(0, 0, S, S);
    // 玩家位置的磨损（手臂经常摩擦的地方颜色略浅）
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = S / 2 + Math.cos(a) * S * 0.43;
      const y = S / 2 + Math.sin(a) * S * 0.43;
      const r = g.createRadialGradient(x, y, 0, x, y, S * 0.09);
      r.addColorStop(0, 'rgba(190,220,190,0.07)');
      r.addColorStop(1, 'rgba(190,220,190,0)');
      g.fillStyle = r;
      g.fillRect(x - S * 0.1, y - S * 0.1, S * 0.2, S * 0.2);
    }
    // 下注线（印刷在布上的细线，略有磨损）
    g.strokeStyle = 'rgba(214,190,128,0.42)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(S / 2, S / 2, S * 0.32, 0, Math.PI * 2);
    g.stroke();
    // 公共牌位置与桌面标志不再印在布纹里：由 TableMarkings 按真实的公共牌坐标精确绘制（压印效果、低对比度）
    grain(g, S, S, 10, 3);
    const map = tex(c);
    map.center.set(0.5, 0.5);
    map.rotation = Math.PI / 2;

    // 纤维：高频噪声 + 极细的方向性纹理
    const F = 512;
    const { c: h, g: hg } = canvas(F, F);
    hg.fillStyle = '#808080';
    hg.fillRect(0, 0, F, F);
    grain(hg, F, F, 90, 7);
    hg.globalAlpha = 0.25;
    const rng = seededRandom(9);
    for (let i = 0; i < 2600; i++) {
      hg.strokeStyle = rng() < 0.5 ? '#ffffff' : '#000000';
      const x = rng() * F;
      const y = rng() * F;
      const a = rng() * Math.PI;
      const l = 2 + rng() * 5;
      hg.beginPath();
      hg.moveTo(x, y);
      hg.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      hg.stroke();
    }
    hg.globalAlpha = 1;
    const normalMap = tex(heightToNormal(h, 1.6), { srgb: false, repeat: [10, 10] });
    return { map, normalMap };
  });
}

/**
 * 桌布压印贴花：draw 在透明画布上画出图案（白色 = 凸起），返回颜色贴图与压印法线贴图。
 * 每次调用都会创建新贴图，由调用方在卸载时释放。
 */
export function embossDecal(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, strength = 3) {
  const { c: mask, g: mg } = canvas(w, h);
  draw(mg);
  // 高度图：图案的白色剪影放在黑底上（略微模糊，让边缘像压出来的而不是刻出来的）
  const { c: sil, g: sg } = canvas(w, h);
  sg.drawImage(mask, 0, 0);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = '#fff';
  sg.fillRect(0, 0, w, h);
  const { c: height, g: hg } = canvas(w, h);
  hg.fillStyle = '#000';
  hg.fillRect(0, 0, w, h);
  hg.filter = 'blur(2px)';
  hg.drawImage(sil, 0, 0);
  hg.filter = 'none';
  const map = new THREE.CanvasTexture(mask);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const normalMap = new THREE.CanvasTexture(heightToNormal(height, strength));
  normalMap.anisotropy = 8;
  return { map, normalMap };
}

// ───────────── 木材 ─────────────

/** 木纹：扭曲的年轮 + 导管纹理 */
export function woodMaps(key: string, base: string, repeat: [number, number] = [1, 1], dark = 0.55): PBRMaps {
  return memo('wood-' + key, () => {
    const W = 512;
    const H = 512;
    const { c, g } = canvas(W, H);
    const { c: hc, g: hg } = canvas(W, H);
    const col = new THREE.Color(base);
    const img = g.createImageData(W, H);
    const himg = hg.createImageData(W, H);
    const rng = seededRandom(key.length * 31 + 7);
    const ph = Array.from({ length: 6 }, () => rng() * 10);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W;
        const v = y / H;
        const warp = Math.sin(u * 6.28 * 2 + ph[0]) * 0.03 + Math.sin(u * 6.28 * 5 + v * 3 + ph[1]) * 0.012;
        const ring = Math.sin((v + warp) * 6.28 * 18 + Math.sin(u * 6.28 + ph[2]) * 1.5);
        const fine = Math.sin((v + warp * 1.3) * 6.28 * 120 + u * 4) * 0.5;
        let t = 0.5 + ring * 0.32 + fine * 0.08 + (rng() - 0.5) * 0.12;
        t = Math.max(0, Math.min(1, t));
        const k = 1 - (1 - dark) * (1 - t);
        const i = (y * W + x) * 4;
        img.data[i] = col.r * 255 * k * 1.05;
        img.data[i + 1] = col.g * 255 * k;
        img.data[i + 2] = col.b * 255 * k * 0.95;
        img.data[i + 3] = 255;
        const hv = 128 + ring * 18 + fine * 14;
        himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hv;
        himg.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    hg.putImageData(himg, 0, 0);
    return { map: tex(c, { repeat }), normalMap: tex(heightToNormal(hc, 0.8), { srgb: false, repeat }) };
  });
}

/** 宽木地板：错缝拼接、每块木板色调不同、拼缝有倒角 */
export function plankFloorMaps(base = '#5a3622'): PBRMaps {
  return memo('floor-' + base, () => {
    const S = 1024;
    const { c, g } = canvas(S, S);
    const { c: hc, g: hg } = canvas(S, S);
    const wood = woodMaps('plank-' + base, base, [1, 1], 0.62).map.image as HTMLCanvasElement;
    const rng = seededRandom(5);
    hg.fillStyle = '#909090';
    hg.fillRect(0, 0, S, S);
    const rows = 8;
    const rh = S / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rng() * 400;
      while (x < S) {
        const len = 260 + rng() * 300;
        const sx = rng() * (512 - 200);
        const sy = rng() * (512 - rh);
        g.drawImage(wood, sx, sy, 200, rh / 2, x, r * rh, len, rh);
        g.fillStyle = `rgba(${rng() < 0.5 ? '0,0,0' : '255,225,190'},${rng() * 0.14})`;
        g.fillRect(x, r * rh, len, rh);
        // 拼缝
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(x, r * rh, 2, rh);
        hg.fillStyle = '#202020';
        hg.fillRect(x - 1, r * rh, 3, rh);
        x += len;
      }
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(0, r * rh, S, 2);
      hg.fillStyle = '#202020';
      hg.fillRect(0, r * rh - 1, S, 3);
    }
    grain(g, S, S, 8, 4);
    return { map: tex(c, { repeat: [5, 5] }), normalMap: tex(heightToNormal(hc, 2.4), { srgb: false, repeat: [5, 5] }) };
  });
}

// ───────────── 皮革 / 织物 / 毛发 ─────────────

/** 皮革颗粒法线（桌沿包边、椅子、皮衣） */
export function leatherNormal() {
  return memo('leather', () => {
    const S = 256;
    const { c, g } = canvas(S, S);
    g.fillStyle = '#808080';
    g.fillRect(0, 0, S, S);
    const rng = seededRandom(21);
    for (let i = 0; i < 2200; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const r = 1.5 + rng() * 3.5;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    grain(g, S, S, 25, 2);
    return tex(heightToNormal(c, 2.2), { srgb: false, repeat: [24, 2] });
  });
}

/** 织物法线：西装斜纹 / 针织 */
export function fabricNormal(kind: 'twill' | 'knit' | 'canvas') {
  return memo('fabric-' + kind, () => {
    const S = 128;
    const { c, g } = canvas(S, S);
    g.fillStyle = '#808080';
    g.fillRect(0, 0, S, S);
    if (kind === 'twill') {
      for (let i = -S; i < S * 2; i += 4) {
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + S, S);
        g.stroke();
      }
    } else if (kind === 'knit') {
      for (let y = 0; y < S; y += 8) {
        for (let x = 0; x < S; x += 8) {
          g.fillStyle = 'rgba(255,255,255,0.4)';
          g.beginPath();
          g.ellipse(x + 2, y + 4, 2, 3.6, 0.5, 0, Math.PI * 2);
          g.ellipse(x + 6, y + 4, 2, 3.6, -0.5, 0, Math.PI * 2);
          g.fill();
        }
      }
    } else {
      for (let i = 0; i < S; i += 3) {
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(i, 0, 1.5, S);
        g.fillRect(0, i, S, 1.5);
      }
    }
    grain(g, S, S, 30, 6);
    return tex(heightToNormal(c, 1.5), { srgb: false, repeat: [6, 6] });
  });
}

/** 毛发近似：顺着毛发方向的细丝高度图 → 法线（配合 sheen 产生柔和的毛绒轮廓光） */
export function furNormal() {
  return memo('fur', () => {
    const S = 256;
    const { c, g } = canvas(S, S);
    g.fillStyle = '#808080';
    g.fillRect(0, 0, S, S);
    const rng = seededRandom(33);
    g.lineCap = 'round';
    for (let i = 0; i < 5200; i++) {
      const x = rng() * S;
      const y = rng() * S;
      const l = 3 + rng() * 7;
      const a = Math.PI / 2 + (rng() - 0.5) * 0.7;
      g.strokeStyle = `rgba(${rng() < 0.55 ? '255,255,255' : '0,0,0'},${0.18 + rng() * 0.25})`;
      g.lineWidth = 0.6 + rng() * 0.9;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    return tex(heightToNormal(c, 2.6), { srgb: false, repeat: [3, 3] });
  });
}

/** 虹膜：放射状纹理 + 深色外环 */
export function irisTexture(hex: string) {
  return memo('iris-' + hex, () => {
    const S = 128;
    const { c, g } = canvas(S, S);
    const col = new THREE.Color(hex);
    const light = col.clone().lerp(new THREE.Color('#ffffff'), 0.35);
    const dark = col.clone().multiplyScalar(0.35);
    const r = g.createRadialGradient(S / 2, S / 2, S * 0.12, S / 2, S / 2, S / 2);
    r.addColorStop(0, '#' + light.getHexString());
    r.addColorStop(0.65, '#' + col.getHexString());
    r.addColorStop(0.92, '#' + dark.getHexString());
    r.addColorStop(1, '#050505');
    g.fillStyle = r;
    g.fillRect(0, 0, S, S);
    const rng = seededRandom(hex.length + 3);
    for (let i = 0; i < 140; i++) {
      const a = rng() * Math.PI * 2;
      g.strokeStyle = `rgba(${rng() < 0.5 ? '255,255,255' : '0,0,0'},${0.08 + rng() * 0.14})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(S / 2 + Math.cos(a) * S * 0.14, S / 2 + Math.sin(a) * S * 0.14);
      g.lineTo(S / 2 + Math.cos(a) * S * 0.46, S / 2 + Math.sin(a) * S * 0.46);
      g.stroke();
    }
    return tex(c, { aniso: 4 });
  });
}

// ───────────── 墙面 / 地毯 / 窗外 ─────────────

/** 豪华扑克室墙面：上半部分暗纹壁纸，下半部分木质护墙板 */
export function salonWallMaps(theme: 'casino' | 'penthouse' | 'cabin'): PBRMaps {
  return memo('wall-' + theme, () => {
    const W = 512;
    const H = 512;
    const { c, g } = canvas(W, H);
    const { c: hc, g: hg } = canvas(W, H);
    const paper = theme === 'casino' ? '#3a1c1e' : theme === 'penthouse' ? '#2b2a2c' : '#4a3426';
    const panel = theme === 'casino' ? '#3a2416' : theme === 'penthouse' ? '#1f1c1b' : '#5a3a24';
    g.fillStyle = paper;
    g.fillRect(0, 0, W, H);
    hg.fillStyle = '#808080';
    hg.fillRect(0, 0, W, H);
    if (theme === 'casino') {
      // 暗纹（大马士革风格的低对比菱形）
      g.strokeStyle = 'rgba(200,150,90,0.07)';
      g.lineWidth = 2;
      for (let y = 0; y < H * 0.62; y += 64) {
        for (let x = 0; x < W; x += 64) {
          g.beginPath();
          g.moveTo(x + 32, y + 4);
          g.quadraticCurveTo(x + 58, y + 32, x + 32, y + 60);
          g.quadraticCurveTo(x + 6, y + 32, x + 32, y + 4);
          g.stroke();
        }
      }
    } else if (theme === 'cabin') {
      for (let x = 0; x < W; x += 42) {
        g.fillStyle = `rgba(0,0,0,${0.08 + (x % 84 ? 0.04 : 0)})`;
        g.fillRect(x, 0, 2, H * 0.62);
        hg.fillStyle = '#404040';
        hg.fillRect(x, 0, 2, H * 0.62);
      }
    }
    // 护墙板
    const py = H * 0.62;
    const wood = woodMaps('panel-' + theme, panel, [1, 1], 0.7).map.image as HTMLCanvasElement;
    g.drawImage(wood, 0, 0, W, 512 - py, 0, py, W, H - py);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0, py, W, 6);
    g.fillStyle = 'rgba(255,220,160,0.12)';
    g.fillRect(0, py + 6, W, 2);
    hg.fillStyle = '#c0c0c0';
    hg.fillRect(0, py, W, 8);
    for (let x = 16; x < W; x += 128) {
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = 3;
      g.strokeRect(x, py + 26, 96, H - py - 52);
      g.strokeStyle = 'rgba(255,220,160,0.08)';
      g.lineWidth = 1;
      g.strokeRect(x + 3, py + 29, 90, H - py - 58);
      hg.strokeStyle = '#d0d0d0';
      hg.lineWidth = 4;
      hg.strokeRect(x, py + 26, 96, H - py - 52);
    }
    grain(g, W, H, 8, 8);
    return { map: tex(c, { repeat: [12, 1] }), normalMap: tex(heightToNormal(hc, 1.2), { srgb: false, repeat: [12, 1] }) };
  });
}

/** 赌场地毯：低饱和的深色几何图案 */
export function carpetMaps(theme: 'casino' | 'penthouse' | 'cabin'): PBRMaps {
  return memo('carpet-' + theme, () => {
    const S = 512;
    const { c, g } = canvas(S, S);
    const base = theme === 'casino' ? '#3b1018' : theme === 'penthouse' ? '#232326' : '#4a2a1c';
    const line = theme === 'casino' ? 'rgba(190,150,80,0.22)' : theme === 'penthouse' ? 'rgba(180,180,190,0.1)' : 'rgba(200,160,110,0.16)';
    g.fillStyle = base;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = line;
    g.lineWidth = 3;
    for (let y = 0; y <= S; y += 128) {
      for (let x = 0; x <= S; x += 128) {
        g.beginPath();
        g.moveTo(x, y - 52);
        g.lineTo(x + 52, y);
        g.lineTo(x, y + 52);
        g.lineTo(x - 52, y);
        g.closePath();
        g.stroke();
        g.beginPath();
        g.arc(x + 64, y + 64, 10, 0, Math.PI * 2);
        g.stroke();
      }
    }
    grain(g, S, S, 22, 12);
    const { c: hc, g: hg } = canvas(S, S);
    hg.fillStyle = '#808080';
    hg.fillRect(0, 0, S, S);
    grain(hg, S, S, 120, 13);
    return { map: tex(c, { repeat: [5, 5] }), normalMap: tex(heightToNormal(hc, 1.4), { srgb: false, repeat: [5, 5] }) };
  });
}

/** 窗外：夜晚的城市天际线（高层夜景主题） */
export function skylineTexture(seed: number) {
  return memo('sky-' + seed, () => {
    const W = 512;
    const H = 640;
    const { c, g } = canvas(W, H);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#05070f');
    sky.addColorStop(0.55, '#121a2e');
    sky.addColorStop(0.78, '#2c2a3c');
    sky.addColorStop(1, '#3a2c2a');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    const rng = seededRandom(seed * 13 + 1);
    // 远、中、近三层建筑
    const layers = [
      { col: '#0d1220', base: H * 0.62, min: 60, max: 180, win: 0.12 },
      { col: '#0a0e18', base: H * 0.72, min: 90, max: 260, win: 0.2 },
      { col: '#06080f', base: H * 0.86, min: 120, max: 320, win: 0.3 },
    ];
    for (const L of layers) {
      let x = -20;
      while (x < W + 20) {
        const bw = 26 + rng() * 60;
        const bh = L.min + rng() * (L.max - L.min);
        g.fillStyle = L.col;
        g.fillRect(x, L.base - bh, bw, H);
        // 窗户灯光
        for (let wy = L.base - bh + 6; wy < H; wy += 9) {
          for (let wx = x + 4; wx < x + bw - 4; wx += 7) {
            if (rng() < L.win) {
              const warm = rng() < 0.75;
              g.fillStyle = warm ? `rgba(255,${190 + rng() * 40},${120 + rng() * 40},${0.5 + rng() * 0.4})` : `rgba(170,200,255,${0.4 + rng() * 0.3})`;
              g.fillRect(wx, wy, 3, 4);
            }
          }
        }
        x += bw + 2;
      }
    }
    // 地平线的城市光晕
    const glow = g.createLinearGradient(0, H * 0.5, 0, H);
    glow.addColorStop(0, 'rgba(255,150,80,0)');
    glow.addColorStop(1, 'rgba(255,150,80,0.12)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    const t = tex(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

// ───────────── 接触阴影 ─────────────

/** 柔和的接触阴影贴图：rect = 卡牌，circle = 筹码 */
export function contactShadowTexture(kind: 'rect' | 'circle') {
  return memo('shadow-' + kind, () => {
    const S = 128;
    const { c, g } = canvas(S, S);
    if (kind === 'circle') {
      const r = g.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S / 2);
      r.addColorStop(0, 'rgba(0,0,0,0.85)');
      r.addColorStop(0.55, 'rgba(0,0,0,0.45)');
      r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, S, S);
    } else {
      g.filter = 'blur(9px)';
      g.fillStyle = 'rgba(0,0,0,0.8)';
      g.fillRect(S * 0.2, S * 0.17, S * 0.6, S * 0.66);
      g.filter = 'none';
    }
    const t = new THREE.CanvasTexture(c);
    return t;
  });
}

export const shadowGeo = new THREE.PlaneGeometry(1, 1);
const shadowMats = new Map<string, THREE.MeshBasicMaterial>();
/** 共享的接触阴影材质（每个实例用 opacity 时需 clone） */
export function shadowMaterial(kind: 'rect' | 'circle', opacity = 0.55) {
  const key = kind + opacity;
  let m = shadowMats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: contactShadowTexture(kind), transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    shadowMats.set(key, m);
  }
  return m;
}

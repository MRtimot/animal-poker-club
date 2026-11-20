// 程序化生成的纹理（Canvas），无需任何外部图片资源
import * as THREE from 'three';
import { Card, SUIT_SYMBOL, isRed, rankLabel } from '../core/cards/card';

const cache = new Map<string, THREE.Texture>();

function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, opts: { repeat?: [number, number]; srgb?: boolean } = {}) {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...opts.repeat);
  }
  cache.set(key, t);
  return t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC","Hiragino Sans GB",sans-serif';
const FACE_ART: Record<number, string> = { 11: '🦊', 12: '🐱', 13: '🦁', 14: '' };

export function cardFaceTexture(card: Card) {
  return canvasTex('card-' + card.id, 256, 360, (g, w, h) => {
    g.fillStyle = '#fffdf7';
    roundRect(g, 2, 2, w - 4, h - 4, 22);
    g.fill();
    g.strokeStyle = '#d9d2c3';
    g.lineWidth = 3;
    g.stroke();
    const color = isRed(card) ? '#d42a3c' : '#1d1d2b';
    const sym = SUIT_SYMBOL[card.suit];
    const lab = rankLabel(card.rank);
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold ${lab.length > 1 ? 52 : 60}px ${FONT}`;
    g.fillText(lab, 42, 46);
    g.font = `44px ${FONT}`;
    g.fillText(sym, 42, 100);
    g.save();
    g.translate(w - 42, h - 46);
    g.rotate(Math.PI);
    g.font = `bold ${lab.length > 1 ? 52 : 60}px ${FONT}`;
    g.fillText(lab, 0, 0);
    g.font = `44px ${FONT}`;
    g.fillText(sym, 0, -54);
    g.restore();

    const art = FACE_ART[card.rank];
    if (art) {
      g.fillStyle = isRed(card) ? '#fde8ea' : '#e9ecf5';
      roundRect(g, 70, 80, w - 140, h - 160, 16);
      g.fill();
      g.font = `110px ${FONT}`;
      g.fillText(art, w / 2, h / 2 - 8);
      g.fillStyle = color;
      g.font = `40px ${FONT}`;
      g.fillText(sym, w / 2, h / 2 + 72);
    } else {
      g.font = `${card.rank === 14 ? 150 : 120}px ${FONT}`;
      g.fillText(sym, w / 2, h / 2 + 6);
    }
  });
}

export function cardBackTexture() {
  return canvasTex('card-back', 256, 360, (g, w, h) => {
    g.fillStyle = '#fffdf7';
    roundRect(g, 2, 2, w - 4, h - 4, 22);
    g.fill();
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#5b2a86');
    grd.addColorStop(1, '#2b1250');
    g.fillStyle = grd;
    roundRect(g, 14, 14, w - 28, h - 28, 16);
    g.fill();
    g.strokeStyle = '#e8c25a';
    g.lineWidth = 4;
    roundRect(g, 24, 24, w - 48, h - 48, 12);
    g.stroke();
    g.globalAlpha = 0.18;
    g.fillStyle = '#ffffff';
    for (let y = 40; y < h - 30; y += 34) {
      for (let x = 40 + ((y / 34) % 2) * 17; x < w - 30; x += 34) {
        g.beginPath();
        g.arc(x, y, 5, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    g.font = `84px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('🐾', w / 2, h / 2);
  });
}

export function feltTexture() {
  const t = canvasTex('felt', 1024, 1024, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, w / 2);
    grd.addColorStop(0, '#2f9a63');
    grd.addColorStop(0.7, '#1f7a4d');
    grd.addColorStop(1, '#145a37');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // 绒布纹理
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(232,194,90,0.55)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.36, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.375, 0, Math.PI * 2);
    g.stroke();
    // 公共牌区域
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      roundRect(g, w / 2 - 205 + i * 84, h / 2 - 40, 70, 98, 8);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold 46px ${FONT}`;
    g.fillText('动物扑克俱乐部', w / 2, h / 2 + 150);
    g.font = `40px ${FONT}`;
    g.fillText('🐾 🐾 🐾', w / 2, h / 2 - 140);
  });
  // 圆柱顶面的 UV 与桌面坐标相差 90°，旋转使文字与公共牌区朝向玩家
  t.center.set(0.5, 0.5);
  t.rotation = Math.PI / 2;
  return t;
}

export function woodTexture(key = 'wood', base = '#8a5a35', repeat: [number, number] = [6, 6]) {
  return canvasTex(
    key,
    512,
    512,
    (g, w, h) => {
      const planks = 6;
      const ph = h / planks;
      for (let i = 0; i < planks; i++) {
        const shade = 0.85 + Math.random() * 0.25;
        const c = new THREE.Color(base).multiplyScalar(shade);
        g.fillStyle = `#${c.getHexString()}`;
        g.fillRect(0, i * ph, w, ph);
        g.strokeStyle = 'rgba(0,0,0,0.12)';
        for (let k = 0; k < 18; k++) {
          g.beginPath();
          const y = i * ph + Math.random() * ph;
          g.moveTo(0, y);
          g.bezierCurveTo(w * 0.3, y + (Math.random() - 0.5) * 8, w * 0.6, y + (Math.random() - 0.5) * 8, w, y);
          g.lineWidth = Math.random() * 1.5;
          g.stroke();
        }
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(0, i * ph, w, 2);
        const off = (i % 2) * w * 0.5 + w * 0.25;
        g.fillRect(off, i * ph, 2, ph);
      }
    },
    { repeat },
  );
}

export function wallTexture() {
  return canvasTex(
    'wall',
    512,
    512,
    (g, w, h) => {
      g.fillStyle = '#5a3a2c';
      g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 64) {
        g.fillStyle = x % 128 === 0 ? 'rgba(255,220,170,0.05)' : 'rgba(0,0,0,0.06)';
        g.fillRect(x, 0, 64, h);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, h * 0.8, w, 8);
      g.fillStyle = '#3d2519';
      g.fillRect(0, h * 0.815, w, h * 0.185);
    },
    { repeat: [10, 1] },
  );
}

export function forestWindowTexture(seed = 0) {
  return canvasTex('forest-' + seed, 512, 640, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0b1636');
    sky.addColorStop(0.55, '#24406e');
    sky.addColorStop(1, '#3b6b6a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    // 星星与月亮
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 70; i++) {
      g.globalAlpha = Math.random() * 0.8 + 0.2;
      g.fillRect(Math.random() * w, Math.random() * h * 0.5, 2, 2);
    }
    g.globalAlpha = 1;
    g.fillStyle = '#fff6d0';
    g.shadowColor = '#fff6d0';
    g.shadowBlur = 40;
    g.beginPath();
    g.arc(w * (0.25 + (seed % 3) * 0.25), h * 0.18, 34, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    // 层叠的树影
    const layers = ['#1c3b3d', '#142c2e', '#0b1a1c'];
    layers.forEach((col, li) => {
      g.fillStyle = col;
      const base = h * (0.55 + li * 0.13);
      for (let x = -40; x < w + 40; x += 38 + li * 10) {
        const th = 120 + Math.random() * 140 - li * 20;
        g.beginPath();
        g.moveTo(x - 30 - li * 6, base + 40);
        g.lineTo(x, base - th);
        g.lineTo(x + 30 + li * 6, base + 40);
        g.fill();
      }
      g.fillRect(0, base + 30, w, h);
    });
    // 萤火虫
    for (let i = 0; i < 26; i++) {
      g.fillStyle = 'rgba(255,240,150,0.9)';
      g.shadowColor = '#fff08a';
      g.shadowBlur = 10;
      g.beginPath();
      g.arc(Math.random() * w, h * 0.5 + Math.random() * h * 0.45, 2.4, 0, Math.PI * 2);
      g.fill();
    }
    g.shadowBlur = 0;
    // 窗格
    g.strokeStyle = '#2a1a12';
    g.lineWidth = 16;
    g.strokeRect(0, 0, w, h);
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(w / 2, 0);
    g.lineTo(w / 2, h);
    g.moveTo(0, h * 0.45);
    g.lineTo(w, h * 0.45);
    g.stroke();
  });
}

export function neonTexture(text: string, color: string, key: string) {
  return canvasTex(key, 1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold 120px ${FONT}`;
    g.shadowColor = color;
    for (const blur of [40, 20, 8]) {
      g.shadowBlur = blur;
      g.fillStyle = color;
      g.fillText(text, w / 2, h / 2);
    }
    g.shadowBlur = 0;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.85;
    g.fillText(text, w / 2, h / 2);
  });
}

export function emojiTexture(emoji: string, bg = '#f6e7c8') {
  return canvasTex('emoji-' + emoji + bg, 256, 320, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.font = `170px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, w / 2, h / 2 + 8);
  });
}

export function chipSideTexture(color: string) {
  return canvasTex('chip-' + color, 256, 32, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 6, 0, 14, h);
  });
}

export function chipTopTexture(color: string, label: string) {
  return canvasTex('chiptop-' + color + label, 128, 128, (g, w, h) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 8; i++) {
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate((i / 8) * Math.PI * 2);
      g.fillRect(-6, -w / 2, 12, 16);
      g.restore();
    }
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.3, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = color === '#f4f1ea' ? '#333' : '#fff';
    g.font = `bold ${label.length > 3 ? 22 : 30}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, w / 2, h / 2 + 1);
  });
}

export function rugTexture() {
  return canvasTex('rug', 512, 512, (g, w, h) => {
    g.fillStyle = '#7a1f2b';
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#e8c25a';
    for (const [r, lw] of [[0.47, 8], [0.42, 3], [0.2, 4]] as const) {
      g.lineWidth = lw;
      g.beginPath();
      g.arc(w / 2, h / 2, w * r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = 'rgba(232,194,90,0.5)';
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.beginPath();
      g.arc(w / 2 + Math.cos(a) * w * 0.445, h / 2 + Math.sin(a) * w * 0.445, 6, 0, Math.PI * 2);
      g.fill();
    }
  });
}

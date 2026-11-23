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
const SERIF = 'Georgia, "Times New Roman", "Songti SC", serif';
const CW = 300;
const CH = 420;

function paper(g: CanvasRenderingContext2D, w: number, h: number, base: string) {
  g.fillStyle = base;
  roundRect(g, 0, 0, w, h, 18);
  g.fill();
  // 纸张纤维与极轻微的磨损
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue;
    const n = (Math.random() - 0.5) * 7;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.62);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(90,70,40,0.07)');
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);
}

/** 写实扑克牌牌面：衬线字体角标、标准点位、双头人头牌 */
/**
 * 牌面：大号角标（jumbo index）设计——牌桌镜头离得较远时也能一眼看清点数与花色。
 * 左上角是大号点数 + 花色，右下角是大号花色；人头牌加一个皇冠记号。红黑高对比。
 */
export function cardFaceTexture(card: Card) {
  return canvasTex('card-jumbo-' + card.id, CW, CH, (g, w, h) => {
    paper(g, w, h, '#fbf8f0');
    const red = isRed(card);
    const color = red ? '#c0152f' : '#121216';
    const sym = SUIT_SYMBOL[card.suit];
    const lab = rankLabel(card.rank);
    // 细金线内框：牌面更精致，也让牌在绿色桌布上轮廓清楚
    g.strokeStyle = 'rgba(184,144,47,0.55)';
    g.lineWidth = 3;
    roundRect(g, 12, 12, w - 24, h - 24, 12);
    g.stroke();
    g.fillStyle = color;
    g.textBaseline = 'alphabetic';
    // 左上：点数（两位数时压窄）
    g.textAlign = 'left';
    const two = lab.length > 1;
    g.save();
    g.translate(26, 150);
    if (two) g.scale(0.72, 1);
    g.font = `700 150px ${SERIF}`;
    g.fillText(lab, 0, 0);
    g.restore();
    // 点数下方：花色
    g.textAlign = 'center';
    g.font = `112px ${SERIF}`;
    g.fillText(sym, 82, 262);
    // 右下：大号花色
    g.font = `190px ${SERIF}`;
    g.fillText(sym, w - 88, h - 34);
    // 人头牌：右上角的小皇冠
    if (card.rank >= 11 && card.rank <= 13) {
      g.fillStyle = '#b8902f';
      g.font = `64px ${SERIF}`;
      g.fillText(card.rank === 13 ? '♚' : card.rank === 12 ? '♛' : '♞', w - 64, 92);
    }
  });
}

/** 写实牌背：白色留边 + 细密菱格纹 */
export function cardBackTexture() {
  return canvasTex('card-back', CW, CH, (g, w, h) => {
    paper(g, w, h, '#f7f3ea');
    const m = 16;
    g.fillStyle = '#7d1424';
    roundRect(g, m, m, w - m * 2, h - m * 2, 10);
    g.fill();
    g.save();
    roundRect(g, m, m, w - m * 2, h - m * 2, 10);
    g.clip();
    g.strokeStyle = 'rgba(255,240,230,0.55)';
    g.lineWidth = 1.2;
    for (let i = -h; i < w + h; i += 11) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + h, h);
      g.stroke();
      g.beginPath();
      g.moveTo(i, h);
      g.lineTo(i + h, 0);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = 'rgba(255,240,230,0.85)';
    g.lineWidth = 2;
    roundRect(g, m + 7, m + 7, w - m * 2 - 14, h - m * 2 - 14, 6);
    g.stroke();
    g.fillStyle = '#7d1424';
    g.beginPath();
    g.ellipse(w / 2, h / 2, 46, 58, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,240,230,0.85)';
    g.stroke();
    g.fillStyle = 'rgba(255,240,230,0.9)';
    g.font = `600 30px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('APC', w / 2, h / 2 + 2);
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

/** 筹码侧面：底色 + 白色边缘嵌片 + 粘土质感的细微颗粒 */
export function chipSideTexture(color: string) {
  return canvasTex('chip-' + color, 256, 32, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    const light = color === '#f4f1ea';
    g.fillStyle = light ? '#2a4f9a' : '#f3efe6';
    for (let i = 0; i < 6; i++) g.fillRect(i * (w / 6) + 10, 0, 22, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, h - 2, w, 2);
  });
}

/** 筹码正面：边缘嵌片、印刷内圈、浅色中心镶片与面值 */
export function chipTopTexture(color: string, label: string) {
  return canvasTex('chiptop-' + color + label, 192, 192, (g, w, h) => {
    const light = color === '#f4f1ea';
    const cx = w / 2;
    const cy = h / 2;
    g.fillStyle = color;
    g.beginPath();
    g.arc(cx, cy, w / 2, 0, Math.PI * 2);
    g.fill();
    // 边缘嵌片（与侧面对齐）
    g.fillStyle = light ? '#2a4f9a' : '#f3efe6';
    for (let i = 0; i < 6; i++) {
      g.save();
      g.translate(cx, cy);
      g.rotate((i / 6) * Math.PI * 2);
      g.beginPath();
      g.moveTo(-9, -w / 2);
      g.lineTo(9, -w / 2);
      g.lineTo(6, -w / 2 + 20);
      g.lineTo(-6, -w / 2 + 20);
      g.closePath();
      g.fill();
      g.restore();
    }
    // 印刷内圈（虚线）
    g.strokeStyle = light ? 'rgba(40,60,120,0.7)' : 'rgba(255,250,240,0.75)';
    g.setLineDash([5, 4]);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, w * 0.36, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    // 中心镶片
    const inlay = g.createRadialGradient(cx - 10, cy - 10, 4, cx, cy, w * 0.3);
    inlay.addColorStop(0, '#fbf7ee');
    inlay.addColorStop(1, '#e7dfcd');
    g.fillStyle = inlay;
    g.beginPath();
    g.arc(cx, cy, w * 0.29, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = light ? '#1d1d24' : color;
    g.font = `700 ${label.length > 3 ? 26 : label.length > 2 ? 32 : 38}px Georgia, "Times New Roman", serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, cx, cy + 1);
    g.font = `600 10px Georgia, serif`;
    g.fillStyle = 'rgba(60,50,40,0.7)';
    g.fillText('A P C', cx, cy + 26);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 10;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
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

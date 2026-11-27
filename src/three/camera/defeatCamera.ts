// 失败演出的分镜：每个阶段一个镜头，镜头之间是“剪辑”（直接切换），镜头内只有缓慢的推拉。
// 全景 → 输家特写 → 赢家特写 → 反应镜头（跟焦）→ 过肩镜头 → 最后一句话（输家特写）→ 处决准备（中景推到近景）
// → 眼睛的极近特写 → 处决瞬间切开到桌面 → 切回：头部落入画面、身体倒下（侧面）→ 余波（升高、慢慢后退）→ 黑屏
import * as THREE from 'three';
import type { SeatLayout } from '../layout';
import { phaseEnd, type DefeatPhase } from '../../animation/defeat/defeatRules';
import type { DefeatSequence } from '../../animation/defeat/defeatStore';

export type ShotName = 'wide' | 'winnerCU' | 'loserCU' | 'reaction' | 'ots' | 'lastword' | 'prep' | 'ecu' | 'insert' | 'impact' | 'severed' | 'aftermath' | 'aftermathWide';

const FULL_SHOTS: Partial<Record<DefeatPhase, ShotName>> = {
  result: 'wide',
  winner: 'winnerCU',
  realize: 'loserCU',
  reaction: 'reaction',
  tension: 'ots',
  lastword: 'lastword',
  prep: 'prep',
  ecu: 'ecu',
  insert: 'insert',
  silence: 'ecu',
  // 处决的一瞬间：镜头切开到桌面（牌与筹码被震起），闪光；切回时头部已经在下落
  impact: 'insert',
  headfall: 'severed',
  collapse: 'severed',
  aftermath: 'aftermathWide',
  blackout: 'aftermathWide',
  defeated: 'aftermathWide',
};
const SHORT_SHOTS: Partial<Record<DefeatPhase, ShotName>> = {
  realize: 'loserCU',
  reaction: 'reaction',
  silence: 'reaction',
  impact: 'impact',
  aftermath: 'impact',
  defeated: 'impact',
};

export interface DefeatShot {
  /** 用于判断是否切换了镜头（切换时直接剪辑，不平滑过渡） */
  key: string;
  pos: THREE.Vector3;
  look: THREE.Vector3;
  /** 景深焦点（极高画质有景深时生效） */
  focus: THREE.Vector3;
  /** 景深的清晰范围（米）：特写时很窄（背景虚化），全景时很宽 */
  range: number;
  fov: number;
}

const up = (y: number) => new THREE.Vector3(0, y, 0);
/** layout.head 是名牌的锚点（座位上方 2.45）；动物的脸大约在它下方 1.0 */
export const FACE_DROP = 1.0;
/**
 * 某个座位上的动物转头看向另一个座位时，脸朝向的水平方向。
 * 与 AnimalModel 的转头一致：头最多转 ±0.75 弧度；镜头放在它脸朝向的方向上（略少转一点，拍到四分之三侧脸）。
 */
function facing(from: SeatLayout, to: SeatLayout | undefined, k = 0.85): THREE.Vector3 {
  const dir = new THREE.Vector3(from.seat[0], 0, from.seat[2]).normalize();
  const f = dir.clone().negate();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  if (!to) return f;
  const d = new THREE.Vector3(to.seat[0] - from.seat[0], 0, to.seat[2] - from.seat[2]);
  const yaw = Math.max(-0.75, Math.min(0.75, Math.atan2(d.dot(side), d.dot(f)))) * k;
  return f.multiplyScalar(Math.cos(yaw)).add(side.multiplyScalar(Math.sin(yaw)));
}
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const ease3 = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

/** 当前应该使用的镜头；没有演出 / 恢复阶段返回 null（交还给普通镜头） */
export function defeatShot(seq: DefeatSequence, phase: DefeatPhase, now: number, layout: Map<string, SeatLayout>, portrait: boolean): DefeatShot | null {
  const shot = (seq.cut === 'full' ? FULL_SHOTS : SHORT_SHOTS)[phase];
  const L = layout.get(seq.loserId);
  if (!shot || !L) return null;
  // 镜头内的进度（推拉）：减少动态效果时几乎不动
  const start = seq.at[phase] ?? now;
  const rel: Partial<Record<DefeatPhase, number>> = {};
  for (const [k, v] of Object.entries(seq.at)) rel[k as DefeatPhase] = (v as number) - (seq.at.result ?? 0);
  const endRel = phaseEnd(rel, phase);
  const dur = Number.isFinite(endRel) ? Math.max(1, endRel - (rel[phase] ?? 0)) : 2500;
  const p = easeInOut(Math.min(1, Math.max(0, (now - start) / dur))) * seq.profile.move;

  const k = portrait ? 1.38 : 1;
  const head = new THREE.Vector3(...L.head).add(up(-FACE_DROP));
  const dir = new THREE.Vector3(L.seat[0], 0, L.seat[2]).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const center = new THREE.Vector3(0, 1.0, 0);
  // 输家脸朝向的方向（演出中他转头看着赢家）
  const lf = facing(L, seq.winnerId ? layout.get(seq.winnerId) : undefined);
  const cu = portrait ? 50 : 36;
  let pos: THREE.Vector3;
  let look: THREE.Vector3;
  let focus: THREE.Vector3;
  let fov = portrait ? 60 : 42;
  let range = 4;

  switch (shot) {
    case 'wide': {
      pos = new THREE.Vector3(0, 8.6 - p * 0.9, 10.6 - p * 1.3).multiplyScalar(portrait ? 1.15 : 1);
      look = new THREE.Vector3(0, 0.5, -0.6);
      focus = center.clone();
      range = 9;
      break;
    }
    case 'winnerCU': {
      const W = seq.winnerId ? layout.get(seq.winnerId) : undefined;
      // 站着的动物庄家：用真实的脸部位置，并按体型拉开距离（否则镜头会贴到脸上）
      const wh = W?.face ? new THREE.Vector3(...W.face) : W ? new THREE.Vector3(...W.head).add(up(-FACE_DROP)) : head;
      const ws = W?.faceScale ?? 1;
      // 赢家看着输家：镜头放在赢家脸朝向的方向
      const wf = W ? facing(W, L, 0.7) : dir.clone().negate();
      pos = wh.clone().add(wf.multiplyScalar((2.6 - p * 0.35) * k * ws)).add(up(0.3 * ws));
      look = wh.clone().add(up(-0.05));
      focus = wh.clone();
      fov = cu;
      range = 2.2;
      break;
    }
    case 'loserCU': {
      // 输家转头看向赢家：镜头放在他脸朝向的方向，略低于视线（压迫感）
      pos = head.clone().add(lf.clone().multiplyScalar((2.5 - p * 0.65) * k)).add(up(0.1));
      look = head.clone().add(up(-0.02));
      focus = head.clone();
      fov = cu;
      range = 2.0;
      break;
    }
    case 'reaction': {
      // 从桌子对面越过其他动物的后脑勺看向输家：大家一个接一个转过头去
      pos = dir.clone().multiplyScalar(-5.4 * (portrait ? 1.25 : 1)).add(up(4.2 - p * 0.4)).add(side.clone().multiplyScalar(0.6 - p * 0.3));
      look = head.clone().add(up(-0.1));
      // 跟焦：先对焦前景转头的动物，再落到输家身上
      focus = center.clone().lerp(head, p);
      range = 3;
      break;
    }
    case 'ots': {
      // 过肩：从输家身后看向牌桌和盯着他的所有人
      pos = head.clone().add(dir.clone().multiplyScalar(1.25 * k)).add(side.clone().multiplyScalar(0.7)).add(up(1.35 + p * 0.1));
      look = dir.clone().multiplyScalar(-1.5).add(up(1.1));
      focus = dir.clone().multiplyScalar(-3.2).add(up(1.4));
      fov = portrait ? 56 : 40;
      range = 3.5;
      break;
    }
    case 'lastword': {
      // 最后一句话：输家的近景，镜头几乎不动
      pos = head.clone().add(lf.clone().multiplyScalar((2.3 - p * 0.2) * k)).add(up(0.12));
      look = head.clone().add(up(-0.04));
      focus = head.clone();
      fov = cu;
      range = 1.8;
      break;
    }
    case 'prep': {
      // 处决准备：从中景慢慢推到近景（输家看向处决者）
      const d = 3.6 - ease3(p) * 1.5;
      pos = head.clone().add(lf.clone().multiplyScalar(d * k)).add(up(0.35 - p * 0.2));
      look = head.clone().add(up(-0.12 + p * 0.08));
      focus = head.clone();
      fov = portrait ? 54 : 38;
      range = 2.2 - p * 0.6;
      break;
    }
    case 'ecu': {
      // 眼睛的极近特写：几乎贴上去、极慢地推近；背景完全虚化
      const eyes = head.clone().add(up(0.05));
      pos = eyes.clone().add(lf.clone().multiplyScalar((seq.cut === 'full' ? 1.55 - p * 0.2 : 2.0 - p * 0.3) * k)).add(up(0.02));
      look = eyes.clone();
      focus = eyes.clone();
      fov = portrait ? (seq.cut === 'full' ? 38 : 44) : seq.cut === 'full' ? 26 : 30;
      range = 1.0;
      break;
    }
    case 'insert': {
      // 环境特写：低机位贴近输家面前的筹码与底牌
      // 输家摊开的底牌：从桌子中央一侧斜向下看（不被桌边挡住）
      const target = new THREE.Vector3(...L.cards);
      pos = target.clone().add(dir.clone().multiplyScalar(-(1.15 - p * 0.2) * k)).add(up(0.95 - p * 0.1)).add(side.clone().multiplyScalar(0.3));
      look = target.clone().add(dir.clone().multiplyScalar(-0.05));
      focus = target.clone();
      fov = cu;
      range = 1.2;
      break;
    }
    case 'impact': {
      // 输家在画面中上方，下方留给字幕
      pos = head.clone().add(dir.clone().multiplyScalar(-(3.4 + p * 0.6) * k)).add(up(0.75));
      look = head.clone().add(up(-0.55));
      focus = head.clone();
      range = 4;
      break;
    }
    case 'severed': {
      // 头部落入画面 → 落地 → 滚动；身体失去支撑倒下：从头部飞去的那一侧、椅子外侧略低的位置拍
      // （镜头在牌桌外面，桌面不会挡住地面）
      const sd = side.clone().multiplyScalar(seq.decap?.side ?? 1);
      const seat = new THREE.Vector3(L.seat[0], 0, L.seat[2]);
      pos = seat.clone().add(sd.clone().multiplyScalar(4.4 * k)).add(dir.clone().multiplyScalar(1.7 * k)).add(up(1.95 + p * 0.1));
      // 竖屏：牌局界面为底部操作区留出的镜头偏移在演出中仍然存在（操作区已隐藏），视线抬高一点，让身体与头部在画面中间
      look = seat.clone().add(sd.clone().multiplyScalar(1.1)).add(dir.clone().multiplyScalar(0.2)).add(up(0.95 - p * 0.15 + (portrait ? 0.65 : 0)));
      focus = seat.clone().add(sd.clone().multiplyScalar(1.1)).add(up(0.7));
      fov = portrait ? 62 : 46;
      range = 3;
      break;
    }
    case 'aftermathWide': {
      // 余波：镜头慢慢后退、升高——倒下的身体、地上的头部、散乱的牌与筹码、一动不动的其他动物
      const sd = side.clone().multiplyScalar(seq.decap?.side ?? 1);
      const seat = new THREE.Vector3(L.seat[0], 0, L.seat[2]);
      const back = p * 1.1;
      pos = seat.clone().add(sd.clone().multiplyScalar((3.7 + back * 0.5) * k)).add(dir.clone().multiplyScalar((2.6 + back) * k)).add(up(3.3 + back * 0.6));
      look = seat.clone().add(sd.clone().multiplyScalar(0.9)).add(dir.clone().multiplyScalar(-0.6)).add(up(0.5 + (portrait ? 0.9 : 0)));
      focus = seat.clone().add(sd.clone().multiplyScalar(0.6)).add(up(0.6));
      fov = portrait ? 62 : 46;
      range = 5;
      break;
    }
    case 'aftermath':
    default: {
      pos = head.clone().add(dir.clone().multiplyScalar(-(4.4 + p * 1.0) * k)).add(up(1.3 + p * 0.5));
      look = head.clone().add(up(-0.6));
      focus = head.clone();
      break;
    }
  }
  return { key: `${seq.key}:${shot}`, pos, look, focus, range, fov };
}

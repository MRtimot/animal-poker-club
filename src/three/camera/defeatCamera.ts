// 失败演出的分镜：每个阶段一个镜头，镜头之间是“剪辑”（直接切换），镜头内只有缓慢的推拉。
// 全景 → 赢家特写 → 输家特写 → 反应镜头 → 过肩镜头 → 环境特写 → 冲击 → 余波 → 黑屏
import * as THREE from 'three';
import type { SeatLayout } from '../layout';
import { phaseEnd, type DefeatPhase } from '../../animation/defeat/defeatRules';
import type { DefeatSequence } from '../../animation/defeat/defeatStore';

export type ShotName = 'wide' | 'winnerCU' | 'loserCU' | 'reaction' | 'ots' | 'insert' | 'impact' | 'aftermath';

const FULL_SHOTS: Partial<Record<DefeatPhase, ShotName>> = {
  result: 'wide',
  winner: 'winnerCU',
  realize: 'loserCU',
  reaction: 'reaction',
  tension: 'ots',
  insert: 'insert',
  silence: 'insert',
  impact: 'impact',
  aftermath: 'aftermath',
  blackout: 'aftermath',
  defeated: 'aftermath',
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
  fov: number;
}

const up = (y: number) => new THREE.Vector3(0, y, 0);
/** layout.head 是名牌的锚点（座位上方 2.45）；动物的脸大约在它下方 1.0 */
export const FACE_DROP = 1.0;
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

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
  const cu = portrait ? 50 : 36;
  let pos: THREE.Vector3;
  let look: THREE.Vector3;
  let focus: THREE.Vector3;
  let fov = portrait ? 60 : 42;

  switch (shot) {
    case 'wide': {
      pos = new THREE.Vector3(0, 8.6 - p * 0.9, 10.6 - p * 1.3).multiplyScalar(portrait ? 1.15 : 1);
      look = new THREE.Vector3(0, 0.5, -0.6);
      focus = center.clone();
      break;
    }
    case 'winnerCU': {
      const W = seq.winnerId ? layout.get(seq.winnerId) : undefined;
      const wh = W ? new THREE.Vector3(...W.head).add(up(-FACE_DROP)) : head;
      const wd = W ? new THREE.Vector3(W.seat[0], 0, W.seat[2]).normalize() : dir;
      const ws = new THREE.Vector3(-wd.z, 0, wd.x);
      pos = wh.clone().add(wd.clone().multiplyScalar(-(2.6 - p * 0.35) * k)).add(up(0.35)).add(ws.multiplyScalar(0.4));
      look = wh.clone().add(up(-0.05));
      focus = wh.clone();
      fov = cu;
      break;
    }
    case 'loserCU': {
      pos = head.clone().add(dir.clone().multiplyScalar(-(2.5 - p * 0.65) * k)).add(up(0.28)).add(side.clone().multiplyScalar(0.25));
      look = head.clone().add(up(-0.02));
      focus = head.clone();
      fov = cu;
      break;
    }
    case 'reaction': {
      // 从桌子对面越过其他动物的后脑勺看向输家：大家一个接一个转过头去
      pos = dir.clone().multiplyScalar(-5.4 * (portrait ? 1.25 : 1)).add(up(4.2 - p * 0.4)).add(side.clone().multiplyScalar(0.6 - p * 0.3));
      look = head.clone().add(up(-0.1));
      // 跟焦：先对焦前景转头的动物，再落到输家身上
      focus = center.clone().lerp(head, p);
      break;
    }
    case 'ots': {
      // 过肩：从输家身后看向牌桌和盯着他的所有人
      pos = head.clone().add(dir.clone().multiplyScalar(1.25 * k)).add(side.clone().multiplyScalar(0.7)).add(up(1.35 + p * 0.1));
      look = dir.clone().multiplyScalar(-1.5).add(up(1.1));
      focus = dir.clone().multiplyScalar(-3.2).add(up(1.4));
      fov = portrait ? 56 : 40;
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
      break;
    }
    case 'impact': {
      // 输家在画面中上方，下方留给字幕
      pos = head.clone().add(dir.clone().multiplyScalar(-(3.4 + p * 0.6) * k)).add(up(0.75));
      look = head.clone().add(up(-0.55));
      focus = head.clone();
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
  return { key: `${seq.key}:${shot}`, pos, look, focus, fov };
}

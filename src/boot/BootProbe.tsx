// 放在 3D 画布里、首页场景之后：报告真实的启动步骤
//   挂载 = 场景已经搭建（同一个 Suspense 里的内容全部提交，包括高画质时的后期处理模块）
//   → 预编译场景里所有材质的着色器（three.js compileAsync，会包括暂时隐藏的物体）
//   → 再等画面真正渲染出几帧（阴影与后期处理在第一帧时准备）
// 只在启动时工作一次；完成后不再占用每一帧。
import { useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { markBoot, useBoot } from './boot';

/** 渲染完成的帧数达到要求后报告（useFrame 在每帧渲染之前调用：第 3 次调用时，前 2 帧已经画出） */
function FrameCounter({ onDone }: { onDone: () => void }) {
  const [n] = useState(() => ({ v: 0, done: false }));
  useFrame(() => {
    if (n.done) return;
    if (++n.v >= 3) {
      n.done = true;
      onDone();
    }
  });
  return null;
}

/**
 * 与 three.js 的 compileAsync 相同，但编译期间材质被释放时不会出错。
 * （刷新网页后直接回到牌局：首页场景还在编译就被换掉，compileAsync 会在定时器里抛异常，
 *   而且它的 Promise 永远不会完成，加载页只能等超时）
 */
async function precompile(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, alive: () => boolean) {
  const waiting = gl.compile(scene, camera);
  while (waiting.size && alive()) {
    await new Promise((r) => setTimeout(r, 10));
    for (const m of waiting) {
      const program = (gl.properties.get(m) as { currentProgram?: { isReady(): boolean } }).currentProgram;
      if (!program || program.isReady()) waiting.delete(m);
    }
  }
}

export function BootProbe() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const [counting, setCounting] = useState(false);
  useEffect(() => {
    const boot = useBoot.getState();
    if (boot.done.frames) return; // 已经启动过（例如切换页面后重新挂载）
    markBoot('scene');
    let alive = true;
    precompile(gl, scene, camera, () => alive)
      .catch((e) => {
        // 编译检查失败不影响显示（第一帧渲染时仍会编译）：照常继续，只记录
        console.warn('[启动] 预编译着色器失败，改为在第一帧编译：', e);
      })
      .then(() => {
        if (!alive) return;
        markBoot('shaders');
        setCounting(true);
      });
    return () => {
      alive = false;
    };
    // 每个画布只做一次（重试时整个画布会重建，这个组件也会重新挂载）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return counting ? <FrameCounter onDone={() => (markBoot('frames'), setCounting(false))} /> : null;
}

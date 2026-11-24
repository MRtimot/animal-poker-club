// 后期处理（按需加载：只有画质为“高 / 极高”时才会下载 postprocessing 代码，低画质与手机首屏不加载）
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bloom, DepthOfField, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { DepthOfFieldEffect } from 'postprocessing';
import type { Quality } from '../store/settingsStore';
import { cameraFocus, cameraFocusRange } from './camera/CameraRig';
import { damp } from '../animation/motion';

/** 景深：焦点跟随镜头；清晰范围平滑地跟随当前镜头（特写时背景虚化，换焦时有“跟焦”的感觉） */
function TableDof() {
  const ref = useRef<DepthOfFieldEffect>(null);
  const range = useRef(7);
  useFrame((_, dt) => {
    const e = ref.current;
    if (!e) return;
    range.current = damp(range.current, cameraFocusRange.value, 3.5, dt);
    e.cocMaterial.focusRange = range.current;
    e.bokehScale = range.current < 3 ? 2.2 : 1.4;
  });
  return <DepthOfField ref={ref} target={cameraFocus} worldFocusRange={7} bokehScale={1.4} />;
}

/**
 * 极克制的泛光 + 暗角；极高画质的牌桌上加入跟随镜头焦点的景深。
 * 两种组合用不同的 key：进出牌桌时重新创建合成器。
 * 否则 React 会复用同一个合成器，只是加上 / 去掉景深——景深需要的深度贴图在多重采样缓冲上反复删除、重建，
 * 第二次进入牌桌后深度格式不再匹配，浏览器报 glBlitFramebuffer 错误，那一帧的画面解析也会失败。
 */
export default function PostFX({ quality, game }: { quality: Quality; game: boolean }) {
  if (quality === 'ultra' && game) {
    return (
      <EffectComposer key="table-dof" multisampling={4}>
        <TableDof />
        <Bloom intensity={0.22} luminanceThreshold={0.92} luminanceSmoothing={0.15} mipmapBlur />
        <Vignette eskil={false} offset={0.3} darkness={0.5} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer key={quality === 'ultra' ? 'scene-msaa' : 'scene'} multisampling={quality === 'ultra' ? 4 : 0}>
      <Bloom intensity={0.2} luminanceThreshold={0.92} luminanceSmoothing={0.15} mipmapBlur />
      <Vignette eskil={false} offset={0.3} darkness={0.45} />
    </EffectComposer>
  );
}

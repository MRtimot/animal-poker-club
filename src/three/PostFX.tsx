// 后期处理（按需加载：只有画质为“高 / 极高”时才会下载 postprocessing 代码，低画质与手机首屏不加载）
import { Bloom, DepthOfField, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { Quality } from '../store/settingsStore';
import { cameraFocus } from './camera/CameraRig';

/** 极克制的泛光 + 暗角；极高画质的牌桌上加入跟随镜头焦点的景深 */
export default function PostFX({ quality, game }: { quality: Quality; game: boolean }) {
  if (quality === 'ultra' && game) {
    return (
      <EffectComposer multisampling={4}>
        <DepthOfField target={cameraFocus} worldFocusRange={7} bokehScale={1.4} />
        <Bloom intensity={0.22} luminanceThreshold={0.92} luminanceSmoothing={0.15} mipmapBlur />
        <Vignette eskil={false} offset={0.3} darkness={0.5} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={quality === 'ultra' ? 4 : 0}>
      <Bloom intensity={0.2} luminanceThreshold={0.92} luminanceSmoothing={0.15} mipmapBlur />
      <Vignette eskil={false} offset={0.3} darkness={0.45} />
    </EffectComposer>
  );
}

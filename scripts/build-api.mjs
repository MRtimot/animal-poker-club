// 把 Vercel 实时连接函数打包成一个独立文件 api/ws.js（不依赖相对路径导入，避免 ESM 解析问题）
import { build } from 'esbuild';

await build({
  entryPoints: ['server/vercel.ts'],
  outfile: 'api/ws.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  // ws 的可选原生加速模块：没有也能运行
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: "// 自动生成，请勿手动修改：npm run build:api（源码在 server/vercel.ts）\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});
console.log('✓ 已生成 api/ws.js');

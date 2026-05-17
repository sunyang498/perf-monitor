// rollup.config.js — 将 TypeScript 源码打包为可直接在浏览器使用的 JS 文件

import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

export default {
  // 入口：src/index.ts 是整个 SDK 的唯一起点
  input: 'src/index.ts',

  output: {
    // 输出到 dist/perf-monitor.js，用户 <script> 引入即可
    file: 'dist/perf-monitor.js',

    // IIFE = Immediately Invoked Function Expression（立即执行函数）
    // 打包后形如: var PerfMonitor = (function () { ... })();
    // 这样不污染全局，只有一个 window.PerfMonitor 变量
    format: 'iife',

    // IIFE 挂到 window 上的全局变量名，用户通过 PerfMonitor.init() 使用
    name: 'PerfMonitor',

    // 生成 sourcemap，方便调试时看到原始 TS 代码
    sourcemap: true,
  },

  plugins: [
    // ① 先用 @rollup/plugin-typescript 编译 TS → JS
    // 它会自动读取 tsconfig.json
    typescript(),

    // ② 再用 terser 压缩输出（去掉空格、缩短变量名等）
    terser({
      // 保留类名和方法名，确保 window.PerfMonitor 不被混淆
      keep_classnames: true,
      keep_fnames: true,
    }),
  ],
};

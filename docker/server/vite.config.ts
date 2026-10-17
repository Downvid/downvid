import { defineConfig } from 'vite'
import path from 'node:path'

/**
 * 无头服务的**运行期**打包配置（SSR 构建，只产出 Node 可执行的一坨 JS）。
 *
 * ## 为什么不直接 `tsx docker/server/index.ts`
 *
 * 早期镜像用 `tsx` 在容器里即时转译：好处是零构建步骤，代价是运行期必须带上
 * `tsx` 与它的一整套依赖（镜像实测多出约 37MB），而且每次启动都要重新解析、
 * 转译整个 `electron/` 依赖树——容器重启/重建时这段开销是纯浪费。
 *
 * 把服务端打成一个文件后：
 *   - 运行期只要 `node dist-server/index.js`，`tsx` 与 `docker/package.json`
 *     的依赖层整个消失；
 *   - 启动是「读一个文件」，不是「转译上百个模块」；
 *   - 依赖解析错误从**运行期**（容器已经起来了才发现）提前到**构建期**。
 *
 * ## 打包范围
 *
 * 从 `docker/server/index.ts` 出发的一切都打进来（electron 的 download /
 * parsers / utils 是真实的业务代码，不是外部依赖）。只有两类保持 external：
 *
 *   1. Node 内建模块（`node:*`）——打进来没有意义；
 *   2. **原生模块**：`bufferutil` / `utf-8-validate` 是 `ws` 的可选加速件，
 *      带 `.node` 二进制，rolldown 无法内联；把 `ws` 整个留 external 更简单，
 *      运行期仍需要 `ws`（镜像里保留这一层）。
 *
 * `electron` 走 `paths` 别名指向 `docker/server/electron-shim.ts`——与
 * `docker/server/tsconfig.json` 里给 `tsx` 用的那条别名是同一个映射，
 * 两边必须一起维护（漏一处就会在构建期或运行期报 `Cannot find package 'electron'`）。
 */

const ROOT = path.resolve(import.meta.dirname, '../..')

export default defineConfig({
  root: ROOT,
  resolve: {
    alias: {
      electron: path.resolve(import.meta.dirname, 'electron-shim.ts'),
    },
  },
  ssr: {
    // Vite 的 SSR 构建默认把 package.json 里的 dependencies 全部 external，
    // 于是 `ws` 会被留成运行期 import —— 那正好是我们要消掉的那一层依赖。
    // noExternal 关掉这个默认行为，只保留下面 rollupOptions 里显式列举的例外。
    noExternal: true,
  },
  build: {
    ssr: path.resolve(import.meta.dirname, 'index.ts'),
    outDir: path.resolve(ROOT, 'docker/dist-server'),
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      // `ws` 是纯 JS，直接打进来——否则运行期还要带一份 node_modules。
      // 它内部 `require('bufferutil')` / `require('utf-8-validate')` 是可选加速件
      // （try/catch 包着），留成 external 就不会被打包器当成缺失依赖。
      external: ['bufferutil', 'utf-8-validate', /^node:/],
      output: {
        format: 'es',
        entryFileNames: 'index.js',
        // 单文件：SSR 输出默认会按 chunk 拆分，拆出来的路径在镜像里更难维护
        inlineDynamicImports: true,
      },
    },
  },
})

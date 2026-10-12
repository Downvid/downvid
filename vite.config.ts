import { defineConfig, type Plugin } from 'vite'
import path from 'node:path'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import electron from 'vite-plugin-electron/simple'
import vue from '@vitejs/plugin-vue'

const ROOT = import.meta.dirname
const BACKEND_DIR = path.join(ROOT, 'backend')
const BACKEND_BUILD_DIR = path.join(BACKEND_DIR, 'build')

/**
 * 当前操作系统上需要构建边车的架构。
 *
 * 一并交叉编译本 OS 的全部架构，是因为 electron-builder 会在同一台机器上
 * 同时产出 arm64 与 x64 安装包（如 `--mac --arm64 --x64`），
 * 而 extraResources 按目标架构取目录，只构建宿主架构会导致其中一个架构缺文件。
 * Go 交叉编译开销很小（各约 1~2 秒），换来的是构建结果与宿主架构解耦。
 */
function targetArches(): Array<{ dir: string; goarch: string }> {
  switch (process.platform) {
    case 'darwin':
      return [
        { dir: 'arm64', goarch: 'arm64' },
        { dir: 'x64', goarch: 'amd64' },
      ]
    case 'linux':
      return [
        { dir: 'x64', goarch: 'amd64' },
        { dir: 'arm64', goarch: 'arm64' },
      ]
    case 'win32':
      return [{ dir: 'x64', goarch: 'amd64' }]
    default:
      return [{ dir: process.arch, goarch: process.arch }]
  }
}

function goBinaryName(): string {
  return process.platform === 'win32' ? 'downvid-deps.exe' : 'downvid-deps'
}

/**
 * 构建 Go 边车（依赖探测 + 下载）。
 *
 * 安装包不再携带 yt-dlp / ffmpeg，改由这个边车在运行时识别机器上已装好的版本，
 * 缺失时才下载到 userData。源码没变时 go 自己的构建缓存会让这一步很快。
 */
function goBackend(): Plugin {
  return {
    name: 'downvid-go-backend',
    async buildStart() {
      const name = goBinaryName()
      for (const { dir, goarch } of targetArches()) {
        const outDir = path.join(BACKEND_BUILD_DIR, `${process.platform}-${dir}`)
        const outFile = path.join(outDir, name)
        fs.mkdirSync(outDir, { recursive: true })

        try {
          execFileSync('go', ['build', '-o', outFile, './cmd/downvid-deps'], {
            cwd: BACKEND_DIR,
            stdio: 'inherit',
            env: { ...process.env, GOOS: process.platform, GOARCH: goarch, CGO_ENABLED: '0' },
          })
        } catch (e: any) {
          // 没装 Go 时给出明确指引，而不是让整个构建以晦涩的错误失败
          throw new Error(
            `[go-backend] 构建 ${process.platform}-${dir} 依赖边车失败，` +
            '请确认已安装 Go 1.24+ 并在 PATH 中可用。\n' +
            `原始错误：${e?.message || e}`,
          )
        }
      }
      console.log(`\n[go-backend] 已构建 ${targetArches().map(a => `${process.platform}-${a.dir}`).join(', ')}`)
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(ROOT, 'src'),
    },
  },
  plugins: [
    vue(),
    goBackend(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(ROOT, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
})

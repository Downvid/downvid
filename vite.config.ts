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
// Node 的 process.platform 用的是 'win32'，而 Go 的 GOOS 是 'windows'。
// 直接透传会得到 "unsupported GOOS/GOARCH pair win32/amd64"；
// macOS 与 Linux 之所以没暴露这个问题，只是两个名字恰好一致。
const GOOS_BY_PLATFORM: Record<string, string> = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'windows',
}

function goBackend(): Plugin {
  /** 编译全部目标架构的边车；返回是否全部成功 */
  function buildAll(): void {
    const goos = GOOS_BY_PLATFORM[process.platform] || process.platform
    const name = goBinaryName()
    for (const { dir, goarch } of targetArches()) {
      const outDir = path.join(BACKEND_BUILD_DIR, `${process.platform}-${dir}`)
      const outFile = path.join(outDir, name)
      fs.mkdirSync(outDir, { recursive: true })

      try {
        execFileSync('go', ['build', '-o', outFile, './cmd/downvid-deps'], {
          cwd: BACKEND_DIR,
          stdio: 'inherit',
          env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
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
  }

  return {
    name: 'downvid-go-backend',
    async buildStart() {
      buildAll()
    },
    /**
     * 开发时监听 Go 源码并重建边车。
     *
     * ## 为什么必须有这一段（真实踩过）
     *
     * `buildStart` 只在**启动时**编译一次，而 Go 源码不在 Vite 的模块图里——
     * 改 `backend/**` 不会触发任何重建。于是长期开着的 `pnpm dev` 会一直用旧边车：
     * 实测把 aria2 加进 `Kinds` 之后，界面上仍然只显示三个依赖，
     * 而源码、测试、`go build` 全都是对的。
     *
     * 这类「改完没生效」极难自查：重启 dev 就好了，于是很容易以为是缓存玄学。
     * 这里把 Go 目录纳入 watch，变更即重建（Go 有编译缓存，增量很快）。
     */
    configureServer(server) {
      const watched = ['internal', 'cmd', 'go.mod', 'go.sum'].map((entry) => path.join(BACKEND_DIR, entry))
      server.watcher.add(watched)
      let timer: NodeJS.Timeout | null = null
      const rebuild = (file: string) => {
        // 只关心会影响二进制的文件；`build/` 输出目录要排除（否则自己触发自己）
        if (!/\.go$|go\.(mod|sum)$/.test(file)) return
        if (file.includes(`${path.sep}build${path.sep}`)) return
        // 测试文件不进二进制，改它们不该触发重编（否则写用例时会一直重建边车）
        if (file.endsWith('_test.go')) return
        // 防抖：一次保存可能触发多个事件
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          try {
            buildAll()
          } catch (e: any) {
            // 开发时不因为一次编译失败就杀掉 dev server
            console.error(`\n[go-backend] 重建失败（保持上一个可用版本）：${e?.message || e}\n`)
          }
        }, 150)
      }
      server.watcher.on('change', rebuild)
      server.watcher.on('add', rebuild)
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

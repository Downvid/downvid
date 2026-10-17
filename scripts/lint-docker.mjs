#!/usr/bin/env node
/**
 * 容器镜像定义的静态校验。
 *
 * ## 为什么需要它
 *
 * 镜像里出问题的形态几乎都是**不报错的那种**：
 *
 *   1. 运行依赖（yt-dlp / ffmpeg）的版本被写死在 Dockerfile 里，
 *      于是 `pnpm deps:manifest` 升级了清单、桌面版跟着变了，镜像还停在旧版本。
 *      表现是「桌面版能下的链接容器版下不了」，而且没有任何构建错误。
 *   2. 服务端改回用 `tsx` 运行，`docker/package.json` 又冒出来——多 37MB，
 *      启动变慢，但功能完全正常，没人会发现。
 *   3. 容器版更新检查退回「假装已是最新」（`hasUpdate: false` 常量），
 *      用户就永远不知道有新镜像。
 *   4. `/data` 被切成固定 uid，NAS 上「下载目录没有写权限」变成默认结果。
 *
 * 这些都是**读文件就能判定**的事实，不必等一次几分钟的镜像构建。
 *
 * 用法：node scripts/lint-docker.mjs
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const problems = []
const notes = []

/**
 * 读文本并**归一化为 LF**。
 *
 * 仓库根有 `.gitattributes`（`* text=auto eol=lf`），理论上检出就是 LF；
 * 但这条链路上任何一环没生效（例如某台机器上 `core.autocrlf=false` 且有工具
 * 把文件写回 CRLF），带 `^...$` 锚点的规则会**静默失配**——`$` 只认 `\n` 之前的
 * 位置，行尾的 `\r` 会让 `^backend\/build$` 匹配不上。这类失效只在 Windows 上
 * 出现，本地永远看不到，所以在这里一次性归一化，而不是给每条正则加 `\r?`。
 */
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const exists = (p) => fs.existsSync(path.join(ROOT, p))

const dockerfile = read('docker/Dockerfile')
const entrypoint = read('docker/entrypoint.sh')
const serverIndex = read('docker/server/index.ts')
const serverConfig = read('docker/server/vite.config.ts')
const composeRoot = read('docker-compose.yml')
const composeDocker = read('docker/docker-compose.yml')

// ===== 1. 运行依赖的版本与哈希只能来自清单 =====
//
// 允许出现的形式：`scripts/deps-asset.mjs` 从 assets.gen.go 里取。
// 禁止出现的形式：Dockerfile 里直接写死一个 SHA-256 或日期版本号。
const HARDCODED_SHA = /\b[0-9a-f]{64}\b/
if (HARDCODED_SHA.test(dockerfile)) {
  problems.push(
    'docker/Dockerfile 里写了写死的 SHA-256。运行依赖的哈希必须来自 ' +
    'backend/internal/manifest/assets.gen.go（经 scripts/deps-asset.mjs），' +
    '否则 pnpm deps:manifest 升级后镜像会静默停在旧版本。',
  )
}
if (/ARG\s+YTDLP_VERSION|ARG\s+FFMPEG_VERSION/.test(dockerfile)) {
  problems.push(
    'docker/Dockerfile 又出现了 YTDLP_VERSION / FFMPEG_VERSION 这类手写版本号。' +
    '镜像里的依赖版本必须与桌面版清单一致，否则同一台机器上「容器版能下、桌面版不能下」' +
    '（或反过来），而且不会报错。',
  )
}
if (!/scripts\/deps-asset\.mjs/.test(dockerfile)) {
  problems.push('docker/Dockerfile 没有通过 scripts/deps-asset.mjs 取依赖资产（版本会与清单漂移）')
}

// ===== 2. 校验发生在安装之前 =====
//
// 顺序写反（先 chmod +x 再校验）虽然也能跑，但一旦 os/arch 拿错，
// 失败信息会变成「forge 出来的二进制无法执行」，看起来像网络问题。
{
  const shaIdx = dockerfile.indexOf('sha256sum -c')
  if (shaIdx === -1) {
    problems.push('docker/Dockerfile 下载运行依赖后没有 sha256sum -c 校验（构建期发现不了坏包）')
  }
}

// ===== 3. 不能退回 tsx 运行 =====
if (exists('docker/package.json')) {
  problems.push(
    'docker/package.json 又出现了。服务端已在构建期打成单文件，运行期不需要任何 npm 依赖；' +
    '这一层会让镜像多 37MB 且启动要重新转译。',
  )
}
if (/docker\/node_modules/.test(dockerfile)) {
  problems.push('docker/Dockerfile 又引用了 docker/node_modules（应当运行打包后的单文件）')
}
{
  // 只查**非注释行**。早先这里多写了一个 `!/^\s*#/m.test(...)` 的外层条件，
  // 而 entrypoint 一定有注释行 —— 于是整条规则永远不触发（实测把启动命令改成
  // `npx tsx ...` 也照样通过）。检查写了但从不生效，比没写更糟。
  const code = entrypoint.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
  if (/\btsx\b/.test(code)) {
    problems.push('docker/entrypoint.sh 又用 tsx 启动服务（应直接 node docker/dist-server/index.js）')
  }
}
{
  // 只查**指令行**：注释里出现 tsx 正是在解释「为什么不再用它」
  const instructions = dockerfile
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n')
  if (/\btsx\b/.test(instructions)) {
    problems.push('docker/Dockerfile 里仍在安装/使用 tsx')
  }
}

// ===== 4. 服务端产物必须真的存在，且 SSR 配置把依赖打进来 =====

// 只看代码行：注释里提到 noExternal 正是在解释它为什么必需
const serverConfigCode = serverConfig
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n')
if (!/noExternal/.test(serverConfigCode)) {
  problems.push(
    'docker/server/vite.config.ts 没有 ssr.noExternal。Vite 的 SSR 构建默认把 ' +
    'package.json 的 dependencies 全部留成运行期 import —— 镜像里没有 node_modules，' +
    '启动会直接 Cannot find package。',
  )
}
if (!/electron-shim/.test(serverConfig)) {
  problems.push('docker/server/vite.config.ts 的 electron 别名丢了（构建期会报 Cannot find package electron）')
}

// ===== 5. 容器版更新检查不能退化成常量 =====
if (/checkForUpdates'\s*:\s*\(\)\s*=>\s*\(\{\s*hasUpdate:\s*false/.test(serverIndex)) {
  problems.push(
    "docker/server/index.ts 的 app:checkForUpdates 又变回常量 { hasUpdate: false }。" +
    '容器版用户一装几个月，yt-dlp 会随站点改版逐渐失效 —— 没有提示时用户只会觉得「下载器坏了」。',
  )
}
if (!/checkContainerUpdate/.test(serverIndex)) {
  problems.push('docker/server/index.ts 不再调用 checkContainerUpdate（容器版更新检查缺失）')
}

// ===== 6. 镜像里不能跑 root 以外的固定 uid =====
//
// /data 是宿主机 bind mount，属主由 NAS / 软路由决定。固定 uid 的结果是
// 默认「下载目录没有写权限」，而报错是 yt-dlp 的 EACCES，用户很难归因。
if (/^\s*USER\s+(?!root)\S+/m.test(dockerfile)) {
  problems.push(
    'docker/Dockerfile 切到了固定 uid。请保持默认用户，需要最小权限时在 compose 里用 user: 指定 —— ' +
    '/data 的属主由宿主机决定，固定 uid 会让「下载目录不可写」成为默认结果。',
  )
}

// ===== 7. 构建上下文不能带宿主机平台产物 =====
{
  const dockerignore = read('.dockerignore')
  if (!/^backend\/build\/?$/m.test(dockerignore)) {
    problems.push(
      '.dockerignore 没有排除 backend/build：宿主机的边车产物是宿主平台的（macOS 上就是 darwin-*），' +
      '会被 COPY 进 Linux 镜像（实测多出 34MB）。',
    )
  }
  if (!/^docker\/dist-server\/?$/m.test(dockerignore)) {
    problems.push('.dockerignore 没有排除 docker/dist-server（本地构建产物会混进上下文）')
  }
}

// ===== 8. 两份 compose 都要能直接跑，且指向同一个 Dockerfile =====
//
// 用户可能在仓库根目录跑（README 的写法），也可能在 docker/ 目录里跑
// （docs/docker.md 的写法）。两份配置漂移的表现是「按文档做，端口/卷不一样」。
for (const [file, text] of [['docker-compose.yml', composeRoot], ['docker/docker-compose.yml', composeDocker]]) {
  if (!/dockerfile:\s*docker\/Dockerfile/.test(text)) {
    problems.push(`${file} 指向的 Dockerfile 不是 docker/Dockerfile`)
  }
  if (!/DOWNVID_WEB_HOST:\s*0\.0\.0\.0/.test(text)) {
    problems.push(`${file} 没有设置 DOWNVID_WEB_HOST=0.0.0.0（容器内不监听 → 宿主机连不上）`)
  }
  if (!/\/data\/downloads/.test(text) || !/\/data\/userdata/.test(text)) {
    problems.push(`${file} 没有同时挂载 /data/downloads 与 /data/userdata（数据会丢在容器里）`)
  }
}

// ===== 9. 镜像里的心跳/健康检查不能引用不存在的端点 =====
if (!/HEALTHCHECK/.test(dockerfile)) {
  notes.push('docker/Dockerfile 没有 HEALTHCHECK（compose 里有等价配置，但 docker run 就没有探针了）')
}
if (!/\/healthz/.test(dockerfile) && /HEALTHCHECK/.test(dockerfile)) {
  problems.push('docker/Dockerfile 的 HEALTHCHECK 没有查 /healthz')
}
if (!/'\/healthz'|"\/healthz"|\/healthz/.test(serverIndex)) {
  problems.push('docker/server/index.ts 没有 /healthz 端点（健康检查与冒烟都会失败）')
}

// ===== 10. 构建产物路径三处一致 =====
{
  const distServerDir = 'docker/dist-server'

  /** 去掉注释行后的代码文本：注释里提到路径是在解释它，不算「配置正确」 */
  const codeOf = (text) =>
    text
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*|#)/.test(l))
      .join('\n')

  const configCode = codeOf(serverConfig)
  const dfileCode = codeOf(dockerfile)
  const entryCode = codeOf(entrypoint)

  if (!/outDir[^\n]*dist-server/.test(configCode)) {
    problems.push(`docker/server/vite.config.ts 的 outDir 不再是 ${distServerDir}（与 Dockerfile / entrypoint 必须一致）`)
  }
  if (!entryCode.includes(`${distServerDir}/index.js`)) {
    problems.push(`docker/entrypoint.sh 启动的路径与 ${distServerDir}/index.js 不一致`)
  }
  if (!dfileCode.includes(distServerDir)) {
    problems.push(`docker/Dockerfile 没有把 ${distServerDir} 拷进镜像`)
  }
}

// ===== 11. 容器侧的类型检查不能退化成空 =====
{
  const cfg = read('docker/server/tsconfig.json')
  // 注意键名带引号（`"moduleResolution": "bundler"`），正则必须允许引号，
  // 否则这条检查永远不会命中——「检查写了但从不生效」比没写更糟。
  if (/["']?moduleResolution["']?\s*:\s*["'](node16|nodenext)["']/.test(cfg)) {
    problems.push(
      'docker/server/tsconfig.json 用了 node16/nodenext：本仓库的导入不带扩展名，' +
      '这会让整棵树报出二十来条 TS2835，真正的类型错误被淹没（曾经就是这样没人看它）。',
    )
  }
  if (!/bundler/.test(cfg)) {
    problems.push('docker/server/tsconfig.json 的 moduleResolution 应与 vite 的实际解析方式一致（bundler）')
  }
  const pkg = JSON.parse(read('package.json'))
  if (!pkg.scripts?.['typecheck:docker']) {
    problems.push('package.json 缺少 typecheck:docker 脚本（容器侧类型检查不进 vue-tsc，必须单独跑）')
  }
}

// ===== 12. compose 里的镜像坐标必须与 shared/app.ts 一致 =====
//
// 换仓库或改 owner 时，工作流用 `github.repository_owner` 推镜像，
// 而 compose 里是写死的 `ghcr.io/<owner>/downvid`。写错的表现是
// 「docker compose pull 拉到别人的/不存在的镜像」或「一直拉到旧 owner 的旧镜像」，
// 两种都不报错。
{
  const app = read('shared/app.ts')
  const owner = /owner:\s*'([^']+)'/.exec(app)?.[1]
  const repo = /repo:\s*'([^']+)'/.exec(app)?.[1]
  if (!owner || !repo) {
    problems.push('shared/app.ts 里解析不出 owner/repo（格式变了？）')
  } else {
    const expected = `ghcr.io/${owner}/${repo}`
    for (const [file, text] of [['docker-compose.yml', composeRoot], ['docker/docker-compose.yml', composeDocker]]) {
      for (const m of text.matchAll(/ghcr\.io\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/g)) {
        if (!m[0].startsWith(expected)) {
          problems.push(`${file} 引用了 ${m[0]}，但仓库坐标是 ${expected}（换 owner 时会拉到错误镜像/旧镜像）`)
        }
      }
    }
  }
}

// ===== 输出 =====
if (notes.length) {
  console.log('提示：')
  for (const n of notes) console.log(`  - ${n}`)
}

if (problems.length) {
  console.error('\n容器镜像定义校验未通过：')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}

console.log('容器镜像定义校验通过：依赖版本来自清单、服务端为打包产物、更新检查未退化、两份 compose 一致。')

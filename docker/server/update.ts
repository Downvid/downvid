import path from 'node:path'
import fs from 'node:fs'
import { APP, REPO_SLUG } from '../../shared/app'
import { compareVersions, normalizeUpdateSource, type UpdateSourceId } from '../../shared/update-sources'
import { lookupLatestRelease, summarizeFailures, type FetchLike } from '../../shared/update-check'

/**
 * 容器版的「更新检查」。
 *
 * ## 为什么容器里要单独做一套
 *
 * 桌面版靠 electron-updater 下载安装包并静默替换，容器里没有这条路：
 * 进程跑在镜像的只读层里，**任何「自更新」都会在下次 `docker run` 时消失**。
 * 容器版的升级方式只有一条：拉新镜像 + 重建容器。
 *
 * 但这不代表容器版不需要检查更新 —— 恰恰相反：自托管用户往往一装就是几个月，
 * 而旧的 yt-dlp 会随着站点改版逐渐失效。没有提示，用户只会觉得「下载器坏了」。
 * 所以这里做的事情是：
 *
 *   1. 用与桌面版**同一份**更新源链路（`shared/update-sources.ts`）查最新版本；
 *   2. 比对当前镜像里的应用版本；
 *   3. 如果启动时带着 `DOWNVID_IMAGE` 环境变量（compose 里写了镜像名），
 *      就顺带问一次镜像仓库，看有没有新 tag（优先用 digest 比对，比版本号可靠）。
 *
 * 返回的结果只用于**展示升级命令**，不执行任何写操作。
 */

/** compose 里传进来的镜像名，例如 `ghcr.io/yxxbc/downvid:latest` */
const IMAGE = process.env.DOWNVID_IMAGE || ''
/** 显式指定镜像仓库地址（私有 registry / 自建 Harbor 时用） */
const REGISTRY = process.env.DOWNVID_REGISTRY || 'ghcr.io'

export interface ContainerUpdateState {
  /** 当前镜像内的应用版本（= package.json 的 version，构建时即确定） */
  currentVersion: string
  /** 各更新源里查到的最新版本；全挂时为 null */
  latestVersion: string | null
  /** 是否有新版本可用 */
  hasUpdate: boolean
  /** 镜像仓库里是否有新的 digest（undefined = 没检查 / 检查失败） */
  imageOutdated?: boolean
  /** 升级方式：容器版永远是「拉镜像 + 重建」 */
  upgrade: {
    /** 面向用户的命令，多行；前端用 <pre> 或代码块原样展示 */
    commands: string[]
    /** compose 文件位置提示（有 compose 就用 `docker compose pull`） */
    compose: boolean
  }
  /** 检查失败时的说明（每个源分别怎么失败的），成功时为 null */
  error: string | null
  /** 从哪个源拿到的答案（诊断用） */
  source: string | null
  checkedAt: string
}

/**
 * 升级命令。
 *
 * 有 compose 时给 `docker compose pull && up -d`——用户自己 pull 再 up 容易漏掉
 * 重建，而**漏掉重建的表现为「拉成功但版本没变」**，极难自行定位。
 */
export function upgradeCommands(image: string): { commands: string[]; compose: boolean } {
  const ref = image || `ghcr.io/${REPO_SLUG}:latest`
  return {
    commands: [
      'docker compose pull downvid',
      'docker compose up -d downvid',
      '# 或者（不通过 compose）',
      `docker pull ${ref}`,
    ],
    compose: true,
  }
}

/**
 * Docker Registry HTTP API v2 的匿名 token + manifest 查询。
 *
 * 只比 **digest** 而不是 tag：`latest` 这种 tag 会被就地覆盖，标签名永远不变，
 * 拿 tag 名比等于永远「已是最新」。digest 是内容哈希，变了就是真的换了镜像。
 *
 * 私有仓库（GHCR 的包默认就是 private）会返回 401，这里如实报失败，
 * 不重试也不要 token —— 用户没登录时本来就拉不到，提示他去 `docker login` 更有用。
 */
async function fetchRemoteDigest(image: string): Promise<{ digest: string | null; error?: string }> {
  const ref = image.replace(/^https?:\/\//, '')
  const [name, tag = 'latest'] = ref.includes(':') && !ref.includes('/_') && ref.lastIndexOf(':') > ref.lastIndexOf('/')
    ? [ref.slice(0, ref.lastIndexOf(':')), ref.slice(ref.lastIndexOf(':') + 1)]
    : [ref, 'latest']

  const host = name.includes('/') ? name.split('/')[0] : REGISTRY
  const repoPath = name.includes('/') ? name.split('/').slice(1).join('/') : name
  if (!host.includes('.') && !host.includes(':')) {
    return { digest: null, error: `无法解析镜像仓库地址：${image}` }
  }

  const base = `https://${host}`
  const headers: Record<string, string> = {
    Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
  }

  // 匿名 token：GHCR / Docker Hub 都要求先取 token（带 repository 权限）
  const tokenUrl = `${base}/token?scope=repository:${repoPath}:pull&service=${host}`
  try {
    const tokenRes = await fetch(tokenUrl)
    if (tokenRes.ok) {
      const body: any = await tokenRes.json()
      if (body?.token) headers.Authorization = `Bearer ${body.token}`
    }
  } catch {
    // 拿不到 token 就直接试匿名请求：有些自建 registry 不要求
  }

  try {
    const res = await fetch(`${base}/v2/${repoPath}/manifests/${tag}`, { headers })
    if (res.status === 401 || res.status === 403) {
      return { digest: null, error: '镜像仓库需要登录（GHCR 的包默认是私有）' }
    }
    if (!res.ok) return { digest: null, error: `镜像仓库返回 HTTP ${res.status}` }
    const digest = res.headers.get('docker-content-digest')
    return { digest }
  } catch (e: any) {
    return { digest: null, error: `镜像仓库不可达：${e?.message || e}` }
  }
}

/** 当前容器镜像的 digest（如果运行时注入了；compose 默认不会） */
function currentImageDigest(): string | null {
  const fromEnv = process.env.DOWNVID_IMAGE_DIGEST
  if (fromEnv) return fromEnv.trim()
  return null
}

/**
 * 检查容器版更新。
 *
 * @param rawSource 渲染进程同步过来的更新源（可选；默认按环境变量 / auto）
 */
export async function checkContainerUpdate(rawSource?: unknown): Promise<ContainerUpdateState> {
  const currentVersion = readAppVersion()
  const source: UpdateSourceId = normalizeUpdateSource(rawSource ?? process.env.DOWNVID_UPDATE_SOURCE)
  const checkedAt = new Date().toISOString()
  const upgrade = upgradeCommands(IMAGE)

  const nodeFetch: FetchLike = (url, init) => fetch(url, init as any)
  const { release, attempts } = await lookupLatestRelease({
    source,
    fetch: nodeFetch,
    headers: { 'User-Agent': `DownVid-Container/${currentVersion}` },
  })

  let imageOutdated: boolean | undefined
  if (IMAGE) {
    const remote = await fetchRemoteDigest(IMAGE)
    const local = currentImageDigest()
    if (remote.digest && local) imageOutdated = remote.digest !== local
    // 没注入本地 digest 时无法判断，保留 undefined 而不是猜一个 false：
    // 「猜成已最新」会让用户以为检查过了，其实什么也没比
  }

  const hasUpdate = release ? compareVersions(release.version, currentVersion) > 0 : imageOutdated === true

  return {
    currentVersion,
    latestVersion: release?.version ?? null,
    hasUpdate,
    imageOutdated,
    upgrade,
    error: release ? null : summarizeFailures(attempts),
    source: release?.source ?? null,
    checkedAt,
  }
}

/**
 * 读应用版本。
 *
 * 打包后的服务端是单文件（`docker/dist-server/index.js`），`__dirname`
 * 已不是源码目录，因此不能像源码版那样 `../..` 再读 package.json。
 * 这里按「先找 package.json，找不到就用构建期注入的环境变量」的顺序来：
 * Dockerfile 会在构建阶段把版本号写进 `DOWNVID_APP_VERSION`，两者都能用。
 */
function readAppVersion(): string {
  const injected = process.env.DOWNVID_APP_VERSION
  if (injected) return injected
  const candidates = [
    path.join(process.env.APP_ROOT || process.cwd(), 'package.json'),
    path.join(process.cwd(), 'package.json'),
  ]
  for (const file of candidates) {
    try {
      const version = JSON.parse(fs.readFileSync(file, 'utf8')).version
      if (typeof version === 'string' && version) return version
    } catch {}
  }
  return '0.0.0'
}

/** 供健康探针展示的构建信息（镜像名 / 版本），不包含任何密钥 */
export function containerInfo() {
  return {
    app: APP.name,
    image: IMAGE || null,
    repo: REPO_SLUG,
    version: readAppVersion(),
    tz: process.env.TZ || null,
  }
}

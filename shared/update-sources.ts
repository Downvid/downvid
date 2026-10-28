import { APP, GITHUB_API, REPO_SLUG, WEBSITE_URL } from './app'

/**
 * 更新源的可选 ID 与展示文案（前端设置页的契约）。
 *
 * 实际网络请求由 `app/internal/update/wml.go` 的 wmlUpdate 配置执行：
 *
 *   1. `github`  —— 官方 API / Release（海外用户的正常路径）
 *   2. `ghproxy` —— GitHub API 经 gh-proxy 透传
 *   3. `static`  —— 官网 / jsDelivr / Gitee 读取同一份
 *                  `website/updates/manifest.json`
 *
 * `auto` 是以上三级的组合；用户仍可钉死单个源。这里保留 ID 列表与标签，
 * 是因为设置页、i18n 与 `UPDATE_SOURCE_IDS` 的双向校验都依赖它。
 * 新增源时必须同时改 `wmlSource` + `wmlManifestURLs`、这里、两份词条与设置 UI。
 *
 * 纯数据 + 纯函数：不读 `localStorage`、不读 `process.env`、不发起请求。
 */

export type UpdateSourceId = 'auto' | 'github' | 'jsdelivr' | 'ghproxy' | 'gitee' | 'website'

/** 用户可选的更新源（`auto` 排第一，是默认值） */
export const UPDATE_SOURCE_IDS: readonly UpdateSourceId[] = [
  'auto',
  'github',
  'jsdelivr',
  'ghproxy',
  'gitee',
  'website',
] as const

/**
 * `auto` 的降级顺序。
 *
 * `website` 排在最后是刻意的：它只能回答「最新版本是多少」，给不出安装包与校验值，
 * 等于让用户手动去点下载页。把它放在前面会让「自动更新」在 GitHub 短暂抽风时
 * 悄悄退化成「手动下载」。
 */
export const AUTO_CHAIN: readonly Exclude<UpdateSourceId, 'auto'>[] = [
  'github',
  'jsdelivr',
  'ghproxy',
  'gitee',
  'website',
] as const

/**
 * 单个源的失败原因分类。
 *
 * 分类而不是直接抛原文，是因为两种失败要**区别对待**：
 *   - `unreachable` / `rate-limited` / `server`：换下一个源
 *   - `not-found`：源是通的，只是这个仓库/版本不存在（Gitee 没同步、jsDelivr
 *     还没缓存到新 tag）——同样换下一个，但要在诊断里说清楚
 * 用户看到的最终文案由 `describeSourceFailure()` 生成，不直接暴露 HTTP 细节。
 */
export type SourceFailure = 'unreachable' | 'rate-limited' | 'not-found' | 'server' | 'bad-response'

/** 把 HTTP 状态码归类成 SourceFailure */
export function classifyHttpStatus(status: number): SourceFailure {
  if (status === 404 || status === 410 || status === 451) return 'not-found'
  if (status === 403 || status === 429) return 'rate-limited'
  if (status >= 500) return 'server'
  if (status >= 400) return 'not-found'
  return 'bad-response'
}

/** 把 fetch 抛出的异常（DNS / TLS / 超时）归为不可达 */
export function classifyThrownError(error: unknown): SourceFailure {
  const msg = String((error as any)?.message ?? error ?? '')
  if (/abort|timeout|timed? ?out|ETIMEDOUT/i.test(msg)) return 'unreachable'
  return 'unreachable'
}

export interface Candidate {
  source: Exclude<UpdateSourceId, 'auto'>
  /** 发起请求的完整 URL */
  url: string
  /** 该 URL 返回的是 JSON 元数据，还是纯文本版本号 */
  kind: 'json' | 'text'
}

/**
 * 生成 `latest` 元数据的所有候选地址（按优先级）。
 *
 * @param source 用户设置；`auto` 展开成完整链路
 */
export function latestCandidates(source: UpdateSourceId = 'auto'): Candidate[] {
  const chain = source === 'auto' ? [...AUTO_CHAIN] : [source]
  const out: Candidate[] = []

  for (const id of chain) {
    switch (id) {
      case 'github':
        out.push({
          source: 'github',
          url: `${GITHUB_API}/repos/${REPO_SLUG}/releases/latest`,
          kind: 'json',
        })
        break
      case 'jsdelivr':
        // jsDelivr 的 GitHub 镜像 API：不限流、国内可达。
        // 注意它返回的不是 GitHub Release 的形状，字段由 parseLatestPayload 归一化。
        out.push({
          source: 'jsdelivr',
          url: `https://data.jsdelivr.com/v1/packages/gh/${REPO_SLUG}`,
          kind: 'json',
        })
        break
      case 'ghproxy':
        // gh-proxy 系列：把完整 URL 拼在反代域名后面。API 与 raw 都能透传。
        out.push({
          source: 'ghproxy',
          url: `https://gh-proxy.com/${GITHUB_API}/repos/${REPO_SLUG}/releases/latest`,
          kind: 'json',
        })
        break
      case 'gitee':
        // Gitee 的 Release API 形状与 GitHub 不同：返回数组，没有 /latest。
        out.push({
          source: 'gitee',
          url: `https://gitee.com/api/v5/repos/${REPO_SLUG}/releases?per_page=1`,
          kind: 'json',
        })
        break
      case 'website':
        // 官网把最新版本写在一个稳定的纯文本端点。之所以不是 `?format=json`：
        // 纯文本没有解析歧义，也方便用户自己 curl 验证。
        out.push({ source: 'website', url: `${WEBSITE_URL}/version.txt`, kind: 'text' })
        break
    }
  }
  return out
}

export interface LatestRelease {
  /** 不带 `v` 前缀的版本号 */
  version: string
  releaseNotes: string
  releaseDate: string
  /** 实际成功的那个源，用于诊断与日志 */
  source: Exclude<UpdateSourceId, 'auto'>
}

/**
 * 把各源的响应归一化成 `LatestRelease`。
 *
 * 返回 `null` 表示「这个源的响应解析不出可用的版本号」——调用方应当换下一个源。
 * 各源的形状差异：
 *   - GitHub：`{ tag_name, body, published_at }`
 *   - jsDelivr：`{ versions: [{ version }] }`（版本号**不带** v，且顺序不保证）
 *   - Gitee：`[{ tag_name, body, created_at }]`（数组）
 *   - website：`v1.4.0` 纯文本
 */
export function parseLatestPayload(source: Candidate['source'], payload: unknown): LatestRelease | null {
  const norm = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const v = value.trim().replace(/^v/i, '')
    return /^\d+(\.\d+)*([.-][0-9A-Za-z.-]+)?$/.test(v) ? v : null
  }

  if (source === 'website') {
    const version = norm(payload)
    return version ? { version, releaseNotes: '', releaseDate: '', source } : null
  }

  if (source === 'jsdelivr') {
    const versions = (payload as any)?.versions
    if (!Array.isArray(versions)) return null
    // jsDelivr 的 versions 是「所有 tag」，顺序不保证 → 自己挑最大的稳定版。
    // 只挑稳定版：预发布不应通过这条通道推给稳定用户。
    const stable = versions
      .map((entry: any) => norm(entry?.version))
      .filter((v: string | null): v is string => !!v && !/-(beta|alpha|rc|pre)/i.test(v))
    if (!stable.length) return null
    // 不用 `.at(-1)`：tsconfig 的 target 是 ES2020（桌面端要兼容的 Electron 版本
    // 远高于此，但类型库仍是 ES2020），`.at()` 在类型层面不存在。
    const version = stable.sort(compareVersions)[stable.length - 1]
    return { version, releaseNotes: '', releaseDate: '', source }
  }

  // GitHub 与 Gitee 都是 `tag_name` + `body`；Gitee 外面还包了一层数组
  const node = Array.isArray(payload) ? payload[0] : payload
  if (!node || typeof node !== 'object') return null
  const version = norm((node as any).tag_name ?? (node as any).name)
  if (!version) return null
  return {
    version,
    releaseNotes: typeof (node as any).body === 'string' ? (node as any).body : '',
    releaseDate: String((node as any).published_at ?? (node as any).created_at ?? ''),
    source,
  }
}

/**
 * 版本比较。与 `electron/updater.ts` 里的实现**必须一致**——两边各判一次
 * 「有没有更新」，判法不同会让「设置里说有更新、弹窗说已最新」。
 * 这里导出成共享函数，主进程改为调用它，避免第三份实现冒出来。
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/i, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * 人话版的失败说明（给 `deps:diagnostics` 同类的诊断面板与日志用）。
 *
 * 不把 HTTP 细节直接抛给用户：「403」对用户毫无意义，而「这个源限流了，
 * 正在换下一个」能让他知道不是自己网络坏了。
 */
export function describeSourceFailure(source: Candidate['source'], failure: SourceFailure): string {
  const label = SOURCE_LABELS[source]
  switch (failure) {
    case 'unreachable':
      return `${label} 无法连接`
    case 'rate-limited':
      return `${label} 请求被限流`
    case 'not-found':
      return `${label} 上找不到这个版本`
    case 'server':
      return `${label} 服务异常`
    default:
      return `${label} 返回了无法解析的内容`
  }
}

/** 源的展示名（诊断与日志用；界面文案仍走 i18n） */
export const SOURCE_LABELS: Record<Exclude<UpdateSourceId, 'auto'>, string> = {
  github: 'GitHub API',
  jsdelivr: 'jsDelivr',
  ghproxy: 'gh-proxy',
  gitee: 'Gitee',
  website: '官网',
}

/**
 * 校验用户设置里的源 id。
 *
 * 存档值可能是旧版本、手工改坏或未来版本；非法值一律回退 `auto`，
 * 而不是原样保留——否则「一个源都不试」会表现成「永远没有更新」。
 */
export function normalizeUpdateSource(value: unknown): UpdateSourceId {
  return typeof value === 'string' && (UPDATE_SOURCE_IDS as readonly string[]).includes(value)
    ? (value as UpdateSourceId)
    : 'auto'
}

/** 供设置面板展示的候选（顺序即展示顺序） */
export function updateSourceOptions(): Array<{ id: UpdateSourceId; label: string }> {
  return UPDATE_SOURCE_IDS.map((id) => ({ id, label: id }))
}

/** 仓库坐标（供容器侧拼镜像名等场景复用，避免再抄一份 owner/repo） */
export const REPO = { owner: APP.owner, repo: APP.repo, slug: REPO_SLUG }

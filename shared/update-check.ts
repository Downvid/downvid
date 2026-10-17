import {
  classifyHttpStatus,
  classifyThrownError,
  describeSourceFailure,
  latestCandidates,
  parseLatestPayload,
  type Candidate,
  type LatestRelease,
  type SourceFailure,
  type UpdateSourceId,
} from './update-sources'

/**
 * 「按链路依次尝试各更新源」的执行部分。
 *
 * 与 `shared/update-sources.ts` 的分工：
 *   - 那边是**纯数据**（有哪些源、URL 怎么拼、响应怎么归一化）
 *   - 这边只多一件事：发请求 + 决定换不换下一个源
 *
 * `fetch` 由调用方注入而不是直接用全局的，理由有三：
 *   1. 主进程要用 Electron 的 session（走用户配置的代理），不能裸用 Node 的 fetch；
 *   2. 容器服务用 Node 自带 fetch，不需要 Electron；
 *   3. 测试里塞一个假 fetch 就能覆盖全部分支，不需要真起网络。
 */

export interface FetchLike {
  (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<{
    ok: boolean
    status: number
    json?: () => Promise<unknown>
    text?: () => Promise<string>
  }>
}

export interface SourceAttempt {
  source: Candidate['source']
  url: string
  ok: boolean
  failure?: SourceFailure
  /** 失败的人话说明（写日志 / 诊断面板用，不直接给最终用户） */
  detail?: string
}

export interface LatestLookupResult {
  /** 全部成功时为解析结果；全挂时为 null */
  release: LatestRelease | null
  /** 每一次尝试的轨迹，顺序与链路一致 */
  attempts: SourceAttempt[]
}

export interface LatestLookupOptions {
  source?: UpdateSourceId
  fetch: FetchLike
  /** 单源超时（毫秒）。默认 8 秒：比一个 TTFB 宽松，又不至于让链路整体拖太久 */
  timeoutMs?: number
  /** 请求头（UA 是 GitHub 必填的，缺了直接 403） */
  headers?: Record<string, string>
  /** 每个源失败时的回调：主进程用它写日志（`log()` 在渲染进程里不可用） */
  onAttempt?: (attempt: SourceAttempt) => void
}

/**
 * 沿链路找最新版本。
 *
 * **不抛异常**：全挂时返回 `release: null` + 轨迹，由调用方决定文案。
 * 这里刻意不用 `throw`——「更新检查失败」是预期内的常见情况（离线、限流、
 * 国内网络），把它做成异常会让调用方到处写 try/catch，最后总有一处写成
 * 「catch 了就当作已是最新」，那正是最难发现的故障。
 */
export async function lookupLatestRelease(options: LatestLookupOptions): Promise<LatestLookupResult> {
  const { fetch, source = 'auto', timeoutMs = 8000, headers, onAttempt } = options
  const attempts: SourceAttempt[] = []

  for (const candidate of latestCandidates(source)) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
    try {
      const response = await fetch(candidate.url, {
        headers: { Accept: 'application/json, text/plain;q=0.9', ...headers },
        signal: controller?.signal,
      })

      if (!response.ok) {
        throw Object.assign(new Error(`HTTP ${response.status}`), { __status: response.status })
      }

      let payload: unknown
      if (candidate.kind === 'text') {
        payload = await response.text?.()
      } else {
        payload = await response.json?.()
      }

      const release = parseLatestPayload(candidate.source, payload)
      if (!release) {
        const attempt: SourceAttempt = {
          source: candidate.source,
          url: candidate.url,
          ok: false,
          failure: 'bad-response',
          detail: describeSourceFailure(candidate.source, 'bad-response'),
        }
        attempts.push(attempt)
        onAttempt?.(attempt)
        continue
      }

      const attempt: SourceAttempt = { source: candidate.source, url: candidate.url, ok: true }
      attempts.push(attempt)
      onAttempt?.(attempt)
      return { release, attempts }
    } catch (error) {
      const failure: SourceFailure =
        (error as any)?.__status != null
          ? classifyHttpStatus((error as any).__status)
          : classifyThrownError(error)
      const attempt: SourceAttempt = {
        source: candidate.source,
        url: candidate.url,
        ok: false,
        failure,
        detail: describeSourceFailure(candidate.source, failure),
      }
      attempts.push(attempt)
      onAttempt?.(attempt)
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  return { release: null, attempts }
}

/**
 * 把整条链路的失败轨迹压成一句用户能看懂的话。
 *
 * 只列**试过的源**，不列 HTTP 码：用户能采取的行动只有「换个网络 / 配代理 /
 * 手动去下载页」，堆细节只会让他以为是自己搞错了什么。
 */
export function summarizeFailures(attempts: SourceAttempt[]): string {
  if (!attempts.length) return '没有可用的更新源'
  const names = attempts.map((a) => describeSourceFailure(a.source, a.failure ?? 'unreachable'))
  return names.join('；')
}

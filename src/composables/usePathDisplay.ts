import { ref } from 'vue'

/**
 * 路径显示工具。
 *
 * 界面里的绝对路径会把用户名暴露出来（`/Users/zhangsan/Downloads/...`），
 * 截图分享或录屏时属于不必要的隐私泄露。统一缩写成 `~/Downloads/...`。
 *
 * 主目录由主进程提供（`app:getHomeDir`），缓存一次即可——
 * 进程运行期间不会变。
 */

const homeDir = ref('')
let loading: Promise<string> | null = null

/** 预取主目录，供后续同步缩写使用 */
export async function ensureHomeDir(): Promise<string> {
  if (homeDir.value) return homeDir.value
  if (loading) return loading
  loading = window.electronAPI?.app?.getHomeDir?.()
    .then((dir: unknown) => {
      // 只接受非空字符串：拿不到时宁可原样显示完整路径，
      // 也不要让后续的字符串操作崩掉
      homeDir.value = typeof dir === 'string' ? dir : ''
      return homeDir.value
    })
    .catch(() => '')
    .finally(() => { loading = null })
  return loading
}

/**
 * 把绝对路径缩写成 `~/...` 形式。
 *
 * 主目录尚未取到时原样返回——宁可短暂显示完整路径，也不要显示成
 * 错误的缩写。Windows 上分隔符不同，两种都处理。
 */
export function abbreviatePath(inputPath: string | undefined | null): string {
  if (!inputPath) return ''
  const home = homeDir.value
  if (!home) return inputPath

  // 主目录本身
  if (inputPath === home) return '~'

  for (const sep of ['/', '\\']) {
    const prefix = home.endsWith(sep) ? home : home + sep
    if (inputPath.startsWith(prefix)) return '~' + sep + inputPath.slice(prefix.length)
  }
  return inputPath
}

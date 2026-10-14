import { ipcMain, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ESM 没有 __dirname，需要自己算（与 main.ts 一致）。
// 直接用 __dirname 会在运行时抛 `__dirname is not defined` —— 这个错被空 catch 吞掉后
// 表现为"贡献者列表加载失败"，很难定位。
const __dirname = path.dirname(fileURLToPath(import.meta.url))
import { checkForUpdates, downloadUpdate, installUpdate, setUpdaterPrefs } from '../updater'

export function registerAppIpc() {
  ipcMain.handle('app:getVersion', () => app.getVersion())

  /**
   * 贡献者列表：直接读**随包分发的快照**，运行时不再请求 GitHub API。
   *
   * 原先启动时请求 /contributors 与 /commits，而未认证请求的限额是 60 次/小时、
   * 按来源 IP 共享 —— 一次刷新 3 个请求，多人共用出口 IP 时很容易耗尽，
   * 界面就报 403、列表拿不到。客户端带 token 不可行（等于把凭据打进安装包），
   * 因此改为构建期生成快照（`pnpm contributors:sync`，做法参考 Axolotl）。
   *
   * 好处：不再有 403、离线可见、启动更快。代价是名单只在发版时更新。
   */
  ipcMain.handle('app:getContributors', async () => {
    try {
      const list = await loadContributorsSnapshot()
      if (!list.length) return { success: false, error: '贡献者数据为空' }
      return { success: true, data: list, fromCache: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '读取贡献者数据失败' }
    }
  })

  /** 读取随包分发的贡献者快照 */
  async function loadContributorsSnapshot(): Promise<any[]> {
    // 开发态在项目根，打包后在 app.asar 内（相对 main.js 的位置一致）
    // 开发态：APP_ROOT 指向项目根
    // 打包后：main.js 在 app.asar/dist-electron/ 下，往上一级即 asar 根
    const candidates = [
      path.join(process.env.APP_ROOT || '', 'shared', 'contributors.json'),
      path.join(__dirname, '..', 'shared', 'contributors.json'),
    ]

    const tried = []
    for (const file of candidates) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
        if (Array.isArray(parsed) && parsed.length) return parsed
        tried.push(`${file}（内容为空或格式不对）`)
      } catch (e) {
        // 记下失败原因：全部候选都失败时一并抛出，便于定位
        tried.push(`${file}（${e instanceof Error ? e.message : '读取失败'}）`)
      }
    }
    throw new Error(`未找到贡献者数据文件：\n${tried.join('\n')}`)
  }

  // 手动检查：忽略自动检查开关
  ipcMain.handle('app:checkForUpdates', () => checkForUpdates(true))
  ipcMain.handle('app:setUpdatePrefs', (_, prefs: { autoCheck?: boolean; autoDownload?: boolean }) => {
    setUpdaterPrefs(prefs || {})
    return true
  })
  ipcMain.handle('app:downloadUpdate', () => downloadUpdate())
  ipcMain.handle('app:installUpdate', () => installUpdate())
}

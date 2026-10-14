import { ipcMain, app } from 'electron'
import { APP } from '../constants'
import fs from 'node:fs'
import path from 'node:path'
import { fetchAllContributors } from '../utils/contributors'
import { broadcast } from '../store'
import { checkForUpdates, downloadUpdate, installUpdate } from '../updater'

// 贡献者内存缓存
let contributorsCache: any[] | null = null
let contributorsCacheTime = 0
const MEMORY_CACHE_TTL = 1000 * 60 * 30 // 内存缓存 30 分钟
const FILE_CACHE_TTL = 1000 * 60 * 60 * 24 * 7 // 文件缓存 7 天
// 缓存格式版本：v2 起包含匿名作者与 Co-authored-by 共同作者，旧缓存不完整需丢弃
const FILE_CACHE_VERSION = 2

// 本地缓存文件路径
function getContributorsCachePath() {
  return path.join(app.getPath('userData'), 'contributors.json')
}

// 读取本地文件缓存
function readFileCache(): { data: any[]; updatedAt: number } | null {
  try {
    const cachePath = getContributorsCachePath()
    if (fs.existsSync(cachePath)) {
      const content = fs.readFileSync(cachePath, 'utf-8')
      const parsed = JSON.parse(content)
      if (parsed.version === FILE_CACHE_VERSION && Array.isArray(parsed.data)) {
        return { data: parsed.data, updatedAt: parsed.updatedAt || 0 }
      }
    }
  } catch {}
  return null
}

// 写入本地文件缓存
function writeFileCache(data: any[]) {
  try {
    const cachePath = getContributorsCachePath()
    fs.writeFileSync(cachePath, JSON.stringify({ version: FILE_CACHE_VERSION, data, updatedAt: Date.now() }, null, 2), 'utf-8')
  } catch {}
}

// 从 GitHub API 获取贡献者（含匿名作者、Bot 与 AI 共同作者）
function fetchContributorsFromAPI() {
  return fetchAllContributors(APP.owner, APP.repo)
}

export function registerAppIpc() {
  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('app:getContributors', async () => {
    // 1. 命中内存缓存
    if (contributorsCache && Date.now() - contributorsCacheTime < MEMORY_CACHE_TTL) {
      return { success: true, data: contributorsCache, fromCache: true }
    }

    // 2. 读取本地文件缓存
    const fileCache = readFileCache()
    const fileCacheValid = fileCache && Date.now() - fileCache.updatedAt < FILE_CACHE_TTL

    // 如果文件缓存有效，先返回缓存，同时后台静默更新
    if (fileCacheValid && fileCache) {
      contributorsCache = fileCache.data
      contributorsCacheTime = fileCache.updatedAt

      // 后台静默更新（不阻塞返回）
      fetchContributorsFromAPI()
        .then((data) => {
          contributorsCache = data
          contributorsCacheTime = Date.now()
          writeFileCache(data)
          // 必须广播：否则界面拿到的还是本次返回的旧列表，用户要重启应用
          // 才能看到新贡献者（文件缓存 TTL 有 7 天，等它自然过期更不现实）
          broadcast('contributors:updated', data)
        })
        .catch(() => {})

      return { success: true, data: fileCache.data, fromCache: true }
    }

    // 3. 调用 GitHub API
    try {
      const data = await fetchContributorsFromAPI()

      // 更新内存缓存和文件缓存
      contributorsCache = data
      contributorsCacheTime = Date.now()
      writeFileCache(data)

      return { success: true, data }
    } catch (error) {
      // API 失败但有本地缓存（即使过期了），返回本地缓存
      if (fileCache) {
        contributorsCache = fileCache.data
        contributorsCacheTime = fileCache.updatedAt
        return {
          success: true,
          data: fileCache.data,
          fromCache: true,
          warning: '无法连接 GitHub，显示缓存数据',
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : '获取贡献者失败',
      }
    }
  })

  ipcMain.handle('app:checkForUpdates', () => checkForUpdates())
  ipcMain.handle('app:downloadUpdate', () => downloadUpdate())
  ipcMain.handle('app:installUpdate', () => installUpdate())
}

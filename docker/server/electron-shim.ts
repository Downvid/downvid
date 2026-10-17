import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

/**
 * `electron` 模块在容器里的替身。
 *
 * ## 它为什么存在
 *
 * `electron/download/`、`electron/parsers/`、`electron/utils/` 这些是**真正的业务代码**，
 * 桌面版与容器版共用。它们 `import { app } from 'electron'`，而在 Node 里没有这个模块。
 * 这个文件提供「够用就行的形状」，构建时由 vite 的 `electron` 别名（`docker/server/vite.config.ts`）
 * 与类型检查的 `paths`（`docker/server/tsconfig.json`）指过来，源码本身一行不改。
 *
 * ## 类型为什么写得这么细
 *
 * 早先这里是十几个 `as any` 一样宽的类型（`getAllWindows: () => [...]`、
 * `showMessageBox: async () => ({ response: 1 })`），于是 `docker/server/` 的类型检查
 * **一直是红的**（二十多条），久而久之就没人看它了 —— 那等于没有类型检查。
 *
 * 现在的约定是：签名按**调用方实际用到的形状**写全（例如 `showMessageBox` 的入参、
 * `BrowserWindow` 既是值又是类型）。新增用到的 Electron API 时，把它补到这里，
 * 而不是把调用处改成 `any`。
 */

export const wsEventBus = new EventEmitter()
wsEventBus.setMaxListeners(100)

const dataDir = process.env.DOWNVID_DATA_DIR || path.join(process.cwd(), 'data', 'userdata')

export const app = {
  getPath: (name: string) => {
    if (name === 'userData') return dataDir
    return os.homedir()
  },
  getVersion: () => process.env.DOWNVID_APP_VERSION || '0.0.0',
}

/** 一次「发消息给渲染进程」的目标。容器里对应的是 WebSocket 广播。 */
export interface ShimsWebContents {
  send: (channel: string, data: unknown) => void
}

export interface ShimWindow {
  isDestroyed: () => boolean
  webContents: ShimsWebContents
}

export const BrowserWindow = {
  getAllWindows: (): ShimWindow[] => [
    {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: unknown) => {
          wsEventBus.emit(channel, data)
        },
      },
    },
  ],
  getFocusedWindow: (): ShimWindow | null => null,
}

/** `BrowserWindow` 在源码里同时被当值用（`getAllWindows()`）和当类型用（`BrowserWindow | null`） */
export type BrowserWindow = ShimWindow

export interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  title?: string
  message: string
  detail?: string
  buttons?: string[]
  defaultId?: number
  cancelId?: number
  noLink?: boolean
}

export interface OpenDialogOptions {
  title?: string
  defaultPath?: string
  properties?: string[]
  filters?: Array<{ name: string; extensions: string[] }>
}

export const dialog = {
  // 容器里没有原生对话框：`response: 1` 等于用户点了「取消」。
  // 这样 `promptNodeDownload()` / `promptChromeDownload()` 不会去调 openExternal，
  // 也不会把「已帮你打开下载页」这种做不到的承诺显示给用户。
  showMessageBox: async (_win: ShimWindow | MessageBoxOptions | null, _opts?: MessageBoxOptions) => ({ response: 1 }),
  showOpenDialog: async (_win: ShimWindow | OpenDialogOptions | null, _opts?: OpenDialogOptions) => ({
    canceled: true,
    filePaths: [] as string[],
  }),
}

export const shell = {
  openPath: async (_path: string) => '',
  openExternal: async (_url: string) => {},
  showItemInFolder: (_path: string) => {},
}

export const clipboard = {
  readText: () => '',
  writeText: (_text: string) => {},
}

export const session = {
  defaultSession: {
    setProxy: async (_config: { proxyRules?: string }) => {},
  },
  fromPartition: (_partition: string) => ({
    setProxy: async (_config: { proxyRules?: string }) => {},
    fetch: async (_url: string, _init?: unknown) => ({ status: 204 }),
    clearStorageData: async () => {},
  }),
}

export const ipcMain = {
  handle: (_channel: string, _listener: (...args: unknown[]) => unknown) => {},
  on: (_channel: string, _listener: (...args: unknown[]) => unknown) => {},
}

/**
 * `process.resourcesPath` 是 Electron 注入的属性，Node 里没有。
 *
 * `electron/utils/runtime.ts` 用它拼打包后的边车路径。容器里这边车在
 * `/opt/downvid/backend/build/<platform>/`（由 `APP_ROOT` 那条候选命中），
 * 所以这里给 `null` 让那一条被跳过即可 —— 不能给一个假目录，
 * 否则会优先命中一个不存在的路径。
 */
export const processShim = {
  resourcesPath: undefined as string | undefined,
}

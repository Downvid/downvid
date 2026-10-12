import { BrowserWindow } from 'electron'

/**
 * 独立设置窗口。
 *
 * 单独成模块而不是放在 main.ts 里：menu.ts 与 ipc/system.ts 都需要打开它，
 * 若从 main.ts 导出，会形成 main → menu → main、main → ipc/system → main
 * 的循环导入。
 *
 * 窗口的加载地址由 main.ts 注入（需要知道 dev server 与打包路径），
 * 本模块只负责窗口本身的生命周期。
 */

export interface SettingsWindowDeps {
  /** 加载渲染进程页面，query 形如 `#view=settings` */
  load: (win: BrowserWindow, query: string) => void
  /** 主窗口与设置窗口共用的 webPreferences */
  webPreferences: () => Electron.WebPreferences
}

let deps: SettingsWindowDeps | null = null
let settingsWindow: BrowserWindow | null = null

export function configureSettingsWindow(next: SettingsWindowDeps) {
  deps = next
}

export function openSettingsWindow(): void {
  if (!deps) return
  // 已打开则聚焦，避免开出多个设置窗口
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 720,
    minHeight: 560,
    title: '设置',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: deps.webPreferences(),
  })

  deps.load(settingsWindow, '#view=settings')
  settingsWindow.on('closed', () => { settingsWindow = null })
}

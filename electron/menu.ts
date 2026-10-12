import { app, Menu } from 'electron'
import { getMainWindow } from './store'

/**
 * 设置窗口的打开方式由 main.ts 注入。
 *
 * 不直接 import main.ts：那会形成 main → menu → main 的循环导入。
 * 注入一个回调既避开循环，也让 menu 只关心"点了要发生什么"。
 */
let openSettings: (() => void) | null = null

export function setSettingsOpener(fn: () => void) {
  openSettings = fn
}

/**
 * 创建应用菜单。
 *
 * 只在 macOS 上创建：Windows / Linux 的 Electron 会把它渲染成窗口内的一条
 * 菜单栏，而应用自身的标题栏已由界面内的 Header 承担（titleBarStyle: 'hidden'），
 * 于是用户会看到一个多余的标签栏。
 *
 * 这些菜单项本身并不承载功能——快捷键（Cmd+Q、Cmd+M）与界面内的入口已经覆盖，
 * 因此 Windows / Linux 上直接不注册即可。
 */
export function createMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS 的惯例：应用名菜单里第一个是「关于」，随后是「设置…」⌘,
    // 这里的「设置」只有在设置窗口存在后才说得通
    {
      label: app.name,
      submenu: [
        { label: '关于 DownVid', click: () => getMainWindow()?.webContents.send('menu:showAbout') },
        { type: 'separator' },
        { label: '设置…', accelerator: 'Cmd+,', click: () => openSettings?.() },
        { type: 'separator' },
        { label: '隐藏 DownVid', role: 'hide' },
        { label: '隐藏其他', role: 'hideOthers' },
        { label: '显示全部', role: 'unhide' },
        { type: 'separator' },
        { label: '退出 DownVid', accelerator: 'Cmd+Q', click: () => app.quit() },
      ],
    },
    {
      label: '文件',
      submenu: [
        { label: '关闭窗口', accelerator: 'Cmd+W', role: 'close' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: '关闭', accelerator: 'CmdOrCtrl+W', role: 'close' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => getMainWindow()?.webContents.send('menu:showAbout'),
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

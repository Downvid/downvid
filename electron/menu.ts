import { app, Menu } from 'electron'
import { getMainWindow } from './store'

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
    {
      label: '文件',
      submenu: [
        {
          label: '退出',
          accelerator: 'Cmd+Q',
          click: () => app.quit(),
        },
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

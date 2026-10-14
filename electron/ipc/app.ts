import { ipcMain, app } from 'electron'
import { checkForUpdates, downloadUpdate, installUpdate, setUpdaterPrefs } from '../updater'

export function registerAppIpc() {
  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('app:checkForUpdates', () => checkForUpdates(true))
  ipcMain.handle('app:setUpdatePrefs', (_, prefs: { autoCheck?: boolean; autoDownload?: boolean }) => {
    setUpdaterPrefs(prefs || {})
    return true
  })
  ipcMain.handle('app:downloadUpdate', () => downloadUpdate())
  ipcMain.handle('app:installUpdate', () => installUpdate())
}

import { ipcMain, BrowserWindow, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { dedupeHistory, upsertHistory } from '../history'
import type { HistoryRecord } from '../../src/types'

const historyFile = path.join(app.getPath('userData'), 'download-history.json')

function readHistory(): HistoryRecord[] {
  try {
    if (fs.existsSync(historyFile)) {
      const saved = JSON.parse(fs.readFileSync(historyFile, 'utf8'))
      if (!Array.isArray(saved)) return []
      const history = dedupeHistory(saved).slice(0, 100)
      if (JSON.stringify(history) !== JSON.stringify(saved)) {
        try {
          const backup = historyFile + '.bak'
          if (!fs.existsSync(backup)) fs.copyFileSync(historyFile, backup, fs.constants.COPYFILE_EXCL)
          writeHistory(history)
        } catch (error) {
          console.error('整理下载历史失败：', error)
        }
      }
      return history
    }
  } catch {}
  return []
}

function writeHistory(history: HistoryRecord[]) {
  fs.writeFileSync(historyFile, JSON.stringify(history, null, 2))
}

function fileExists(filePath: string): boolean {
  try { return fs.statSync(filePath).isFile() } catch { return false }
}

function localHistory(history: HistoryRecord[]): HistoryRecord[] {
  return history.map(record => ({ ...record, fileExists: fileExists(record.filePath) }))
}

function notifyHistoryUpdated(history: HistoryRecord[]) {
  const updated = localHistory(history)
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) win.webContents.send('history:updated', updated)
  })
}

export function registerHistoryIpc() {
  ipcMain.handle('history:get', async () => localHistory(readHistory()))

  ipcMain.handle('history:add', async (_, record: any) => {
    const history = readHistory()
    if (typeof record?.filePath !== 'string' || !fileExists(record.filePath)) {
      throw new Error('下载文件不存在，无法加入历史')
    }
    const { id: _id, createdAt: _createdAt, fileExists: _fileExists, ...details } = record
    const trimmed = upsertHistory(history, details, randomUUID(), new Date().toISOString())
    writeHistory(trimmed)
    notifyHistoryUpdated(trimmed)
    return true
  })

  ipcMain.handle('history:delete', async (_, id: string) => {
    const history = readHistory().filter((h: any) => h.id !== id)
    writeHistory(history)
    notifyHistoryUpdated(history)
    return true
  })
}

import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

export const wsEventBus = new EventEmitter()
wsEventBus.setMaxListeners(100)

const dataDir = process.env.DOWNVID_DATA_DIR || path.join(process.cwd(), 'data', 'userdata')

export const app = {
  getPath: (name: string) => {
    if (name === 'userData') return dataDir
    return os.homedir()
  },
  getVersion: () => '1.3.4',
}

export const BrowserWindow = {
  getAllWindows: () => [
    {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, data: any) => {
          wsEventBus.emit(channel, data)
        },
      },
    },
  ],
  getFocusedWindow: () => null,
}

export const dialog = {
  showMessageBox: async () => ({ response: 1 }),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
}

export const shell = {
  openPath: async () => '',
  openExternal: async (url: string) => {},
  showItemInFolder: (path: string) => {},
}

export const clipboard = {
  readText: () => '',
  writeText: (text: string) => {},
}

export const session = {
  defaultSession: {
    setProxy: async () => {},
  },
  fromPartition: () => ({
    setProxy: async () => {},
    fetch: async () => ({ status: 204 }),
    clearStorageData: async () => {},
  }),
}

export const ipcMain = {
  handle: () => {},
  on: () => {},
}

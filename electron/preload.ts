import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

// 暴露 API 给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 剪贴板
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:readText'),
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),
  },
  
  // 对话框
  dialog: {
    selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
    selectFile: () => ipcRenderer.invoke('dialog:selectFile'),
  },
  
  // 应用
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getDefaultDownloadDir: () => ipcRenderer.invoke('app:getDefaultDownloadDir'),
    getHomeDir: () => ipcRenderer.invoke('app:getHomeDir'),
    cookieStatus: (manualFile?: string) => ipcRenderer.invoke('app:cookieStatus', manualFile),
    fetchImage: (url: string, referer?: string) => ipcRenderer.invoke('app:fetchImage', url, referer),
    getLog: () => ipcRenderer.invoke('app:getLog'),
    clearLog: () => ipcRenderer.invoke('app:clearLog'),
    openLogDir: () => ipcRenderer.invoke('app:openLogDir'),
    setProxy: (proxy: string) => ipcRenderer.invoke('app:setProxy', proxy),
    testProxy: (proxy: string) => ipcRenderer.invoke('app:testProxy', proxy),
    getDiskSpace: (dir?: string) => ipcRenderer.invoke('app:getDiskSpace', dir),
  },
  
  // 系统操作
  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
    showItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },
  
  // YT-DLP 操作
  ytdlp: {
    parse: (url: string, cookiesFile?: string, proxy?: string) => ipcRenderer.invoke('ytdlp:parse', url, cookiesFile, proxy),
    download: (options: { url: string; formatId: string; outputDir: string; filename?: string; taskId: string; directUrl?: string; cookiesFile?: string; downloadMode?: 'video' | 'audio' | 'subtitle'; audioTrack?: any; subtitles?: string[]; proxy?: string; cacheFile?: string; hasAudio?: boolean; filenameTemplate?: string }) => 
      ipcRenderer.invoke('ytdlp:download', options),
    pauseDownload: (taskId: string) => ipcRenderer.invoke('ytdlp:pauseDownload', taskId),
  },
  
  // 运行依赖（yt-dlp / ffmpeg / ffprobe）：探测复用系统安装，缺失时下载
  deps: {
    status: (settings?: any, force?: boolean) => ipcRenderer.invoke('deps:status', settings, force),
    check: (settings?: any) => ipcRenderer.invoke('deps:check', settings),
    download: (options?: any) => ipcRenderer.invoke('deps:download', options),
    cancel: () => ipcRenderer.invoke('deps:cancel'),
    openDir: () => ipcRenderer.invoke('deps:openDir'),
    diagnostics: () => ipcRenderer.invoke('deps:diagnostics'),
    onProgress: (callback: (data: any) => void) => {
      const handler = (_: any, data: any) => callback(data)
      ipcRenderer.on('deps:progress', handler)
      return () => {
        ipcRenderer.off('deps:progress', handler)
      }
    },
  },

  // 下载进度监听
  onDownloadProgress: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('download:progress', handler)
    return () => {
      ipcRenderer.off('download:progress', handler)
    }
  },
  
  // 历史记录
  history: {
    get: () => ipcRenderer.invoke('history:get'),
    add: (record: any) => ipcRenderer.invoke('history:add', record),
    delete: (id: string) => ipcRenderer.invoke('history:delete', id),
    onUpdated: (callback: (history: any[]) => void) => {
      const handler = (_: any, data: any[]) => callback(data)
      ipcRenderer.on('history:updated', handler)
      return () => {
        ipcRenderer.off('history:updated', handler)
      }
    },
  },
  
  // 更新检查
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  setUpdatePrefs: (prefs: { autoCheck?: boolean; autoDownload?: boolean }) =>
    ipcRenderer.invoke('app:setUpdatePrefs', prefs),
  downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),

  // 更新状态监听
  onUpdateStatus: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('update:status', handler)
    return () => {
      ipcRenderer.off('update:status', handler)
    }
  },
  
  // 菜单事件监听
  onMenuOpenSettings: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('menu:openSettings', handler)
    return () => {
      ipcRenderer.off('menu:openSettings', handler)
    }
  },

  onMenuShowAbout: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('menu:showAbout', handler)
    return () => {
      ipcRenderer.off('menu:showAbout', handler)
    }
  },

  // 窗口控制
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },
})

// --------- Preload scripts loading ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise((resolve) => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #8c5100;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff8f4;
  z-index: 9;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)

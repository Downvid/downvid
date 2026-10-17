/**
 * Web 环境的 window.electronAPI 适配器。
 *
 * 位于 docker/web/ 独立目录中，不侵入 src/ 下的任何桌面代码。
 * 纯前端通过 WebSocket RPC 与 docker/server 通信，模拟完整的 window.electronAPI。
 */

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

export function installWebBridge() {
  if (typeof window === 'undefined' || window.electronAPI) return

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${proto}//${location.host}/ws`

  const pending = new Map<number, Pending>()
  const subscribers = new Map<string, Set<(data: unknown) => void>>()
  let nextId = 1
  let socket: WebSocket | null = null
  let connecting: Promise<WebSocket> | null = null

  function connect(): Promise<WebSocket> {
    if (socket && socket.readyState <= WebSocket.OPEN) return Promise.resolve(socket)
    if (connecting) return connecting
    connecting = new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      const failTimer = setTimeout(() => {
        ws.close()
        reject(new Error('无法连接 DownVid WebUI 服务'))
      }, 10_000)
      ws.onopen = () => {
        clearTimeout(failTimer)
        socket = ws
        connecting = null
        resolve(ws)
      }
      ws.onerror = () => {
        clearTimeout(failTimer)
        connecting = null
        reject(new Error('无法连接 DownVid WebUI 服务'))
      }
      ws.onclose = () => {
        socket = null
        connecting = null
        for (const [, entry] of pending) entry.reject(new Error('连接已断开'))
        pending.clear()
      }
      ws.onmessage = (ev) => {
        let message: any
        try { message = JSON.parse(String(ev.data)) } catch { return }
        if (message.event !== undefined) {
          const set = subscribers.get(message.event)
          if (set) for (const cb of set) cb(message.data)
          return
        }
        if (message.id !== undefined) {
          const entry = pending.get(message.id)
          if (!entry) return
          pending.delete(message.id)
          if (message.error) entry.reject(new Error(message.error))
          else entry.resolve(message.result)
        }
      }
    })
    return connecting
  }

  function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    return connect().then(ws => new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, channel, args }))
    }))
  }

  function subscribe(channel: string, callback: (data: any) => void): () => void {
    let set = subscribers.get(channel)
    if (!set) {
      set = new Set()
      subscribers.set(channel, set)
    }
    const wrapped = (data: unknown) => callback(data)
    set.add(wrapped)
    return () => { set?.delete(wrapped) }
  }

  window.electronAPI = {
    clipboard: {
      readText: async () => {
        try { return await navigator.clipboard.readText() } catch { return '' }
      },
      writeText: async (text: string) => { await navigator.clipboard.writeText(text) },
    },

    dialog: {
      selectFolder: () => invoke('dialog:selectFolder'),
      selectFile: () => invoke('dialog:selectFile'),
    },

    app: {
      getVersion: () => invoke('app:getVersion'),
      getDefaultDownloadDir: () => invoke('app:getDefaultDownloadDir'),
      getHomeDir: () => invoke('app:getHomeDir'),
      cookieStatus: (manualFile?: string) => invoke('app:cookieStatus', manualFile),
      fetchImage: (url: string, referer?: string) => invoke('app:fetchImage', url, referer),
      getLog: () => invoke('app:getLog'),
      clearLog: () => invoke('app:clearLog'),
      openLogDir: () => invoke('app:openLogDir'),
      setProxy: (proxy: string) => invoke('app:setProxy', proxy),
      testProxy: (proxy: string) => invoke('app:testProxy', proxy),
      getDiskSpace: (dir?: string) => invoke('app:getDiskSpace', dir),
    },

    shell: {
      openPath: (filePath: string) => invoke('shell:openPath', filePath),
      showItemInFolder: (filePath: string) => invoke('shell:showItemInFolder', filePath),
      openExternal: (url: string) => { window.open(url, '_blank', 'noopener'); return Promise.resolve() },
    },

    ytdlp: {
      accelerationStatus: (manual?: string) => invoke('ytdlp:accelerationStatus', manual),
      parse: (url: string, cookiesFile?: string, proxy?: string) => invoke('ytdlp:parse', url, cookiesFile, proxy),
      download: (options: any) => invoke('ytdlp:download', options),
      pauseDownload: (taskId: string) => invoke('ytdlp:pauseDownload', taskId),
    },

    deps: {
      status: (settings?: any, force?: boolean) => invoke('deps:status', settings, force),
      check: (settings?: any) => invoke('deps:check', settings),
      download: (options?: any) => invoke('deps:download', options),
      cancel: () => invoke('deps:cancel'),
      openDir: () => invoke('deps:openDir'),
      diagnostics: () => invoke('deps:diagnostics'),
      onProgress: (callback: (data: any) => void) => subscribe('deps:progress', callback),
    },

    onDownloadProgress: (callback: (data: any) => void) => subscribe('download:progress', callback),

    history: {
      get: () => invoke('history:get'),
      add: (record: any) => invoke('history:add', record),
      delete: (id: string) => invoke('history:delete', id),
      onUpdated: (callback: (history: any[]) => void) => subscribe('history:updated', callback),
    },

    checkForUpdates: () => invoke('app:checkForUpdates'),
    setUpdatePrefs: (prefs: { autoCheck?: boolean; autoDownload?: boolean }) => invoke('app:setUpdatePrefs', prefs),
    downloadUpdate: () => invoke('app:downloadUpdate'),
    installUpdate: () => invoke('app:installUpdate'),

    onUpdateStatus: (callback: (data: any) => void) => subscribe('update:status', callback),
    onMenuOpenSettings: () => () => {},
    onMenuShowAbout: () => () => {},

    window: {
      minimize: () => Promise.resolve(),
      maximize: () => Promise.resolve(),
      close: () => Promise.resolve(),
      isMaximized: () => Promise.resolve(false),
    },
  } as unknown as typeof window.electronAPI
}

installWebBridge()

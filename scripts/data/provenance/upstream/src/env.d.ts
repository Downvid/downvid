/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    // 剪贴板
    clipboard: {
      readText: () => Promise<string>
      writeText: (text: string) => Promise<void>
    }
    dialog: {
      selectFolder: () => Promise<string | null>
      selectFile: () => Promise<string | null>
    }
    // 应用信息
    app: {
      getVersion: () => Promise<string>
      getDefaultDownloadDir: () => Promise<string>
      fetchImage: (url: string, referer?: string) => Promise<string>
    }
    shell: {
      openPath: (filePath: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
    }
    ytdlp: {
      parse: (url: string, cookiesFile?: string) => Promise<any>
      download: (options: {
        url: string
        formatId: string
        outputDir: string
        filename?: string
        taskId: string
        directUrl?: string 
        cookiesFile?: string
        downloadMode?: 'video' | 'audio'
        audioTrack?: any
        subtitles?: string[]
      }) => Promise<any>
      pauseDownload: (taskId: string) => Promise<boolean>
    }
    onDownloadProgress: (callback: (data: any) => void) => () => void
    history: {
      get: () => Promise<any[]>
      add: (record: any) => Promise<boolean>
      delete: (id: string) => Promise<boolean>
      onUpdated: (callback: (history: any[]) => void) => () => void
    }
    // 更新检查
    checkForUpdates: () => Promise<{
      hasUpdate: boolean
      version?: string
      currentVersion?: string
      releaseNotes?: string
      releaseDate?: string
      downloadUrl?: string
      error?: string
    }>
    // 菜单事件监听
    onMenuShowAbout: (callback: () => void) => () => void
  }
}

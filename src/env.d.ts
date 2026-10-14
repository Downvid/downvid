/// <reference types="vite/client" />

// 注意：本文件不能出现顶层 import/export，否则会从「全局声明脚本」变成模块，
// 下面的 interface Window 就不再全局生效（electron-env.d.ts 的旧类型会重新胜出）。
// 因此依赖类型一律用内联 import(...) 引用。
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
      getContributors: () => Promise<{
        success: boolean
        data?: Array<{
          login: string
          avatarUrl: string
          htmlUrl: string
          contributions: number
          isBot: boolean
          isAI?: boolean
          isDeveloper: boolean
          /** 真人贡献者（非 Bot、非 AI） */
          isContributor?: boolean
        }>
        error?: string
        fromCache?: boolean
        warning?: string
      }>
      getDefaultDownloadDir: () => Promise<string>
      /** 用户主目录，界面用它把绝对路径缩写成 ~/... */
      getHomeDir: () => Promise<string>
      /** Cookie 的真实可用状态（是否已有可用来源） */
      cookieStatus: (manualFile?: string) => Promise<{
        manual: boolean
        hasSnapshot: boolean
        snapshotAgeMs: number | null
        lastGoodBrowser: string
        availableBrowsers: string[]
      }>
      fetchImage: (url: string, referer?: string) => Promise<string>
      getLog: () => Promise<{
        success: boolean
        content?: string
        path?: string
        totalLines?: number
        error?: string
      }>
      clearLog: () => Promise<{ success: boolean; error?: string }>
      openLogDir: () => Promise<{ success: boolean; error?: string }>
      setProxy: (proxy: string) => Promise<boolean>
      testProxy: (proxy: string) => Promise<{ success: boolean; latency?: number; error?: string; warning?: string }>
      getDiskSpace: (dir?: string) => Promise<{ free: number; total: number; unit: string }>
    }
    shell: {
      openPath: (filePath: string) => Promise<{ success: boolean; error?: string }>
      /** 在文件管理器中定位该文件（打开所在文件夹并选中） */
      showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>
      openExternal: (url: string) => Promise<void>
    }
    ytdlp: {
      accelerationStatus: (manual?: string) => Promise<import('../shared/acceleration').AccelerationStatus>
      parse: (url: string, cookiesFile?: string, proxy?: string) => Promise<any>
      download: (options: {
        url: string
        formatId: string
        outputDir: string
        filename?: string
        taskId: string
        directUrl?: string 
        cookiesFile?: string
        audioTrack?: any
        subtitles?: string[]
        proxy?: string
        cacheFile?: string
        hasAudio?: boolean
        filenameTemplate?: string
        acceleration?: import('../shared/acceleration').AccelerationSettings
        downloadMode?: 'video' | 'audio' | 'subtitle'
      }) => Promise<any>
      pauseDownload: (taskId: string) => Promise<boolean>
    }
    /**
     * 运行依赖管理。DownVid 不再自带 yt-dlp / ffmpeg：
     * 优先复用机器上已安装的版本，缺失时由主进程调用 Go 边车下载到 userData。
     */
    deps: {
      status: (settings?: import('./types/deps').DepsSettings, force?: boolean) => Promise<import('./types/deps').DepsResponse>
      check: (settings?: import('./types/deps').DepsSettings) => Promise<import('./types/deps').DepsResponse>
      download: (options?: import('./types/deps').DepsSettings & { only?: import('./types/deps').DepKind[]; force?: boolean }) => Promise<import('./types/deps').DepsResponse>
      cancel: () => Promise<boolean>
      openDir: () => Promise<{ success: boolean; path?: string; error?: string }>
      diagnostics: () => Promise<{
        success: boolean
        platform: string
        sidecar: string | null
        managedDir: string
      }>
      onProgress: (callback: (data: import('./types/deps').DepsProgress) => void) => () => void
    }
    onDownloadProgress: (callback: (data: any) => void) => () => void
    history: {
      get: () => Promise<any[]>
      add: (record: any) => Promise<boolean>
      delete: (id: string) => Promise<boolean>
      onUpdated: (callback: (history: any[]) => void) => () => void
    }
    // 更新检查
    /** 同步自动更新开关到主进程（设置变更或启动时调用） */
    setUpdatePrefs: (prefs: { autoCheck?: boolean; autoDownload?: boolean }) => Promise<boolean>
    checkForUpdates: () => Promise<{
      hasUpdate: boolean
      version?: string
      currentVersion?: string
      releaseNotes?: string
      releaseDate?: string
      downloadUrl?: string
      /** 当前安装方式不支持自动安装，只能前往发布页手动下载 */
      manual?: boolean
      manualReason?: string
      error?: string
    }>
    downloadUpdate: () => Promise<{ success: boolean; error?: string }>
    installUpdate: () => Promise<{ success: boolean; error?: string }>
    onUpdateStatus: (callback: (data: {
      status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
      version?: string
      releaseNotes?: string
      percent?: number
      speed?: number
      message?: string
    }) => void) => () => void
    /** 后台刷新到新的贡献者列表时通知（避免界面停留在旧数据） */
    onContributorsUpdated: (callback: (data: Array<{
      login: string
      avatarUrl: string
      htmlUrl: string
      contributions: number
      isBot: boolean
      isAI?: boolean
      isDeveloper: boolean
      isContributor?: boolean
    }>) => void) => () => void

    // 菜单事件监听
    onMenuShowAbout: (callback: () => void) => () => void
    /** macOS 菜单里的「设置…」⌘, */
    onMenuOpenSettings: (callback: () => void) => () => void
    // 窗口控制
    window: {
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      isMaximized: () => Promise<boolean>
    }
  }
}

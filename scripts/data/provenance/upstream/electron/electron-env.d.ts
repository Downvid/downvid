/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import('electron').IpcRenderer
  electronAPI: {
    clipboard: {
      readText: () => Promise<string>
    }
    dialog: {
      selectFolder: () => Promise<string | null>
    }
    app: {
      getDefaultDownloadDir: () => Promise<string>
      fetchImage: (url: string, referer?: string) => Promise<string>
    }
    shell: {
      openPath: (filePath: string) => Promise<void>
    }
    ytdlp: {
      parse: (url: string) => Promise<any>
      download: (options: { 
        url: string
        formatId: string
        outputDir: string
        filename?: string
        taskId: string
        directUrl?: string 
      }) => Promise<any>
    }
    onDownloadProgress: (callback: (data: any) => void) => (() => void)
    history: {
      get: () => Promise<any[]>
      add: (record: any) => Promise<void>
      delete: (id: string) => Promise<void>
    }
  }
}

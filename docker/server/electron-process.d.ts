/**
 * 容器侧的类型补充：`process.resourcesPath` 是 Electron 注入的属性。
 *
 * 主进程那边这个声明由 `electron` 包自带的 `electron.d.ts` 提供（它做的是
 * `declare namespace NodeJS { interface Process { resourcesPath: string } }`）。
 * 而容器侧的 `electron` 被别名指向 `electron-shim.ts`，真实类型**根本不会被加载**，
 * 于是 `electron/utils/runtime.ts` 里的 `process.resourcesPath` 就报
 * 「Property 'resourcesPath' does not exist on type 'Process'」。
 *
 * 这是个真实存在的属性（容器里是 undefined，代码里用 `|| ''` 兜着），
 * 所以这里按实际情况补声明 —— 而不是把调用处改成 `(process as any)`，
 * 那会让真正的类型错误也一起消失。
 */
declare namespace NodeJS {
  interface Process {
    /** Electron 的资源目录；纯 Node 环境下不存在（容器里就是 undefined） */
    resourcesPath?: string
  }
}

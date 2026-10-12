/**
 * 应用信息与外部链接的唯一来源。
 *
 * 此前 owner/repo/仓库地址散落在 8 处（constants.ts、AboutView、UpdateModal、
 * ErrorModal、UrlInput、contributors、electron-builder.json5、release.yml），
 * 改仓库需要全局搜索且极易漏改——而漏改的代价是存量用户无法收到更新。
 *
 * 这个文件同时被主进程、preload 与渲染进程引用，因此放在 src/ 与 electron/
 * 之外。三方都用相对路径导入，不依赖打包器的路径别名（别名在
 * vite-plugin-electron 生成的多个独立构建中未必都生效）。
 *
 * electron-builder.json5 的 publish 段是构建期配置、运行时读不到，
 * 由 `pnpm lint:ipc` 做静态一致性校验。
 */

export const APP = {
  name: 'DownVid',
  owner: 'yxxbc',
  repo: 'downvid',
} as const

const GITHUB = 'https://github.com'

/** 简写形式（owner/repo），用于界面展示 */
export const REPO_SLUG = `${APP.owner}/${APP.repo}`
export const REPO_URL = `${GITHUB}/${REPO_SLUG}`
export const RELEASES_URL = `${REPO_URL}/releases`
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`
export const ISSUES_URL = `${REPO_URL}/issues`

/** GitHub API 基址 */
export const GITHUB_API = 'https://api.github.com'

/** 请求 GitHub API 时的 User-Agent；缺失会被直接拒绝（403） */
export const HTTP_USER_AGENT = `DownVid/${REPO_SLUG}`

/** 新建 Issue，附带标题、正文与标签 */
export function newIssueUrl(params: { title: string; body?: string; labels?: string }): string {
  const query = new URLSearchParams({ title: params.title })
  if (params.body) query.set('body', params.body)
  if (params.labels) query.set('labels', params.labels)
  return `${ISSUES_URL}/new?${query.toString()}`
}

/** 贡献者页面的标记：这些账号在关于页高亮为「开发者」 */
export const DEVELOPER_LOGINS: readonly string[] = [APP.owner]

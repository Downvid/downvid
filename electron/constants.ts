// GitHub 仓库配置的唯一来源。
//
// 主进程不再自己定义 owner/repo，而是复用 shared/app.ts（渲染进程也用同一份），
// 避免两边各写一遍导致改仓库时漏改。
export { APP, GITHUB_API, HTTP_USER_AGENT, ISSUES_URL, LATEST_RELEASE_URL, RELEASES_URL, REPO_SLUG, REPO_URL, newIssueUrl } from '../shared/app'

// YouTube 多音轨语言名称映射
export const LANG_NAMES: Record<string, string> = {
  'ja': '日本語', 'en': 'English', 'zh': '中文(原始)', 'zh-Hans': '中文(简体)',
  'zh-Hant': '中文(繁體)', 'zh-CN': '中文(简体)', 'zh-TW': '中文(繁體)',
  'zh-HK': '中文(香港)', 'ko': '한국어', 'fr': 'Français', 'de': 'Deutsch',
  'es': 'Español', 'pt': 'Português', 'ru': 'Русский', 'ar': 'العربية',
  'hi': 'हिन्दी', 'th': 'ไทย', 'vi': 'Tiếng Việt', 'id': 'Bahasa Indonesia',
  'it': 'Italiano', 'nl': 'Nederlands', 'pl': 'Polski', 'tr': 'Türkçe',
}

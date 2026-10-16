import { ref, computed } from 'vue'

/**
 * 轻量界面国际化（zh-CN / en-US）。
 *
 * ## 为什么不用 vue-i18n
 *
 * 本项目刻意零依赖：语言只有两种、没有复数/性别/日期格式化的复杂需求，
 * 一个 `Record` + 响应式语言标记就够了。引入 vue-i18n 会增加一个运行时依赖，
 * 而它的全部能力这里用不上——与「没有 ESLint/Prettier」是同一套理由。
 *
 * ## 为什么语言标记放在模块级（而不是 Pinia）
 *
 * 界面文案在组件 setup 里就要用，而 `t()` 必须是**响应式**的：切换语言后
 * 所有已挂载的组件要立刻重渲染。模块级 `ref` 满足这一点，且不需要任何
 * provider/inject 样板。
 *
 * ## 关键约束：`t()` 的调用点必须在 setup / computed / 模板里
 *
 * 它不是「读一次就固定」的普通函数，而是读一个 ref。**在模块顶层**调用
 * `const S = t('x')` 只会在语言切换时丢掉响应性。需要常量文案时用
 * `computed(() => t('x'))`。
 *
 * ## 主进程侧
 *
 * 主进程（`electron/`）抛出的错误文案不经过这里（那边没有 Vue、也拿不到
 * 渲染进程的语言设置）。那部分由 `main-messages.ts` 的 `translateMainMessage()`
 * 按「已知原文 → 词条」映射兜底翻译。
 */

export type Locale = 'zh-CN' | 'en-US'
export const LOCALES: Locale[] = ['zh-CN', 'en-US']

/**
 * 词条表。键名用点分层级，便于 `lint:i18n` 双向比对。
 *
 * `{name}` 占位符由 `t(key, params)` 替换；两份词条的占位符集合必须一致，
 * `lint:i18n` 会校验（漏掉占位符会让参数永远显示成 `{name}`）。
 */
const messages: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    // ===== 通用 =====
    'common.cancel': '取消',
    'common.confirm': '确定',
    'common.save': '保存',
    'common.close': '关闭',
    'common.retry': '重试',
    'common.refresh': '刷新',
    'common.copy': '复制',
    'common.copied': '已复制',
    'common.open': '打开',
    'common.delete': '删除',
    'common.unknown': '未知',
    'common.loading': '加载中...',
    'common.select': '选择',
    'common.clear': '清除',
    'common.failed': '失败',
    'common.test': '测试',
    'common.testing': '测试中',
    'common.optional': '可选',
    'common.apply': '应用',

    // ===== 顶部导航 =====
    'nav.download': '解析下载',
    'nav.history': '下载历史',
    'nav.about': '关于软件',
    'nav.settings': '设置',

    // ===== 任务队列 =====
    'queue.title': '任务队列',
    'queue.activeCount': '{count} 进行中',
    'queue.queuedCount': '{count} 排队',
    'queue.empty': '暂无下载任务',
    'queue.emptyHint': '解析视频后点击下载按钮添加任务',
    'queue.statusPending': '等待下载...',
    'queue.statusMerging': '正在合并音视频...',
    'queue.statusDownloading': '正在下载...',
    'queue.statusPaused': '已暂停',
    'queue.tooltipPause': '暂停下载',
    'queue.tooltipResume': '继续下载',
    'queue.tooltipRetry': '重试下载',
    'queue.errorFallback': '下载失败',
    'queue.noFileToLocate': '这个任务还没有生成文件，无法定位',
    'queue.openFolderFailed': '无法打开所在文件夹，文件可能已被移动或删除',
    'queue.storage': '存储空间',

    // ===== 下载视图 =====
    'download.title': '全平台视频下载',
    'download.subtitle': '输入链接即刻解析高清数字资产',
    'download.extracting': '正在提取视频元数据...',
    'download.elapsed': '已用 {seconds} 秒',
    'download.usuallySeconds': '通常需要几秒',
    'download.invalidLink': '请输入有效的链接',
    'download.badProtocol': '不支持的协议: {protocol}',
    'download.badUrl': '无法解析的 URL: {url}',
    'download.parseFailed': '解析失败：{message}',
    'download.unknownError': '未知错误',

    // ===== 链接输入 =====
    'url.placeholder': '在此处粘贴需要解析的视频链接...',
    'url.paste': '粘贴链接',
    'url.parse': '解析视频信息',
    'url.parsing': '解析中...',
    'url.youtubeCookieTitle': 'YouTube 视频需要 Cookie 才能下载',
    'url.youtubeCookieBody': '由于 YouTube 的限制，需安装 Chrome 插件',
    'url.youtubeCookieSteps': '导出 cookies 文件命名为 cookies.txt，然后在设置中导入并且需要经常更新 cookies.txt。',
    'url.viewTutorial': '查看详细教程',
    'url.bilibiliCookieTitle': 'B站视频需要 Cookie 才能下载',
    'url.bilibiliCookieBody': '由于 B站的限制，需要导入 cookies.txt 文件才能下载完整视频。',
    'url.goImportCookie': '去设置导入 Cookie',

    // ===== 格式选择 =====
    'formats.title': '解析结果预览',
    'formats.videoHeader': '视频格式 (MP4) - 共 {count} 个',
    'formats.audioHeader': '纯音频格式 - 共 {count} 个',
    'formats.trackHeader': '音频轨道 - 共 {count} 个',
    'formats.subtitleHeader': '字幕 - 共 {count} 个',
    'formats.unknownSize': '未知大小',
    'formats.sizeUnknown': '大小未知',
    'download.startDownload': '立即下载所选资源',
    'download.downloadAudio': '下载纯音频',
    'download.downloadSubtitle': '下载字幕',
    'download.downloading': '正在下载...',

    // ===== 下载历史 =====
    'history.title': '下载历史',
    'history.subtitle': '查看和管理已下载的视频',
    'history.clearAll': '清空历史',
    'history.empty': '暂无下载记录',
    'history.emptyHint': '下载的视频将显示在这里',
    'history.fileMissing': '本地文件不存在',
    'history.playFile': '播放文件',
    'history.openFile': '打开文件',
    'history.openFolder': '打开所在文件夹',
    'history.deleteRecord': '删除记录',
    'history.confirmClear': '确定要清空所有下载历史吗？',

    // ===== 设置 =====
    'settings.title': '设置',
    'settings.language': '界面语言',
    'settings.languageHint': '选择「跟随系统」时按操作系统语言自动切换。',
    'settings.languageAuto': '跟随系统',
    'settings.downloadDir': '默认下载目录',
    'settings.filenameTemplate': '文件名模板',
    'settings.filenameTemplateHint': '%(title)s 标题 · %(id)s ID · %(uploader)s 上传者',
    'settings.quality': '画质偏好',
    'settings.qualityBest': '最佳画质（推荐）',
    'settings.quality1080': '1080P 高清',
    'settings.quality720': '720P 标清',
    'settings.quality480': '480P 流畅',
    'settings.tabDownload': '下载',
    'settings.tabAcceleration': '加速',
    'settings.tabCookies': 'Cookies',
    'settings.tabProxy': '代理',
    'settings.tabDeps': '运行依赖',
    'settings.tabUpdate': '更新',
    'settings.saved': '设置已保存',
    'settings.enterProxyFirst': '请先输入代理地址',
    'settings.proxyUnavailable': '代理不可用',
    'settings.proxyTestFailed': '测试失败: {message}',

    // ===== 加速 =====
    'accel.title': '下载加速',
    'accel.maxConnections': '每个任务的最大连接数',
    'accel.aria2Path': 'aria2c 路径',
    'accel.aria2Auto': '自动检测',
    'accel.selectAria2': '选择 aria2c',
    'accel.detectAria2': '检测 aria2c',
    'accel.detectFailed': '检测失败，使用内置下载器',

    // ===== Cookie 设置 =====
    'cookies.mode': 'Cookie 模式',
    'cookies.autoTitle': '自动读取浏览器 Cookie',
    'cookies.autoHint': '从 Chrome/Edge/Safari 自动读取登录状态',
    'cookies.manualTitle': '手动导入 Cookie 文件',
    'cookies.manualHint': '使用 Get cookies.txt 扩展导出',
    'cookies.file': 'Cookie 文件',
    'cookies.filePlaceholder': '选择 cookies.txt',
    'cookies.usage': '用于抖音、B站、YouTube 等需要登录的平台',

    // ===== 代理 =====
    'proxy.label': '代理地址',
    'proxy.hint': '支持 http/https/socks5。保存后立即生效，无需重启。',

    // ===== 更新设置 =====
    'updateSettings.autoCheck': '启动时自动检查更新',
    'updateSettings.autoCheckHint': '启动 3 秒后向 GitHub Releases 请求一次。关闭后不再自动检查，也不会在退出时自动安装；「关于」页的手动「检查更新」仍然可用。',
    'updateSettings.autoDownload': '发现新版本时自动下载',
    'updateSettings.autoDownloadHint': '开启后自动下载安装包（仍需你点「立即安装」）。关闭时只提示有新版本，下载由你决定 —— 移动网络或计费流量下建议关闭。',
    'updateSettings.manualHint': '手动检查更新在「关于软件」页 —— 那里已有入口，不在此重复。',

    // ===== 运行依赖 =====
    'deps.ready': '运行依赖已就绪',
    'deps.missing': '缺少必需的运行依赖',
    'deps.reusing': '正在复用本机已安装的组件，无需内置二进制。',
    'deps.managedCount': '其中 {count} 项由 DownVid 下载托管。',
    'deps.willDownload': 'DownVid 会优先使用系统已安装的版本，找不到时由你点击按钮下载。',
    'deps.recheck': '重新检测',
    'deps.checking': '检测中...',
    'deps.optional': '可选',
    'deps.notFound': '未找到',
    'deps.download': '下载',
    'deps.update': '更新',
    'deps.upToDate': '已是最新',
    'deps.system': '系统自带',
    'deps.downloading': '下载中...',
    'deps.downloadMissing': '下载缺失的依赖',
    'deps.cancelDownload': '取消下载',
    'deps.openInstallDir': '打开安装目录',
    'deps.outdatedHint': '版本过旧，将下载 {version}',
    'deps.installHint': '下载并安装到 DownVid 托管目录',
    'deps.versionHint': '当前 {current}，清单要求 {required}',
    'deps.manualTitle': '手动指定可执行文件（进阶）',
    'deps.manualHint': '自动检测不到，或想固定使用某个版本时，可在此指定绝对路径。留空则自动检测。',
    'deps.manualPlaceholder': '留空则自动检测',
    'deps.applyAndRecheck': '应用并重新检测',

    // ===== 依赖引导弹窗 =====
    'depsPrompt.title': '需要下载运行依赖',
    'depsPrompt.body': 'DownVid 不再内置 yt-dlp / ffmpeg，会优先使用本机已安装的版本。当前缺少：',
    'depsPrompt.downloading': '正在下载 {tool}...',
    'depsPrompt.orInstall': '也可以自行安装后点「重新检测」：',
    'depsPrompt.openDir': '打开安装目录',
    'depsPrompt.downloadAndContinue': '下载并继续',

    // ===== Cookie 引导 =====
    'cookieGuide.title': '为什么需要 Cookie',
    'cookieGuide.intro': 'YouTube 对未登录请求做了限制，带上浏览器的登录态后即可正常解析与下载。',
    'cookieGuide.recommended': '推荐',
    'cookieGuide.autoTitle': '让 DownVid 自动读取浏览器 Cookie',
    'cookieGuide.autoStep1': '先在浏览器里登录 YouTube',
    'cookieGuide.autoStep2': '打开「设置 → Cookies」，Cookie 模式选择「自动读取浏览器 Cookie」',
    'cookieGuide.autoStep3': '然后回到这里重新解析一次即可，无需手动导出任何文件',
    'cookieGuide.autoNote': 'DownVid 会自动尝试机器上已安装的浏览器（Chrome / Edge / Firefox / Safari / Brave），读到后导出快照并复用，解析与下载用的是同一份登录态。可在「设置 → Cookies」查看当前用的是哪个来源。',
    'cookieGuide.ifFail': '如果自动读取失败',
    'cookieGuide.failBrowserRunning': '浏览器正在运行：完全退出该浏览器后重试（Chrome / Edge 会锁住 Cookie 数据库）',
    'cookieGuide.failSafari': 'macOS 上的 Safari：需要授予 DownVid「完全磁盘访问」权限（系统设置 → 隐私与安全性 → 完全磁盘访问）',
    'cookieGuide.failWindowsChrome': 'Windows 上的 Chrome：运行时 Cookie 被 App-Bound 加密且数据库被锁，建议改用 Firefox，或采用下方的手动方式',
    'cookieGuide.manualTitle': '手动导入 cookies.txt',
    'cookieGuide.manualStepInstall': '在浏览器中安装扩展',
    'cookieGuide.manualStepExport': '打开 youtube.com 并确保已登录，用扩展导出 Netscape 格式的 cookies.txt',
    'cookieGuide.manualStepImport': '打开「设置 → Cookies」，模式改为「手动导入 Cookie 文件」并选择刚导出的文件',
    'cookieGuide.expireNote': 'Cookie 会过期，失效后需要重新导出。如果你经常遇到失效，用自动读取会更省事。',
    'cookieGuide.openSettings': '打开 Cookie 设置',

    // ===== 错误弹窗 =====
    'error.title': '出错了',
    'error.warning': '注意',
    'error.info': '提示',
    'error.showDetail': '查看错误详情',
    'error.hideDetail': '收起错误详情',
    'error.copyDetail': '复制错误信息',
    'error.submitIssue': '提交 Issue',
    'error.acknowledge': '知道了',

    // ===== 关于 =====
    'about.title': '关于',
    'about.checkUpdate': '检查更新',
    'about.intro': '开源视频下载工具，基于 yt-dlp，支持抖音、B站、YouTube 等平台。',
    'about.feedback': '问题反馈',
    'about.feedbackHint': '提交建议或报告问题',
    'about.contributors': '贡献者',
    'about.openSource': '开源组件',
    'about.homepage': '主页',
    'about.techStack': '技术栈',
    'about.license': '开源协议',
    'about.support': '支持 DownVid',
    'about.supportHint': '如果这个工具对你有帮助，欢迎请作者喝杯咖啡 ☕',
    'about.showDonate': '显示赞赏码',
    'about.hideDonate': '收起赞赏码',
    'about.donateAlt': '微信赞赏码',
    'about.donateCaption': '微信扫码赞赏 — 给 Black Cat 赞赏',
    'about.website': '产品官网',
    'about.websiteHint': '下载安装包与查看功能介绍',
    'about.contactHint': '功能建议与缺陷请走「问题反馈」，其他人也能搜到；以下事宜请发邮件：',
    'about.contactSponsor': '赞助支持',
    'about.contactBusiness': '商务合作 / 广告位',
    'about.mailSubjectSponsor': '[DownVid] 赞助',
    'about.mailSubjectBusiness': '[DownVid] 商务合作',

    // ===== 更新弹窗 =====
    'update.title': '软件更新',
    'update.available': '新版本 v{new} 可用 · 当前 v{current}',
    'update.current': '当前版本 v{current}',
    'update.checking': '正在检查更新...',
    'update.upToDate': '已是最新版本',
    'update.noUpdate': 'DownVid v{current} 暂无更新',
    'update.manualReason': '当前安装方式不支持自动更新，请前往发布页下载',
    'update.manualSuggestion': '建议更新以获得最新功能和安全修复',
    'update.whatsNew': '更新内容',
    'update.noNotes': '暂无更新说明',
    'update.downloading': '正在下载 v{new}',
    'update.doNotClose': '下载过程中请勿关闭应用',
    'update.downloaded': '下载完成',
    'update.ready': '新版本 v{new} 已准备就绪',
    'update.readyHint': '点击“重启并安装”完成更新，应用将自动重新打开',
    'update.later': '稍后',
    'update.goToDownload': '前往下载页',
    'update.downloadUpdate': '下载更新',
    'update.restartLater': '稍后重启',
    'update.restartAndInstall': '重启并安装',
    'update.done': '完成',

    // ===== 下载错误（来自 friendlyDownloadError 与主进程文案） =====
    'err.forbiddenLogin': '站点拒绝下载（403）：该视频需要登录，请在「设置 → Cookies」配置后重试',
    'err.forbidden': '站点拒绝下载（403）：可能是访问过于频繁或需要登录。稍后重试，或在「设置 → Cookies」配置 Cookie',
    'err.rateLimited': '请求过于频繁（429）：请等待几分钟后重试',
    'err.diskFull': '磁盘空间不足',
    'err.permission': '没有写入权限，请检查下载目录',
    'err.network': '网络连接中断，请重试',
    'err.unreachable': '无法访问该站点：请检查网络连接，或在「设置 → 代理」中配置代理',
    'err.ffmpeg': 'FFmpeg 合并失败：请检查「设置 → 运行依赖」中的 ffmpeg',
    'err.privateVideo': '该视频需要登录才能访问',
    'err.videoUnavailable': '视频不可用（可能已删除或限制地区）',

    // 右键菜单
    'ctx.cut': '剪切',
    'ctx.copy': '复制',
    'ctx.paste': '粘贴',
    'ctx.delete': '删除',
    'ctx.selectAll': '全选',

    // 依赖来源
    'deps.sourceSystem': '系统安装',
    'deps.sourceManaged': 'DownVid 托管',
    'deps.sourceManual': '手动指定',
    'deps.sourceScanned': '扫描发现',
    'deps.downloadedSize': '已下载 {size}',
    'deps.retrying': '网络不稳定，正在重试...',
    'deps.installedNotice': '{tool} 安装完成',
    'deps.downloadFailed': '依赖下载失败',
    'deps.checkFailed': '依赖检测失败',
    'deps.readyNotice': '依赖已就绪',

    // 更新流程状态
    'update.errCheck': '检查失败',
    'update.errDownload': '下载失败',
    'update.errInstall': '安装失败',
    'update.errGeneric': '更新失败',
    'update.errCheckNetwork': '检查更新失败，请检查网络连接',
    'update.preparing': '准备下载...',

    // 关于页技术栈
    'about.techGo': '依赖边车：探测并复用系统已安装的 yt-dlp / ffmpeg',
    'about.techNotBundled': '不随安装包分发，运行时解析',
    'err.ytdlpMissing': '未找到可用的 yt-dlp',
    'err.depMissing': '未找到可用的 {kind}，请在「设置 → 运行依赖」中下载后重试',
  },
  'en-US': {
    // ===== Common =====
    'common.cancel': 'Cancel',
    'common.confirm': 'OK',
    'common.save': 'Save',
    'common.close': 'Close',
    'common.retry': 'Retry',
    'common.refresh': 'Refresh',
    'common.copy': 'Copy',
    'common.copied': 'Copied',
    'common.open': 'Open',
    'common.delete': 'Delete',
    'common.unknown': 'Unknown',
    'common.loading': 'Loading...',
    'common.select': 'Choose',
    'common.clear': 'Clear',
    'common.failed': 'Failed',
    'common.test': 'Test',
    'common.testing': 'Testing',
    'common.optional': 'Optional',
    'common.apply': 'Apply',

    // ===== Header navigation =====
    'nav.download': 'Download',
    'queue.title': 'Task queue',
    'nav.history': 'History',
    'nav.about': 'About',
    'nav.settings': 'Settings',

    // ===== Task queue =====
    'queue.activeCount': '{count} active',
    'queue.queuedCount': '{count} queued',
    'queue.empty': 'No download tasks',
    'queue.emptyHint': 'Parse a video and hit Download to add one',
    'queue.statusPending': 'Waiting...',
    'queue.statusMerging': 'Merging audio and video...',
    'queue.statusDownloading': 'Downloading...',
    'queue.statusPaused': 'Paused',
    'queue.tooltipPause': 'Pause download',
    'queue.tooltipResume': 'Resume download',
    'queue.tooltipRetry': 'Retry download',
    'queue.errorFallback': 'Download failed',
    'queue.noFileToLocate': 'This task has no file yet, nothing to locate',
    'queue.openFolderFailed': 'Could not open the folder — the file may have been moved or deleted',
    'queue.storage': 'Storage',

    // ===== Download view =====
    'download.title': 'Download videos from anywhere',
    'download.subtitle': 'Paste a link to grab it in high quality',
    'download.extracting': 'Extracting video metadata...',
    'download.elapsed': '{seconds}s elapsed',
    'download.usuallySeconds': 'usually a few seconds',
    'download.invalidLink': 'Please enter a valid link',
    'download.badProtocol': 'Unsupported protocol: {protocol}',
    'download.badUrl': 'Could not parse URL: {url}',
    'download.parseFailed': 'Parsing failed: {message}',
    'download.unknownError': 'Unknown error',

    // ===== URL input =====
    'url.placeholder': 'Paste the video link you want to download...',
    'url.paste': 'Paste link',
    'url.parse': 'Parse video info',
    'url.parsing': 'Parsing...',
    'url.youtubeCookieTitle': 'YouTube videos need cookies to download',
    'url.youtubeCookieBody': 'YouTube limits anonymous requests, so a browser extension is needed',
    'url.youtubeCookieSteps': 'Export a cookies file named cookies.txt, import it in Settings, and refresh it often.',
    'url.viewTutorial': 'View the tutorial',
    'url.bilibiliCookieTitle': 'Bilibili videos need cookies to download',
    'url.bilibiliCookieBody': 'Bilibili requires a cookies.txt file to download the full video.',
    'url.goImportCookie': 'Import cookies in Settings',

    // ===== Format selection =====
    'formats.title': 'Parse result',
    'formats.videoHeader': 'Video formats (MP4) — {count} available',
    'formats.audioHeader': 'Audio-only formats — {count} available',
    'formats.trackHeader': 'Audio tracks — {count} available',
    'formats.subtitleHeader': 'Subtitles — {count} available',
    'formats.unknownSize': 'Size unknown',
    'formats.sizeUnknown': 'Size unknown',
    'download.startDownload': 'Download selected',
    'download.downloadAudio': 'Download audio',
    'download.downloadSubtitle': 'Download subtitles',
    'download.downloading': 'Downloading...',

    // ===== History =====
    'history.title': 'Download history',
    'history.subtitle': 'View and manage your downloads',
    'history.clearAll': 'Clear history',
    'history.empty': 'No downloads yet',
    'history.emptyHint': 'Downloaded videos show up here',
    'history.fileMissing': 'Local file missing',
    'history.playFile': 'Play file',
    'history.openFile': 'Open file',
    'history.openFolder': 'Open containing folder',
    'history.deleteRecord': 'Delete record',
    'history.confirmClear': 'Clear all download history?',

    // ===== Settings =====
    'settings.title': 'Settings',
    'settings.language': 'Interface language',
    'settings.languageHint': '“Follow system” switches automatically based on your OS language.',
    'settings.languageAuto': 'Follow system',
    'settings.downloadDir': 'Default download folder',
    'settings.filenameTemplate': 'Filename template',
    'settings.filenameTemplateHint': '%(title)s title · %(id)s ID · %(uploader)s uploader',
    'settings.quality': 'Preferred quality',
    'settings.qualityBest': 'Best quality (recommended)',
    'settings.quality1080': '1080P HD',
    'settings.quality720': '720P',
    'settings.quality480': '480P',
    'settings.tabDownload': 'Download',
    'settings.tabAcceleration': 'Speed',
    'settings.tabCookies': 'Cookies',
    'settings.tabProxy': 'Proxy',
    'settings.tabDeps': 'Dependencies',
    'settings.tabUpdate': 'Updates',
    'settings.saved': 'Settings saved',
    'settings.enterProxyFirst': 'Enter a proxy address first',
    'settings.proxyUnavailable': 'Proxy unavailable',
    'settings.proxyTestFailed': 'Test failed: {message}',

    // ===== Acceleration =====
    'accel.title': 'Download acceleration',
    'accel.maxConnections': 'Max connections per task',
    'accel.aria2Path': 'aria2c path',
    'accel.aria2Auto': 'Auto-detect',
    'accel.selectAria2': 'Choose aria2c',
    'accel.detectAria2': 'Detect aria2c',
    'accel.detectFailed': 'Detection failed, using the built-in downloader',

    // ===== Cookie settings =====
    'cookies.mode': 'Cookie mode',
    'cookies.autoTitle': 'Read browser cookies automatically',
    'cookies.autoHint': 'Reads the login state from Chrome/Edge/Safari',
    'cookies.manualTitle': 'Import a cookie file manually',
    'cookies.manualHint': 'Export with the Get cookies.txt extension',
    'cookies.file': 'Cookie file',
    'cookies.filePlaceholder': 'Choose cookies.txt',
    'cookies.usage': 'Used for Douyin, Bilibili, YouTube and other platforms that require login',

    // ===== Proxy =====
    'proxy.label': 'Proxy address',
    'proxy.hint': 'Supports http/https/socks5. Takes effect immediately after saving — no restart needed.',

    // ===== Update settings =====
    'updateSettings.autoCheck': 'Check for updates on startup',
    'updateSettings.autoCheckHint': 'Asks GitHub Releases once, 3 seconds after launch. When off, it neither checks automatically nor installs on quit; the manual “Check for updates” on the About page still works.',
    'updateSettings.autoDownload': 'Download new versions automatically',
    'updateSettings.autoDownloadHint': 'Downloads the installer automatically (you still click “Install now”). When off you are only notified — recommended on metered connections.',
    'updateSettings.manualHint': 'Manual update checks live on the About page — no need to duplicate that entry point here.',

    // ===== Runtime dependencies =====
    'deps.ready': 'Runtime dependencies ready',
    'deps.missing': 'Required runtime dependencies missing',
    'deps.reusing': 'Reusing components already installed on this machine — no bundled binaries.',
    'deps.managedCount': '{count} of them are downloaded and managed by DownVid.',
    'deps.willDownload': 'DownVid prefers versions already installed on your system, and only downloads when none is found.',
    'deps.recheck': 'Check again',
    'deps.checking': 'Checking...',
    'deps.optional': 'Optional',
    'deps.notFound': 'Not found',
    'deps.download': 'Download',
    'deps.update': 'Update',
    'deps.upToDate': 'Up to date',
    'deps.system': 'System install',
    'deps.downloading': 'Downloading...',
    'deps.downloadMissing': 'Download missing dependencies',
    'deps.cancelDownload': 'Cancel download',
    'deps.openInstallDir': 'Open install folder',
    'deps.outdatedHint': 'Outdated — will download {version}',
    'deps.installHint': 'Download and install into the DownVid managed folder',
    'deps.versionHint': 'Current {current}, manifest requires {required}',
    'deps.manualTitle': 'Specify an executable manually (advanced)',
    'deps.manualHint': 'Use this to pin an absolute path when auto-detection fails or you want a specific version. Leave empty to auto-detect.',
    'deps.manualPlaceholder': 'Leave empty to auto-detect',
    'deps.applyAndRecheck': 'Apply and check again',

    // ===== Deps prompt modal =====
    'depsPrompt.title': 'Runtime dependencies needed',
    'depsPrompt.body': 'DownVid no longer bundles yt-dlp / ffmpeg and prefers the versions installed on your machine. Currently missing:',
    'depsPrompt.downloading': 'Downloading {tool}...',
    'depsPrompt.orInstall': 'You can also install it yourself and hit “Check again”:',
    'depsPrompt.openDir': 'Open install folder',
    'depsPrompt.downloadAndContinue': 'Download and continue',

    // ===== Cookie guide =====
    'cookieGuide.title': 'Why cookies are needed',
    'cookieGuide.intro': 'YouTube restricts anonymous requests; with your browser’s login state it parses and downloads normally.',
    'cookieGuide.recommended': 'Recommended',
    'cookieGuide.autoTitle': 'Let DownVid read browser cookies automatically',
    'cookieGuide.autoStep1': 'Sign in to YouTube in your browser first',
    'cookieGuide.autoStep2': 'Open Settings → Cookies and set the mode to “Read browser cookies automatically”',
    'cookieGuide.autoStep3': 'Come back here and parse again — no file to export by hand',
    'cookieGuide.autoNote': 'DownVid tries the browsers installed on your machine (Chrome / Edge / Firefox / Safari / Brave), exports a snapshot and reuses it, so parsing and downloading share one login state. Check Settings → Cookies to see which source is in use.',
    'cookieGuide.ifFail': 'If automatic reading fails',
    'cookieGuide.failBrowserRunning': 'Browser is running: quit it completely and retry (Chrome / Edge lock the cookie database)',
    'cookieGuide.failSafari': 'Safari on macOS: grant DownVid “Full Disk Access” (System Settings → Privacy & Security → Full Disk Access)',
    'cookieGuide.failWindowsChrome': 'Chrome on Windows: cookies are App-Bound encrypted and the database is locked while running — use Firefox instead, or the manual route below',
    'cookieGuide.manualTitle': 'Import cookies.txt manually',
    'cookieGuide.manualStepInstall': 'Install the extension in your browser',
    'cookieGuide.manualStepExport': 'Open youtube.com, make sure you are signed in, and export a Netscape-format cookies.txt with the extension',
    'cookieGuide.manualStepImport': 'Open Settings → Cookies, switch the mode to “Import a cookie file manually” and pick the exported file',
    'cookieGuide.expireNote': 'Cookies expire and must be re-exported. If that happens often, automatic reading is less hassle.',
    'cookieGuide.openSettings': 'Open cookie settings',

    // ===== Error modal =====
    'error.title': 'Something went wrong',
    'error.warning': 'Heads up',
    'error.info': 'Notice',
    'error.showDetail': 'Show error details',
    'error.hideDetail': 'Hide error details',
    'error.copyDetail': 'Copy error details',
    'error.submitIssue': 'Report an issue',
    'error.acknowledge': 'Got it',

    // ===== About =====
    'about.title': 'About',
    'about.checkUpdate': 'Check for updates',
    'about.intro': 'An open-source video downloader built on yt-dlp, supporting Douyin, Bilibili, YouTube and more.',
    'about.feedback': 'Feedback',
    'about.feedbackHint': 'Send a suggestion or report a problem',
    'about.contributors': 'Contributors',
    'about.openSource': 'Open source components',
    'about.homepage': 'Homepage',
    'about.techStack': 'Tech stack',
    'about.license': 'License',
    'about.support': 'Support DownVid',
    'about.supportHint': 'If this tool helps you, consider buying the author a coffee ☕',
    'about.showDonate': 'Show donation code',
    'about.hideDonate': 'Hide donation code',
    'about.donateAlt': 'WeChat donation code',
    'about.donateCaption': 'Scan with WeChat to tip Black Cat',
    'about.website': 'Website',
    'about.websiteHint': 'Downloads and feature overview',
    'about.contactHint': 'Use Issues for bug reports and feature requests so others can find them. For the following, email us:',
    'about.contactSponsor': 'Sponsorship',
    'about.contactBusiness': 'Business / advertising',
    'about.mailSubjectSponsor': '[DownVid] Sponsorship',
    'about.mailSubjectBusiness': '[DownVid] Business',

    // ===== Update modal =====
    'update.title': 'Software update',
    'update.available': 'v{new} is available · you have v{current}',
    'update.current': 'Current version v{current}',
    'update.checking': 'Checking for updates...',
    'update.upToDate': 'You are up to date',
    'update.noUpdate': 'DownVid v{current} has no updates',
    'update.manualReason': 'This installation method cannot auto-update — download it from the releases page',
    'update.manualSuggestion': 'Updating gets you the latest features and security fixes',
    'update.whatsNew': "What's new",
    'update.noNotes': 'No release notes',
    'update.downloading': 'Downloading v{new}',
    'update.doNotClose': 'Do not close the app while downloading',
    'update.downloaded': 'Download complete',
    'update.ready': 'v{new} is ready',
    'update.readyHint': 'Click “Restart and install” to finish — the app will reopen automatically',
    'update.later': 'Later',
    'update.goToDownload': 'Go to download page',
    'update.downloadUpdate': 'Download update',
    'update.restartLater': 'Restart later',
    'update.restartAndInstall': 'Restart and install',
    'update.done': 'Done',

    // ===== Download errors (from friendlyDownloadError and main-process strings) =====
    'err.forbiddenLogin': 'Site refused the download (403): this video needs a login — configure cookies under Settings → Cookies and retry',
    'err.forbidden': 'Site refused the download (403): possibly too many requests or a login is required. Retry later, or configure cookies under Settings → Cookies',
    'err.rateLimited': 'Too many requests (429): wait a few minutes and retry',
    'err.diskFull': 'Not enough disk space',
    'err.permission': 'No write permission — check the download folder',
    'err.network': 'Connection interrupted, please retry',
    'err.unreachable': 'Cannot reach the site: check your connection or set a proxy under Settings → Proxy',
    'err.ffmpeg': 'FFmpeg merge failed: check ffmpeg under Settings → Runtime dependencies',
    'err.privateVideo': 'This video requires a login',
    'err.videoUnavailable': 'Video unavailable (removed or region-restricted)',

    // Context menu
    'ctx.cut': 'Cut',
    'ctx.copy': 'Copy',
    'ctx.paste': 'Paste',
    'ctx.delete': 'Delete',
    'ctx.selectAll': 'Select all',

    // Dependency source
    'deps.sourceSystem': 'System install',
    'deps.sourceManaged': 'Managed by DownVid',
    'deps.sourceManual': 'Manual path',
    'deps.sourceScanned': 'Found by scan',
    'deps.downloadedSize': '{size} downloaded',
    'deps.retrying': 'Network unstable, retrying...',
    'deps.installedNotice': '{tool} installed',
    'deps.downloadFailed': 'Dependency download failed',
    'deps.checkFailed': 'Dependency check failed',
    'deps.readyNotice': 'Dependencies ready',

    // Update flow status
    'update.errCheck': 'Check failed',
    'update.errDownload': 'Download failed',
    'update.errInstall': 'Install failed',
    'update.errGeneric': 'Update failed',
    'update.errCheckNetwork': 'Update check failed — check your network connection',
    'update.preparing': 'Preparing download...',

    // About page tech stack
    'about.techGo': 'Sidecar: detects and reuses the yt-dlp / ffmpeg already on your system',
    'about.techNotBundled': 'Not bundled — resolved at runtime',
    'err.ytdlpMissing': 'yt-dlp not found',
    'err.depMissing': '{kind} not found — download it under Settings → Runtime dependencies, then retry',
  },
}

/** 供 lint:i18n 与测试使用的只读词条表 */
export function allMessages(): Record<Locale, Record<string, string>> {
  return messages
}

/** 探测系统语言：只有明确是中文时才用中文，其余一律英文 */
export function detectSystemLocale(): Locale {
  const langs = [
    ...(typeof navigator !== 'undefined' ? navigator.languages || [] : []),
    typeof navigator !== 'undefined' ? navigator.language : '',
  ].filter(Boolean) as string[]
  for (const lang of langs) {
    const lower = lang.toLowerCase()
    if (lower.startsWith('zh')) return 'zh-CN'
    if (lower.startsWith('en')) return 'en-US'
  }
  // 默认英文：README 以英文为默认、官网双语、有海外用户，
  // 让中文用户看到英文界面的代价，小于让海外用户看到纯中文界面。
  return 'en-US'
}

const currentLocale = ref<Locale>('zh-CN')

/** 当前语言（只读，改语言请用 setLocale） */
export const locale = computed(() => currentLocale.value)

/** 设置界面语言 */
export function setLocale(next: Locale): void {
  currentLocale.value = next
}

/**
 * 取词条。
 *
 * 缺失时**回退到中文再回退到键名**：宁可显示中文也不能显示 `queue.title`
 * 这种原始键名——后者会让用户以为界面坏了。
 */
export function t(key: string, params?: Record<string, string | number | undefined>): string {
  const table = messages[currentLocale.value] || {}
  let text = table[key] ?? messages['zh-CN'][key] ?? key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      // undefined 渲染成空串而不是字面量 "undefined"——版本号缺失时
      // 界面上出现 "当前 undefined" 比留空更糟。
      text = text.split(`{${name}}`).join(value === undefined ? '' : String(value))
    }
  }
  return text
}

/**
 * 解析「跟随系统」设置。
 *
 * `AppSettings.language` 存 'auto' | 'zh-CN' | 'en-US'；
 * 'auto' 时按系统语言决定。返回具体的 locale 供 setLocale 使用。
 */
export function resolveLocale(setting: string | undefined): Locale {
  if (setting === 'zh-CN' || setting === 'en-US') return setting
  return detectSystemLocale()
}

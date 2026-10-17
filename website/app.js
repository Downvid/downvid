// 中英双语 + 按系统直链下载。纯前端实现，无后端、无构建步骤。
//
// 下载区四步：识别系统与芯片 → 拉一次最新 Release（结果缓存 30 分钟）→
// 在真实产物列表里选中对应安装包 → 把主按钮的 href 指向产物直链。
// GitHub 对 Release 产物返回 Content-Disposition: attachment，所以点一下就下载，
// 不会跳到 Releases 页面；任意一步失败（离线 / 403 限流 / 产物缺失 / 系统未识别）都退回
// Releases 页面，不留死链。主按钮右边的箭头展开「所有平台与格式」，识别不准或替别人下载时用。
//
// 新增文案时两处都要补；缺 key 会保留 HTML 里的默认中文。
const I18N = {
  // 中文默认值就写在 HTML 的 data-i18n 原文里；这里只列**脚本拼装**用得到的文案
  zh: {
    'hero.download': '下载最新版',
    'plat.windows': 'Windows',
    'plat.macos': 'macOS',
    'plat.linux': 'Linux',
    'dl.for': '下载 {platform} 版',
    'dl.latest': '最新版',
    'dl.about': '约',
    'dl.checking': '正在获取最新版本…',
    'dl.offline': '暂时拿不到最新版本信息，点击将打开 Releases 页面。',
    'dl.missing': '最新版里没有找到对应安装包，请到 Releases 页面查看。',
    'dl.unknown': '没识别出桌面系统，请从下面的列表里选。',
    'dl.win.setup': 'Windows 安装版 (.exe)',
    'dl.win.portable': 'Windows 便携版 (.exe)',
    'dl.mac.arm': 'Apple 芯片 (.dmg)',
    'dl.mac.intel': 'Intel 芯片 (.dmg)',
    'dl.linux.appimage': 'x64 AppImage',
    'dl.linux.appimage.arm': 'arm64 AppImage',
    'dl.linux.deb': 'x64 .deb',
    'dl.linux.rpm': 'x64 .rpm',
    'dev.copy': '复制',
    'dev.copied': '已复制',
    'demo.start': '开始',
    'demo.pause': '暂停',
    'demo.detect': '检测依赖',
    'demo.detecting': '检测中…',
    'demo.ready': '已就绪',
    'demo.check': '检查更新',
    'demo.checking': '正在检查…',
    'demo.latest': '已是最新',
    'demo.offline': '暂时拿不到版本信息',
    'demo.tabdownload': '解析下载',
    'demo.tabhistory': '下载历史',
    'demo.tababout': '关于软件',
    'demo.newtask': '新任务',
    'demo.sample': '试试示例链接',
    'demo.accel': '下载加速',
    'demo.accel.unit': '连接',
    'demo.effortlight': '轻量',
    'demo.effortbalanced': '均衡',
    'demo.effortfast': '快速',
    'demo.effortaggressive': '激进',
    'demo.effortlight.hint': '省带宽，适合边用边下',
    'demo.effortbalanced.hint': '推荐，默认 8 连接',
    'demo.effortfast.hint': '更多连接，下载更快',
    'demo.effortaggressive.hint': '最快，但更容易触发站点限流',
    'demo.heat': '下载热力',
    'demo.less': '少',
    'demo.more': '多',
    'demo.heat.total': '过去一年下载',
    'demo.heat.streak': '连续下载天数',
    'demo.heat.last30': '最近 30 天',
    'demo.recent': '最近下载',
    'demo.recent.all': '查看全部',
    'demo.back': '返回',
    'demo.placeholder': '在此处粘贴需要解析的视频链接...',
    'demo.paste': '粘贴链接',
    'demo.parse': '解析视频信息',
    'demo.parsing': '解析中...',
    'demo.extracting': '正在提取视频元数据...',
    'demo.usuallyseconds': '通常需要几秒',
    'demo.elapsed': '已用 {seconds} 秒',
    'demo.result': '解析结果预览',
    'demo.videohdr': '视频格式 (MP4) - 共 {count} 个',
    'demo.audiohdr': '纯音频格式 - 共 {count} 个',
    'demo.download': '立即下载所选资源',
    'demo.downloadaudio': '下载纯音频',
    'demo.downloading': '正在下载...',
    'demo.queue': '任务队列',
    'demo.active': '{count} 进行中',
    'demo.queueempty': '暂无下载任务',
    'demo.queuehint': '解析视频后点击下载按钮添加任务',
    'demo.storage': '存储空间',
    'demo.historyempty': '暂无下载记录',
    'demo.about': '基于 yt-dlp 的开源桌面视频下载工具',
    'demo.caption': '上面是应用界面的可交互演示——可以直接点',
  },
  en: {
    'brand.tag': 'Open source',
    'hero.eyebrow': 'Open source · Cross-platform · Free',
    'hero.title': 'Save the videos<br>you like, locally.',
    'hero.lede': 'An open-source desktop app for macOS, Windows and Linux. Powered by yt-dlp, supporting 1000+ sites, with a clean interface and no command-line flags to remember.',
    'hero.download': 'Download latest',
    'hero.source': 'View source',
    'dl.menu': 'All platforms and formats',
    'dl.all': 'All releases and artifacts',
    'dl.for': 'Download for {platform}',
    'dl.latest': 'Latest',
    'dl.about': '~',
    'dl.checking': 'Fetching the latest version…',
    'dl.offline': "Couldn't fetch the latest version; the button opens the Releases page instead.",
    'dl.missing': 'No matching package in the latest release — see the Releases page.',
    'dl.unknown': 'Could not detect a desktop OS — pick one from the list below.',
    'dl.win.setup': 'Windows installer (.exe)',
    'dl.win.portable': 'Windows portable (.exe)',
    'dl.mac.arm': 'Apple silicon (.dmg)',
    'dl.mac.intel': 'Intel (.dmg)',
    'dl.linux.appimage': 'x64 AppImage',
    'dl.linux.appimage.arm': 'arm64 AppImage',
    'dl.linux.deb': 'x64 .deb',
    'dl.linux.rpm': 'x64 .rpm',
    'plat.macos': 'macOS',
    'plat.windows': 'Windows',
    'plat.linux': 'Linux',
    'feat.title': 'What it does',
    'feat.sub': 'Everything you need, and none of the things you should not have.',
    'feat.sites.t': '1000+ sites',
    'feat.sites.d': 'Powered by yt-dlp. Douyin and Kuaishou have dedicated parsers that return the watermark-free URL.',
    'feat.quality.t': 'Quality and formats',
    'feat.quality.d': '360P to 4K, audio-only (MP3), subtitles-only (SRT) and YouTube multi-audio-track.',
    'feat.speed.t': 'Download acceleration',
    'feat.speed.d': 'Direct links use a small-chunk worker queue (8 by default, up to 16); optional aria2 multi-connection.',
    'feat.cookie.t': 'Logged-in content',
    'feat.cookie.d': 'Reads cookies from your installed browsers, or import a cookies.txt manually.',
    'feat.deps.t': 'Automatic dependencies',
    'feat.deps.d': 'The installer does not bundle yt-dlp / FFmpeg. It reuses what is already on your machine and can download them when missing.',
    'feat.update.t': 'Auto update',
    'feat.update.d': 'Updates through GitHub Releases. macOS is unsigned, so it verifies and swaps the app bundle itself.',
    'ins.title': 'Three steps',
    'ins.sub': 'No command-line tools to install beforehand.',
    'ins.s1.t': 'Download the package',
    'ins.s1.d': 'The page detects your system and downloads the matching package in one click — no extra pages.',
    'ins.s2.t': 'Paste a link',
    'ins.s2.d': 'Paste the video URL and choose a quality or format.',
    'ins.s3.t': 'Start downloading',
    'ins.s3.d': 'If runtime dependencies are missing on first use, the app offers a one-click install.',
    'ins.cta': 'Go to downloads',
    'ins.guide': 'Installation guide',
    'ins.note': 'Note: the macOS build is not code-signed, so the first launch needs to be allowed under System Settings → Privacy & Security.',
    'dev.title': 'Install and run',
    'dev.sub': 'Installation differs a little per platform — here are the usual steps.',
    'dev.mac.t': 'macOS: the build is unsigned',
    'dev.mac.d': 'Allow it under System Settings → Privacy & Security on first launch, or strip the quarantine attribute first.',
    'dev.linux.t': 'Linux: AppImage needs no install',
    'dev.linux.d': 'Add the executable bit and run it; .deb / .rpm go through your package manager.',
    'dev.build.t': 'Build from source',
    'dev.build.d': 'Needs Node 22+ and pnpm; the Go sidecar is compiled on startup.',
    'dev.copy': 'Copy',
    'dev.copied': 'Copied',
    'demo.start': 'Start',
    'demo.pause': 'Pause',
    'demo.detect': 'Detect',
    'demo.detecting': 'Detecting…',
    'demo.ready': 'Ready',
    'demo.check': 'Check for updates',
    'demo.checking': 'Checking…',
    'demo.latest': 'Up to date',
    'demo.offline': 'Could not fetch the version',
    'demo.tabdownload': 'Download',
    'demo.tabhistory': 'History',
    'demo.tababout': 'About',
    'demo.newtask': 'New task',
    'demo.sample': 'Try a sample link',
    'demo.accel': 'Acceleration',
    'demo.accel.unit': 'connections',
    'demo.effortlight': 'Light',
    'demo.effortbalanced': 'Balanced',
    'demo.effortfast': 'Fast',
    'demo.effortaggressive': 'Aggressive',
    'demo.effortlight.hint': 'Light on bandwidth, good for background downloads',
    'demo.effortbalanced.hint': 'Recommended, 8 connections by default',
    'demo.effortfast.hint': 'More connections, faster downloads',
    'demo.effortaggressive.hint': 'Fastest, but more likely to hit site rate limits',
    'demo.heat': 'Download heatmap',
    'demo.less': 'Less',
    'demo.more': 'More',
    'demo.heat.total': 'Downloads this year',
    'demo.heat.streak': 'Day streak',
    'demo.heat.last30': 'Last 30 days',
    'demo.recent': 'Recent downloads',
    'demo.recent.all': 'View all',
    'demo.back': 'Back',
    'demo.placeholder': 'Paste the video link here...',
    'demo.paste': 'Paste',
    'demo.parse': 'Parse',
    'demo.parsing': 'Parsing...',
    'demo.extracting': 'Extracting video metadata...',
    'demo.usuallyseconds': 'Usually a few seconds',
    'demo.elapsed': '{seconds}s elapsed',
    'demo.result': 'Result preview',
    'demo.videohdr': 'Video formats (MP4) - {count} total',
    'demo.audiohdr': 'Audio-only formats - {count} total',
    'demo.download': 'Download the selected format',
    'demo.downloadaudio': 'Download audio only',
    'demo.downloading': 'Downloading...',
    'demo.queue': 'Task queue',
    'demo.active': '{count} active',
    'demo.queueempty': 'No downloads yet',
    'demo.queuehint': 'Parse a video, then hit the download button',
    'demo.storage': 'Storage',
    'demo.historyempty': 'No download history',
    'demo.about': 'An open-source desktop video downloader built on yt-dlp',
    'demo.caption': 'The app UI above is an interactive demo - go ahead and click',
    'join.title': 'Join the open-source community',
    'join.sub': 'DownVid is an MIT-licensed open-source project. File an issue, send a pull request, or just leave a star.',
    'join.github': 'View on GitHub',
    'join.docs': 'Developer docs',
    'sponsor.title': 'Sponsorship and business',
    'sponsor.sub': 'For sponsorship, or for business enquiries such as a placement, email us. Use Issues for bugs and feature requests so others can find the answers too.',
    'sponsor.tip': 'Sponsorship',
    'sponsor.business': 'Business / placement',
    'sponsor.subject.tip': '[DownVid] Sponsorship',
    'sponsor.subject.business': '[DownVid] Business',
    'sponsor.note': 'The app itself contains no ads and never will — these enquiries are about the project, not about anything shipped inside the installer.',
    'faq.title': 'FAQ',
    'faq.sub': 'More in the repository docs.',
    'faq.q1': 'It says yt-dlp or FFmpeg is missing?',
    'faq.a1': 'The installer does not bundle them. The app looks for a usable copy already on your system first; if it cannot find one, download it from the prompt or manage it under Settings → Runtime dependencies.',
    'faq.q2': 'macOS says the developer cannot be verified?',
    'faq.a2': 'The first time, right-click the app and choose Open, or allow it under System Settings → Privacy & Security. The project has no paid developer certificate; this is a known trade-off.',
    'faq.q3': 'Some videos fail to download?',
    'faq.a3': 'Usually the site requires you to be signed in. Make sure you are allowed to access the content, then let the app read your browser session or import a cookies.txt. Site changes can also affect extraction.',
    'faq.q4': 'Does it download copyrighted content?',
    'faq.a4': 'DownVid is only a graphical front end for yt-dlp and contains no code for cracking or circumventing protection measures. Follow your local laws, platform terms and copyright; you are responsible for how you use it.',
    'foot.license': 'MIT licensed',
    'foot.repo': 'Source',
    'foot.releases': 'Releases',
    'foot.issues': 'Issues',
    'foot.changelog': 'Changelog',
    'foot.security': 'Security',
  },
};

// >>> 纯逻辑（tests/website-download.test.ts 从这段提取后单独执行，这里不要碰 DOM）
// 仓库坐标：lint:website 会与 shared/app.ts 比对，换仓库时不会漏掉官网这一处
const REPO = { owner: 'Downvid', repo: 'downvid' };
const RELEASES_URL = 'https://github.com/' + REPO.owner + '/' + REPO.repo + '/releases';
const LATEST_URL = RELEASES_URL + '/latest';
const RELEASE_API = 'https://api.github.com/repos/' + REPO.owner + '/' + REPO.repo + '/releases/latest';

// 平台顺序与词条名。key 写字面量是为了让 lint:website 能核到中英词条
const PLATFORMS = [
  { os: 'windows', key: 'plat.windows' },
  { os: 'macos', key: 'plat.macos' },
  { os: 'linux', key: 'plat.linux' },
];

// 产物名模板：{version} 是版本号的位置。前缀与扩展名必须与 electron-builder.json5 的
// artifactName 对得上（pnpm lint:website 会逐条比对），否则改名后官网会静默挑不到产物。
// primary = 该平台主推的产物；arch 用来在 macOS / Linux 上区分芯片。
const ARTIFACTS = {
  windows: [
    { name: 'DownVid-Setup-{version}.exe', key: 'dl.win.setup', arch: 'x64', primary: true },
    { name: 'DownVid-Portable-{version}.exe', key: 'dl.win.portable', arch: 'x64' },
  ],
  macos: [
    { name: 'DownVid-arm64-Mac-{version}.dmg', key: 'dl.mac.arm', arch: 'arm64', primary: true },
    { name: 'DownVid-x64-Mac-{version}.dmg', key: 'dl.mac.intel', arch: 'x64', primary: true },
  ],
  linux: [
    { name: 'DownVid-x86_64-Linux-{version}.AppImage', key: 'dl.linux.appimage', arch: 'x64', primary: true },
    { name: 'DownVid-arm64-Linux-{version}.AppImage', key: 'dl.linux.appimage.arm', arch: 'arm64', primary: true },
    { name: 'DownVid-amd64-Linux-{version}.deb', key: 'dl.linux.deb', arch: 'x64' },
    { name: 'DownVid-x86_64-Linux-{version}.rpm', key: 'dl.linux.rpm', arch: 'x64' },
  ],
};

/**
 * 判断桌面系统。Android / iOS / ChromeOS 一律归到 other：
 * 官网没有它们的安装包，把它们当 Linux 只会让用户下到一个装不上的包。
 */
function detectOS(nav) {
  const ua = String((nav && nav.userAgent) || '');
  const platform = String((nav && nav.platform) || (nav && nav.userAgentData && nav.userAgentData.platform) || '');
  if (/android|iphone|ipod|ipad/i.test(ua)) return 'other';
  // iPadOS 13 起 UA 与 Mac 一样，靠触摸点数区分
  if (/mac/i.test(platform) && ((nav && nav.maxTouchPoints) || 0) > 1) return 'other';
  if (/cros/i.test(platform + ' ' + ua)) return 'other';
  if (/win/i.test(platform) || /windows/i.test(ua)) return 'windows';
  if (/mac/i.test(platform) || /mac os x/i.test(ua)) return 'macos';
  if (/linux|x11/i.test(platform) || /linux|x11/i.test(ua)) return 'linux';
  return 'other';
}

/**
 * 架构判断（同步那一半）。Safari / Firefox 拿不到架构：macOS 默认给 Apple 芯片
 * （Intel 版固定列在菜单里，用户自己点得到），其余平台默认 x64。
 * Chrome / Edge 会用 Client Hints 再修一次，见 archFromClientHints。
 */
function archOf(nav, os) {
  const ua = String((nav && nav.userAgent) || '');
  if (/aarch64|arm64|armv8/i.test(ua)) return 'arm64';
  return os === 'macos' ? 'arm64' : 'x64';
}

/** 架构判断（Client Hints 那一半）；浏览器不支持时返回 null，调用方保持同步结果 */
function archFromClientHints(userAgentData) {
  if (!userAgentData || typeof userAgentData.getHighEntropyValues !== 'function') return Promise.resolve(null);
  return userAgentData.getHighEntropyValues(['architecture']).then(function (hints) {
    if (hints && hints.architecture === 'arm') return 'arm64';
    if (hints && hints.architecture === 'x86') return 'x64';
    return null;
  }).catch(function () {
    return null;
  });
}

/** 'DownVid-Setup-{version}.exe' → /^DownVid-Setup-[0-9]+(?:\.[0-9]+)*\.exe$/ */
function templateToRegex(template) {
  const escaped = template.replace(/\./g, '\\.').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
  return new RegExp('^' + escaped.replace('\\{version\\}', '[0-9]+(?:\\.[0-9]+)*') + '$');
}

/** GitHub releases/latest 的响应 → 只保留产物名、直链与体积 */
function normalizeRelease(json) {
  if (!json || !Array.isArray(json.assets)) return null;
  const tag = typeof json.tag_name === 'string' ? json.tag_name : '';
  if (!tag) return null;
  const assets = json.assets
    .filter(a => a && typeof a.name === 'string' && typeof a.browser_download_url === 'string')
    .map(a => ({ name: a.name, url: a.browser_download_url, size: typeof a.size === 'number' ? a.size : 0 }));
  return assets.length ? { tag: tag, assets: assets } : null;
}

/**
 * 在真实产物里挑出该平台该架构的安装包。
 * 返回 { primary, others }：primary 是主按钮的目标，others 是同平台的其他格式。
 * 对应架构缺失时退回该平台第一个主产物，一个都没有就返回 null ——
 * 调用方据此退回 Releases 页面，而不是留一个死链。
 */
function selectDownload(release, os, arch) {
  const empty = { primary: null, others: [] };
  if (!release || !os || !ARTIFACTS[os]) return empty;
  const matches = [];
  for (const variant of ARTIFACTS[os]) {
    const re = templateToRegex(variant.name);
    const asset = release.assets.find(a => re.test(a.name));
    if (asset) matches.push({ asset: asset, variant: variant });
  }
  if (!matches.length) return empty;
  const primary =
    matches.find(m => m.variant.primary && m.variant.arch === arch) ||
    matches.find(m => m.variant.primary) ||
    matches[0];
  return { primary: primary, others: matches.filter(m => m !== primary) };
}

/** 菜单用的全量列表：每个平台里所有能匹配到的产物，识别出的平台排在最前面 */
function listDownloads(release, preferredOS) {
  if (!release) return [];
  const order = PLATFORMS.map(p => p.os);
  const at = order.indexOf(preferredOS);
  if (at > 0) {
    order.splice(at, 1);
    order.unshift(preferredOS);
  }
  const groups = [];
  for (const os of order) {
    const items = [];
    for (const variant of ARTIFACTS[os]) {
      const re = templateToRegex(variant.name);
      const asset = release.assets.find(a => re.test(a.name));
      if (asset) items.push({ asset: asset, variant: variant });
    }
    if (items.length) groups.push({ os: os, items: items });
  }
  return groups;
}

function formatSize(bytes) {
  if (!bytes || bytes < 1024) return '';
  return Math.round(bytes / 1024 / 1024) + ' MB';
}
// <<< 纯逻辑

const CACHE_KEY = 'downvid.latestRelease';
const CACHE_TTL = 30 * 60 * 1000;   // 版本不会分钟级变化，刷新页面不该重复消耗 API 限额

let current = initialLang();
let release = null;
let releaseFailed = false;
const detectedOS = detectOS(navigator);
let selectedOS = detectedOS;
let selectedArch = archOf(navigator, selectedOS);

/** 取词条：data-i18n 的中文原文在 HTML 里，脚本拼装的文案在 I18N.zh 里 */
function t(key) {
  const dict = I18N[current] || {};
  if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
  return Object.prototype.hasOwnProperty.call(I18N.zh, key) ? I18N.zh[key] : key;
}

function apply(lang) {
  const dict = I18N[lang] || {};
  // 赞助 / 商务卡片：邮件主题要跟着界面语言走。
  // 只在 HTML 里写死中文主题，英文用户点开会看到一封中文主题的邮件——
  // 收件箱里分类就乱了，所以中文版主题缓存在 data-mail-subject 上，切语言时重写。
  document.querySelectorAll('[data-mail-subject]').forEach(el => {
    const subject = lang === 'zh' ? el.getAttribute('data-mail-subject') : (dict[el.getAttribute('data-i18n-subject')] || el.getAttribute('data-mail-subject'));
    el.setAttribute('href', 'mailto:xynrin@icloud.com?subject=' + encodeURIComponent(subject));
  });
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    // 中文直接回填原始 HTML（首次切换时缓存下来）
    if (!el.dataset.zh) el.dataset.zh = el.innerHTML;
    const value = lang === 'zh' ? el.dataset.zh : (dict[key] || el.dataset.zh);
    if (value) el.innerHTML = value;
  });
  // textarea 的 placeholder 不在 innerHTML 上，单独刷一遍
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (!el.dataset.zhPh) el.dataset.zhPh = el.getAttribute('placeholder') || '';
    const value = lang === 'zh' ? el.dataset.zhPh : (dict[key] || el.dataset.zhPh);
    if (value) el.setAttribute('placeholder', value);
  });
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.classList.add('ready');
  document.querySelectorAll('.locale-item').forEach(item => {
    item.classList.toggle('is-active', item.getAttribute('data-lang') === lang);
  });
  // 便于分享带语言的链接
  const url = new URL(location.href);
  if (lang === 'zh') url.searchParams.delete('lang'); else url.searchParams.set('lang', lang);
  history.replaceState(null, '', url);
  // 文案换了，按钮上的系统名、提示、菜单与卡片演示都要跟着换
  renderDownload();
  syncDemos();
  syncAppDemo();
}

function initialLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'zh') return q;
  // 默认跟随浏览器；中文环境给中文，其余给英文
  return /^zh\b/i.test(navigator.language || '') ? 'zh' : 'en';
}

/** 平台图标只维护一份：从隐藏容器里克隆，主按钮与菜单共用 */
function osIcon(os) {
  const host = document.getElementById('osIcons');
  if (!host || !os) return null;
  const svg = host.querySelector('svg[data-os="' + os + '"]');
  return svg ? svg.cloneNode(true) : null;
}

function closeMenu() {
  const menu = document.getElementById('dlMenu');
  const caret = document.getElementById('dlCaret');
  if (menu) menu.hidden = true;
  if (caret) caret.setAttribute('aria-expanded', 'false');
}

/**
 * 把「当前系统 + 最新产物」映射到界面：主按钮直链产物，
 * 展开菜单里列出全部平台与格式；拿不到产物时主按钮退回 Releases 页面。
 */
function renderDownload() {
  const btnEl = document.getElementById('dlPrimary');
  const labelEl = document.getElementById('dlPrimaryLabel');
  const iconEl = document.getElementById('dlPrimaryIcon');
  const noteEl = document.getElementById('dlNote');
  const installEl = document.getElementById('dlInstall');
  if (!btnEl || !labelEl || !noteEl) return;

  const os = ARTIFACTS[selectedOS] ? selectedOS : null;
  const picked = os && release ? selectDownload(release, os, selectedArch) : { primary: null, others: [] };

  if (iconEl) {
    iconEl.textContent = '';
    const svg = osIcon(os);
    if (svg) iconEl.appendChild(svg);
  }
  labelEl.textContent = os ? t('dl.for').replace('{platform}', t('plat.' + os)) : t('hero.download');

  let href = LATEST_URL;
  let note;
  if (!os) {
    note = t('dl.unknown');
  } else if (!release) {
    note = releaseFailed ? t('dl.offline') : t('dl.checking');
  } else if (!picked.primary) {
    note = t('dl.missing');
  } else {
    href = picked.primary.asset.url;
    const parts = [t(picked.primary.variant.key), t('dl.latest') + ' ' + release.tag];
    const size = formatSize(picked.primary.asset.size);
    if (size) parts.push(t('dl.about') + ' ' + size);
    note = parts.join(' · ');
  }
  btnEl.setAttribute('href', href);
  if (installEl) installEl.setAttribute('href', href);
  noteEl.textContent = note;

  renderMenu(os);
}

/** 展开菜单：每个平台一组，组内列出该平台所有产物 */
function renderMenu(currentOs) {
  const host = document.getElementById('dlMenuGrid');
  if (!host) return;
  host.textContent = '';
  const groups = release ? listDownloads(release, currentOs) : [];
  if (!groups.length) {
    const empty = document.createElement('p');
    empty.className = 'dl-menu-empty';
    empty.textContent = release ? t('dl.missing') : (releaseFailed ? t('dl.offline') : t('dl.checking'));
    host.appendChild(empty);
    return;
  }
  for (const group of groups) {
    const box = document.createElement('div');
    box.className = 'dl-group';
    const title = document.createElement('p');
    title.className = 'dl-group-title';
    const icon = osIcon(group.os);
    if (icon) title.appendChild(icon);
    const name = document.createElement('span');
    name.textContent = t('plat.' + group.os);
    title.appendChild(name);
    box.appendChild(title);
    for (const item of group.items) {
      const link = document.createElement('a');
      link.className = 'dl-item';
      link.setAttribute('href', item.asset.url);
      const label = document.createElement('span');
      label.textContent = t(item.variant.key);
      link.appendChild(label);
      const size = formatSize(item.asset.size);
      if (size) {
        const meta = document.createElement('span');
        meta.className = 'dl-item-size';
        meta.textContent = size;
        link.appendChild(meta);
      }
      box.appendChild(link);
    }
    host.appendChild(box);
  }
}

/** 最新版本结果缓存 30 分钟（sessionStorage）：版本不会分钟级变化，刷新不该重复请求 */
function readCachedRelease() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.at !== 'number' || Date.now() - parsed.at > CACHE_TTL) return null;
    const cached = parsed.release;
    if (!cached || typeof cached.tag !== 'string' || !Array.isArray(cached.assets)) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCachedRelease(value) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release: value }));
  } catch {
    // 隐私模式 / 禁用存储：只是每次访问都重新请求，不影响下载
  }
}

/** 拉一次最新 Release；失败就保持「去 Releases 页面」的兜底，不弹错误 */
function loadRelease() {
  release = readCachedRelease();
  if (release) {
    renderDownload();
    return;
  }
  renderDownload();
  fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(json => {
      release = normalizeRelease(json);
      if (!release) throw new Error('unexpected payload');
      writeCachedRelease(release);
    })
    .catch(() => { releaseFailed = true; })
    .then(() => renderDownload());
}

// 顶栏：滚起来之后加深底色与投影（浮动胶囊「钉住」的视觉反馈）
const headerEl = document.querySelector('header');
function syncHeader() {
  if (headerEl) headerEl.classList.toggle('is-stuck', document.documentElement.scrollTop > 12);
}
document.addEventListener('scroll', syncHeader, { passive: true });
syncHeader();

// 语言切换：分段控件（参考站点的 中文 / EN 切换）
document.querySelectorAll('.locale-item').forEach(item => {
  item.addEventListener('click', () => {
    const next = item.getAttribute('data-lang');
    if (next === current) return;
    current = next;
    apply(current);
  });
});

// 下载菜单：点箭头展开，点空白 / Esc 收起，点中任意下载项后也收起
const caret = document.getElementById('dlCaret');
const menu = document.getElementById('dlMenu');
if (caret && menu) {
  caret.addEventListener('click', event => {
    event.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    caret.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', event => {
    if (menu.hidden) return;
    if (menu.contains(event.target) || caret.contains(event.target)) return;
    closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });
  menu.addEventListener('click', event => {
    if (event.target && event.target.closest && event.target.closest('a')) closeMenu();
  });
}

// 代码块复制
document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', () => {
    const code = button.parentElement ? button.parentElement.querySelector('code') : null;
    const text = code ? code.textContent : '';
    const done = () => {
      button.textContent = t('dev.copied');
      setTimeout(() => { button.textContent = t('dev.copy'); }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      done();
    }
  });
});

// ===== 卡片小演示：跟桌面端一样能点 =====
// 分组单选（平台 / 画质 / 浏览器）、下载进度、依赖检测、检查更新。全部是纯前端演示，
// 不联网、不改任何状态；「检查更新」用的是真实拉到的 Release 版本号。
let syncDemos = function () {};

function initDemos() {
  // 分组单选：一组 .pick 里只选中一个；卡里若有 [data-pick-out]，顺便显示它对应的体积
  document.querySelectorAll('[data-pick-set]').forEach(set => {
    set.addEventListener('click', event => {
      const pick = event.target && event.target.closest ? event.target.closest('[data-pick]') : null;
      if (!pick || !set.contains(pick)) return;
      set.querySelectorAll('[data-pick]').forEach(item => {
        item.classList.toggle('is-on', item === pick);
      });
      const host = set.closest('.card-media');
      const out = host ? host.querySelector('[data-pick-out]') : null;
      if (out) out.textContent = pick.getAttribute('data-out') || '';
    });
  });

  // 下载加速：开始 / 暂停，进度条与百分比一起走，走满自动停
  const runButton = document.querySelector('[data-run]');
  const runCard = runButton ? runButton.closest('.card-media') : null;
  const runBar = runCard ? runCard.querySelector('[data-bar]') : null;
  const runPercent = runCard ? runCard.querySelector('[data-percent]') : null;
  let runValue = 0;
  let runTimer = null;
  const paintRun = () => {
    if (runBar) runBar.style.width = runValue + '%';
    if (runPercent) runPercent.textContent = Math.round(runValue) + '%';
  };
  const pressRun = () => {
    if (!runButton) return;
    runButton.setAttribute('aria-pressed', runTimer ? 'true' : 'false');
    runButton.textContent = runTimer ? t('demo.pause') : t('demo.start');
  };
  const stopRun = () => {
    if (runTimer) clearInterval(runTimer);
    runTimer = null;
  };
  if (runButton) {
    runButton.addEventListener('click', () => {
      if (runTimer) {
        stopRun();
        pressRun();
        return;
      }
      if (runValue >= 100) runValue = 0;
      runTimer = setInterval(() => {
        runValue = Math.min(100, runValue + 1);
        paintRun();
        if (runValue >= 100) {
          stopRun();
          pressRun();
        }
      }, 90);
      pressRun();
    });
  }

  // 依赖识别：点一下逐个「检出」来
  const detectButton = document.querySelector('[data-detect]');
  const detectCard = detectButton ? detectButton.closest('.card-media') : null;
  const depRows = detectCard ? [...detectCard.querySelectorAll('[data-dep]')] : [];
  if (detectButton) {
    detectButton.addEventListener('click', () => {
      if (detectButton.disabled) return;
      detectButton.disabled = true;
      detectButton.textContent = t('demo.detecting');
      depRows.forEach(row => {
        row.textContent = '···';
        row.classList.remove('is-ok');
      });
      depRows.forEach((row, index) => {
        setTimeout(() => {
          row.textContent = t('demo.ready');
          row.classList.add('is-ok');
          if (index === depRows.length - 1) {
            detectButton.disabled = false;
            detectButton.textContent = t('demo.detect');
          }
        }, 340 * (index + 1));
      });
    });
  }

  // 检查更新：点一下用真实的最新版本作答
  const updateButton = document.querySelector('[data-update]');
  const updateCard = updateButton ? updateButton.closest('.card-media') : null;
  const updateOut = updateCard ? updateCard.querySelector('[data-update-out]') : null;
  const updateBar = updateCard ? updateCard.querySelector('[data-update-bar]') : null;
  let updateState = 'idle';
  const paintUpdate = () => {
    if (!updateButton) return;
    updateButton.disabled = updateState === 'checking';
    updateButton.textContent = updateState === 'checking' ? t('demo.checking') : t('demo.check');
    if (updateBar) updateBar.style.width = updateState === 'idle' ? '0%' : (updateState === 'checking' ? '40%' : '100%');
    if (updateOut) {
      if (updateState === 'checking') updateOut.textContent = '···';
      else if (updateState === 'done') updateOut.textContent = release ? t('demo.latest') + ' · ' + release.tag : t('demo.offline');
      else updateOut.textContent = '—';
    }
  };
  if (updateButton) {
    updateButton.addEventListener('click', () => {
      if (updateState === 'checking') return;
      updateState = 'checking';
      paintUpdate();
      setTimeout(() => {
        updateState = 'done';
        paintUpdate();
      }, 900);
    });
  }

  // 切语言时把演示区的文案（按钮、已就绪、检查结果）重刷一遍
  syncDemos = function () {
    if (runButton) runButton.textContent = runTimer ? t('demo.pause') : t('demo.start');
    if (detectButton && !detectButton.disabled) detectButton.textContent = t('demo.detect');
    depRows.forEach(row => {
      if (row.classList.contains('is-ok')) row.textContent = t('demo.ready');
    });
    paintUpdate();
  };

  paintRun();
  paintUpdate();
}

initDemos();
// ===== hero 预览：应用主界面的可交互复刻 =====
// 结构 / 文案 / 配色照 src/components/DownloadView.vue、UrlInput.vue、FormatSelector.vue、
// DownloadQueue.vue 搬过来，只把真实的解析与下载换成本地动画。纯前端演示，不联网、不动任何状态。
const DV_FORMATS = [
  { quality: '4K', size: '2.28 GB' },
  { quality: '2K', size: '1.00 GB' },
  { quality: '1080P', size: '457.1 MB' },
  { quality: '720P', size: '142.2 MB' },
  { quality: '480P', size: '81.8 MB' },
  { quality: '360P', size: '47.4 MB' },
  { quality: '240P', size: '21.0 MB' },
  { quality: '144P', size: '9.2 MB' },
];
const DV_AUDIO = [
  { quality: '129.479kbps', size: '17.3 MB' },
  { quality: '129.478kbps', size: '17.3 MB' },
  { quality: '129.477kbps', size: '17.2 MB' },
  { quality: '129.476kbps', size: '17.2 MB' },
  { quality: '129.475kbps', size: '17.1 MB' },
  { quality: '129.474kbps', size: '17.1 MB' },
];
const DV_SAMPLE_URL = 'https://youtu.be/n_PxJ2Pyecl';
const DV_TITLE = 'Day Trip to Mt. Fuji Area from Tokyo | Winter Train Trip | JAPAN TRAVEL VLOG';
const DV_FOLDER_ICON = '<svg viewBox="0 0 24 24" class="dv-folder"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z"/></svg>';

let syncAppDemo = function () {};

function initAppDemo() {
  const shell = document.getElementById('dvShell');
  const stage = shell ? shell.querySelector('.dv-stage') : null;
  if (!shell || !stage) return;

  const textarea = document.getElementById('dvUrl');
  const pasteButton = document.getElementById('dvPaste');
  const parseButton = document.getElementById('dvParse');
  const parseLabel = document.getElementById('dvParseLabel');
  const result = document.getElementById('dvResult');
  const parsingBar = document.getElementById('dvParsing');
  const elapsedLabel = document.getElementById('dvElapsed');
  const formatsHost = document.getElementById('dvFormats');
  const audioHost = document.getElementById('dvAudioFormats');
  const videoHeader = document.getElementById('dvVideoHeader');
  const audioHeader = document.getElementById('dvAudioHeader');
  const downloadButton = document.getElementById('dvDownload');
  const downloadLabel = document.getElementById('dvDownloadLabel');
  const queueHost = document.getElementById('dvQueue');
  const queueEmpty = document.getElementById('dvQueueEmpty');
  const activeBadge = document.getElementById('dvActive');
  const sizeLabel = document.getElementById('dvSize');
  const alt = document.getElementById('dvAlt');
  const altHistory = document.getElementById('dvAltHistory');
  const altAbout = document.getElementById('dvAltAbout');
  const historyHost = document.getElementById('dvHistory');
  const historyEmpty = document.getElementById('dvHistoryEmpty');
  const aboutVersion = document.getElementById('dvAboutVersion');
  /**
   * 版本号占位里的那个离线兜底值（`v1.3.4` 这种），由 release.yml 在发布后刷新。
   *
   * **不要**在这里再写一份字面量：两处各写一份就会漂移——刷新脚本只改 HTML，
   * 而这里的字面量会在每次切到「关于软件」标签页或切语言时把它覆盖回去，
   * 于是「发了新版，官网显示的还是旧版号」，而且**没有任何报错**。
   * 拉不到 Release 时就保持占位里的原值。
   */
  const aboutVersionFallback = aboutVersion ? aboutVersion.textContent.trim() : '';
  const tabs = [...document.querySelectorAll('.dv-tab')];
  const panels = [...document.querySelectorAll('[data-dv-panel="download"]')];
  const home = document.getElementById('dvHome');
  const resultView = document.getElementById('dvResultView');
  const backButton = document.getElementById('dvBack');
  const recentAll = document.getElementById('dvRecentAll');
  const sampleButton = document.getElementById('dvSample');
  const accelBox = document.getElementById('dvAccelBox');
  const accelInput = document.getElementById('dvAccel');
  const accelValue = document.getElementById('dvAccelValue');
  const accelEffort = document.getElementById('dvAccelEffort');
  const accelHint = document.getElementById('dvAccelHint');
  const accelTrack = accelBox ? accelBox.querySelector('.dv-accel-track') : null;
  const accelLabels = [...document.querySelectorAll('[data-accel]')];
  const heatHost = document.getElementById('dvHeatmap');
  const monthsHost = document.getElementById('dvMonths');
  const heatRead = document.getElementById('dvHeatRead');

  let mode = 'video';
  let selectedVideo = 0;
  let selectedAudio = 0;
  let parsing = false;
  let parseSeconds = 0;
  let parseTimer = null;
  let ticker = null;
  let resultShown = false;
  let accelIndex = 1;
  const tasks = [];
  const ACCEL_STOPS = [4, 8, 12, 16];

  // 画布按应用窗口的实际 CSS 宽度（1100px）设计，这里等比缩放到容器宽度
  function fitDemo() {
    const width = shell.clientWidth;
    if (!width) return;
    const scale = Math.min(1.08, width / 1100);
    stage.style.setProperty('--dv-scale', String(scale));
    shell.style.height = Math.round(822 * scale) + 'px';
  }
  fitDemo();
  const view = document.defaultView;
  if (view && view.addEventListener) view.addEventListener('resize', fitDemo);

  function posterNode() {
    const source = document.getElementById('dvPoster');
    if (!source) return document.createElement('div');
    const node = source.cloneNode(true);
    node.removeAttribute('id');
    return node;
  }

  function formatRow(item, index, kind) {
    const on = (kind === 'video' ? selectedVideo : selectedAudio) === index;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = on ? 'dv-format is-on' : 'dv-format';
    row.setAttribute('aria-pressed', on ? 'true' : 'false');
    const name = document.createElement('span');
    name.className = 'dv-format-name';
    name.textContent = item.quality;
    const size = document.createElement('span');
    size.className = 'dv-format-size';
    size.textContent = item.size;
    row.appendChild(name);
    row.appendChild(size);
    row.addEventListener('click', () => {
      // 视频 / 纯音频二选一（对应应用里的 downloadMode），不要两行同时选中
      if (kind === 'video') {
        selectedVideo = index;
        selectedAudio = -1;
        mode = 'video';
      } else {
        selectedAudio = index;
        selectedVideo = -1;
        mode = 'audio';
      }
      renderFormats();
      renderDownloadButton();
    });
    return row;
  }

  function renderFormats() {
    if (formatsHost) {
      formatsHost.textContent = '';
      DV_FORMATS.forEach((item, index) => formatsHost.appendChild(formatRow(item, index, 'video')));
    }
    if (audioHost) {
      audioHost.textContent = '';
      DV_AUDIO.forEach((item, index) => audioHost.appendChild(formatRow(item, index, 'audio')));
    }
    if (videoHeader) videoHeader.textContent = t('demo.videohdr').replace('{count}', String(DV_FORMATS.length));
    if (audioHeader) audioHeader.textContent = t('demo.audiohdr').replace('{count}', String(DV_AUDIO.length));
    if (sizeLabel) {
      const current = mode === 'audio' ? DV_AUDIO[selectedAudio] : DV_FORMATS[selectedVideo];
      sizeLabel.textContent = current ? current.size : DV_FORMATS[0].size;
    }
  }

  function renderDownloadButton() {
    if (!downloadLabel || !downloadButton) return;
    const downloading = tasks.some(task => task.status === 'downloading');
    downloadLabel.textContent = downloading ? t('demo.downloading') : (mode === 'audio' ? t('demo.downloadaudio') : t('demo.download'));
    downloadButton.disabled = downloading;
  }

  function taskCard(task) {
    const card = document.createElement('div');
    card.className = task.status === 'completed' ? 'dv-task is-done' : 'dv-task';
    const meta = document.createElement('div');
    meta.className = 'dv-task-meta';
    const head = document.createElement('div');
    head.className = 'dv-task-head';
    const title = document.createElement('p');
    title.className = 'dv-task-title';
    title.textContent = DV_TITLE;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dv-x';
    close.setAttribute('aria-label', 'remove');
    close.textContent = '×';
    close.addEventListener('click', () => {
      const at = tasks.indexOf(task);
      if (at >= 0) tasks.splice(at, 1);
      renderQueue();
      renderHistory();
      renderDownloadButton();
    });
    head.appendChild(title);
    head.appendChild(close);
    meta.appendChild(head);

    if (task.status === 'downloading') {
      const status = document.createElement('div');
      status.className = 'dv-task-status';
      const info = document.createElement('span');
      info.textContent = task.speed + ' - ETA ' + task.eta;
      const percent = document.createElement('span');
      percent.className = 'dv-pct';
      percent.textContent = Math.round(task.progress) + '%';
      status.appendChild(info);
      status.appendChild(percent);
      const track = document.createElement('div');
      track.className = 'dv-bar-track';
      const fill = document.createElement('span');
      fill.style.width = task.progress + '%';
      track.appendChild(fill);
      meta.appendChild(status);
      meta.appendChild(track);
    } else {
      const done = document.createElement('div');
      done.className = 'dv-task-done';
      const quality = document.createElement('span');
      quality.textContent = task.quality;
      const folder = document.createElement('span');
      folder.innerHTML = DV_FOLDER_ICON;
      done.appendChild(quality);
      done.appendChild(folder);
      meta.appendChild(done);
    }

    card.appendChild(posterNode());
    card.appendChild(meta);
    return card;
  }

  function renderQueue() {
    if (!queueHost) return;
    for (const node of [...queueHost.querySelectorAll('.dv-task')]) node.remove();
    if (queueEmpty) queueEmpty.hidden = tasks.length > 0;
    const downloading = tasks.filter(task => task.status === 'downloading').length;
    if (activeBadge) activeBadge.textContent = t('demo.active').replace('{count}', String(downloading));
    if (stage) stage.classList.toggle('has-queue', tasks.length > 0);
    for (const task of tasks) queueHost.appendChild(taskCard(task));
  }

  function renderHistory() {
    if (!historyHost) return;
    historyHost.textContent = '';
    const done = tasks.filter(task => task.status === 'completed');
    if (historyEmpty) historyEmpty.hidden = done.length > 0;
    for (const task of done) {
      const row = document.createElement('div');
      row.className = 'dv-history-row';
      const title = document.createElement('p');
      title.textContent = DV_TITLE;
      const meta = document.createElement('span');
      meta.textContent = task.quality + ' - ' + task.size;
      row.appendChild(title);
      row.appendChild(meta);
      historyHost.appendChild(row);
    }
  }

  function renderAlt(name) {
    if (!alt) return;
    alt.hidden = name === 'download';
    if (altHistory) altHistory.hidden = name !== 'history';
    if (altAbout) altAbout.hidden = name !== 'about';
    if (name === 'history') renderHistory();
    if (name === 'about' && aboutVersion) aboutVersion.textContent = release ? release.tag : aboutVersionFallback;
  }

  function setTab(name) {
    for (const tab of tabs) {
      const on = tab.getAttribute('data-dv-tab') === name;
      tab.classList.toggle('is-on', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    for (const panel of panels) panel.hidden = name !== 'download';
    if (name === 'download') {
      if (home) home.hidden = resultShown;
      if (resultView) resultView.hidden = !resultShown;
      if (result) result.hidden = !resultShown;
    }
    renderAlt(name);
  }

  function tick() {
    let busy = false;
    for (const task of tasks) {
      if (task.status !== 'downloading') continue;
      task.progress = Math.min(100, task.progress + 2.4);
      const remain = Math.max(0, Math.round((100 - task.progress) * 1.9));
      task.eta = String(Math.floor(remain / 60)).padStart(2, '0') + ':' + String(remain % 60).padStart(2, '0');
      if (task.progress >= 100) task.status = 'completed';
      busy = true;
    }
    renderQueue();
    renderHistory();
    renderDownloadButton();
    if (!busy && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function showHome() {
    resultShown = false;
    if (home) home.hidden = false;
    if (resultView) resultView.hidden = true;
    if (result) result.hidden = true;
    if (parsingBar) parsingBar.hidden = true;
  }

  function showResult() {
    resultShown = true;
    if (home) home.hidden = true;
    if (resultView) resultView.hidden = false;
    if (result) result.hidden = false;
  }

  function renderAccel() {
    const index = Math.max(0, Math.min(ACCEL_STOPS.length - 1, accelIndex));
    const value = ACCEL_STOPS[index];
    const labels = [t('demo.effortlight'), t('demo.effortbalanced'), t('demo.effortfast'), t('demo.effortaggressive')];
    const hints = [t('demo.effortlight.hint'), t('demo.effortbalanced.hint'), t('demo.effortfast.hint'), t('demo.effortaggressive.hint')];
    const percent = (index / (ACCEL_STOPS.length - 1)) * 100;
    if (accelValue) accelValue.textContent = String(value);
    if (accelEffort) accelEffort.textContent = labels[index];
    if (accelHint) accelHint.textContent = hints[index];
    if (accelInput) accelInput.value = String(index);
    if (accelTrack) {
      accelTrack.style.setProperty('--pct', percent + '%');
      accelTrack.style.setProperty('--scale', String(percent / 100));
    }
    if (accelBox) accelBox.classList.toggle('is-hot', index >= 2);
    accelLabels.forEach((button) => {
      const at = Number(button.getAttribute('data-accel'));
      button.classList.toggle('is-on', at === index);
    });
  }

  function renderHeatmap() {
    if (!heatHost || !monthsHost) return;
    const lang = current === 'en' ? 'en-US' : 'zh-CN';
    const monthFormat = new Intl.DateTimeFormat(lang, { month: 'short' });
    const dayFormat = new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' });
    const now = new Date();
    const monday = new Date(now);
    const shift = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - shift - 43 * 7);
    heatHost.textContent = '';
    monthsHost.textContent = '';
    let lastMonth = -1;
    const cells = [];
    for (let w = 0; w < 44; w++) {
      const week = document.createElement('div');
      week.className = 'dv-week';
      for (let d = 0; d < 7; d++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + w * 7 + d);
        const future = date > now;
        const count = future ? 0 : (w * 7 + d * 3 + 5) % 9;
        const level = count === 0 ? 0 : count <= 2 ? 1 : count <= 4 ? 2 : count <= 6 ? 3 : 4;
        const cell = document.createElement('span');
        cell.className = 'dv-cell' + (future ? ' is-empty' : ' level-' + level);
        if (!future) {
          cell.title = dayFormat.format(date) + ' · ' + count;
          cell.addEventListener('mouseenter', () => {
            if (heatRead) heatRead.textContent = dayFormat.format(date) + ' · ' + count + (current === 'en' ? ' downloads' : ' 次下载');
          });
          cells.push({ date, count });
        }
        week.appendChild(cell);
      }
      heatHost.appendChild(week);
      const month = new Date(monday);
      month.setDate(monday.getDate() + w * 7);
      const slot = document.createElement('span');
      slot.className = 'dv-month-slot';
      if (month.getMonth() !== lastMonth && w < 43) {
        slot.textContent = monthFormat.format(month);
        lastMonth = month.getMonth();
      }
      monthsHost.appendChild(slot);
    }
    if (heatRead && cells.length) {
      const last = cells[cells.length - 1];
      heatRead.textContent = dayFormat.format(last.date) + ' · 5' + (current === 'en' ? ' downloads' : ' 次下载');
    }
  }

  function startParse() {
    if (parsing) return;
    if (textarea && !textarea.value.trim()) textarea.value = DV_SAMPLE_URL;
    parsing = true;
    parseSeconds = 0;
    showHome();
    if (parsingBar) parsingBar.hidden = false;
    if (elapsedLabel) elapsedLabel.textContent = t('demo.usuallyseconds');
    if (parseButton) parseButton.disabled = true;
    if (parseLabel) parseLabel.textContent = t('demo.parsing');
    if (parseTimer) clearInterval(parseTimer);
    parseTimer = setInterval(() => {
      parseSeconds += 1;
      if (elapsedLabel) elapsedLabel.textContent = t('demo.elapsed').replace('{seconds}', String(parseSeconds));
    }, 1000);
    setTimeout(() => {
      if (parseTimer) clearInterval(parseTimer);
      parseTimer = null;
      parsing = false;
      if (parsingBar) parsingBar.hidden = true;
      if (parseButton) parseButton.disabled = false;
      if (parseLabel) parseLabel.textContent = t('demo.parse');
      renderFormats();
      showResult();
      renderDownloadButton();
    }, 1500);
  }

  if (pasteButton) {
    pasteButton.addEventListener('click', () => {
      if (!textarea) return;
      textarea.value = DV_SAMPLE_URL;
      textarea.focus();
    });
  }
  if (parseButton) parseButton.addEventListener('click', startParse);
  if (downloadButton) {
    downloadButton.addEventListener('click', () => {
      const item = (mode === 'audio' ? DV_AUDIO[selectedAudio] : DV_FORMATS[selectedVideo]) || DV_FORMATS[0];
      tasks.push({ quality: item.quality, size: item.size, progress: 0, speed: '5.4 MB/s', eta: '07:05', status: 'downloading' });
      if (stage) stage.classList.add('has-queue');
      setTab('download');
      renderQueue();
      renderHistory();
      renderDownloadButton();
      if (!ticker) ticker = setInterval(tick, 130);
    });
  }

  if (backButton) backButton.addEventListener('click', showHome);

  if (accelInput) {
    accelInput.addEventListener('input', () => {
      accelIndex = Number(accelInput.value);
      renderAccel();
    });
  }
  accelLabels.forEach((button) => {
    button.addEventListener('click', () => {
      accelIndex = Number(button.getAttribute('data-accel'));
      renderAccel();
    });
  });

  for (const node of document.querySelectorAll('[data-recent]')) {
    node.addEventListener('click', () => setTab('history'));
  }
  if (recentAll) recentAll.addEventListener('click', () => setTab('history'));
  if (sampleButton) sampleButton.addEventListener('click', () => {
    if (textarea) textarea.value = DV_SAMPLE_URL;
    startParse();
  });
  for (const tab of tabs) {
    tab.addEventListener('click', () => setTab(tab.getAttribute('data-dv-tab')));
  }

  // 切语言时把这块演示的文案重刷一遍
  syncAppDemo = function () {
    if (parseLabel) parseLabel.textContent = parsing ? t('demo.parsing') : t('demo.parse');
    if (elapsedLabel && !parsing) elapsedLabel.textContent = t('demo.usuallyseconds');
    if (aboutVersion) aboutVersion.textContent = release ? release.tag : aboutVersionFallback;
    renderFormats();
    renderQueue();
    renderHistory();
    renderDownloadButton();
    renderAccel();
    renderHeatmap();
  };

  // 默认停在新的首页：命令条 + effort 滑块 + 热力图 + 最近下载。
  // 点「解析」才进入结果页，点「下载」才出现右侧任务队列。
  if (textarea) textarea.value = DV_SAMPLE_URL;
  renderFormats();
  showHome();
  renderQueue();
  renderHistory();
  renderDownloadButton();
  renderHeatmap();
  renderAccel();

  fitDemo();
}

initAppDemo();

apply(current);

// 先按同步判断渲染，再用 Client Hints 修一次架构（Chrome / Edge 才有这个 API）
loadRelease();
archFromClientHints(navigator.userAgentData).then(hint => {
  if (hint && hint !== selectedArch && selectedOS === detectedOS) {
    selectedArch = hint;
    renderDownload();
  }
});

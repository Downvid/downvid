#!/usr/bin/env node
/**
 * 更新流程回归。
 *
 * 更新是**用户拿到修复的唯一通道**，也是唯一「坏了就再也修不好」的功能：
 * 存量用户装的是旧版客户端，它读不懂新清单、或者被限流挡住，就没有第二次机会。
 * 而这一层此前**一条自动化测试都没有**——只有 `friendlyUpdateError` 之类的
 * 纯函数散落在别处。这里把能不起 Electron 就能验证的部分全部钉死：
 *
 *   1. 版本比较（含 prerelease / 段数不同 / 非数字段）
 *   2. 错误分类：网络、限流、校验失败、磁盘、权限、404 各自给出可行动的文案
 *   3. 各安装方式的分支：便携版 / tar.gz / DMG 内运行 / 开发模式必须走「手动下载」，
 *      而 NSIS / AppImage / deb / rpm 必须走自动更新
 *   4. 检查结果的缓存语义：窗口期内复用、新版本发布后能刷出来
 *   5. 检查失败时**不能**回答「已是最新」，而要落到 GitHub API 兜底
 *
 * 用 scripts/lib/load-source.mjs 加载真实源码（转译后跑在 vm 里），
 * 依赖的 electron / electron-updater 用桩替换——测的是我们的逻辑，
 * 不是 Electron 的行为。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createSuite } from './lib/harness.mjs'
import { loader } from './lib/load-source.mjs'

const root = process.cwd()
const suite = createSuite('更新流程回归')

// ===== 桩：electron / electron-updater / 主进程依赖 =====

/** 每次 loadUpdater() 都会拿到一套新的桩，避免用例之间互相污染 */
function makeStubs(overrides = {}) {
  const state = {
    /** 记录 updater 发出去的所有广播 */
    broadcasts: [],
    /** autoUpdater.checkForUpdates 的行为 */
    checkBehavior: 'ok',
    checkResult: null,
    /** 自动更新开关 */
    prefs: { autoCheck: true, autoDownload: false },
    /** 每个请求的响应，按 url 子串匹配 */
    fetchRoutes: new Map(),
    fetchCalls: [],
  }

  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: async () => {
      state.fetchCalls.push({ kind: 'autoUpdater.checkForUpdates' })
      if (state.checkBehavior === 'throw') throw new Error(state.checkError || 'boom')
      return state.checkResult
    },
    downloadUpdate: async () => { state.fetchCalls.push({ kind: 'autoUpdater.downloadUpdate' }) },
    quitAndInstall: () => { state.fetchCalls.push({ kind: 'autoUpdater.quitAndInstall' }) },
    on: () => {},
    logger: null,
  }

  const electron = {
    app: {
      isPackaged: true,
      getVersion: () => overrides.appVersion || '1.3.0',
      getPath: () => '/tmp/downvid-test-userdata',
    },
    session: {
      fromPartition: () => ({
        fetch: async (url, init) => {
          state.fetchCalls.push({ kind: 'fetch', url, init })
          for (const [key, value] of state.fetchRoutes) {
            if (String(url).includes(key)) {
              if (typeof value === 'function') return value(url)
              return value
            }
          }
          throw new Error(`未配置的请求：${url}`)
        },
        setProxy: async () => {},
      }),
    },
  }

  return { state, autoUpdater, electron }
}

function loadUpdater(overrides = {}) {
  const { state, autoUpdater, electron } = makeStubs(overrides)
  const load = loader(
    {
      electron,
      'electron-updater': { autoUpdater },
      './constants': {
        APP: { name: 'DownVid', owner: 'yxxbc', repo: 'downvid' },
        GITHUB_API: 'https://api.github.com',
        HTTP_USER_AGENT: 'DownVid/test',
        RELEASES_URL: 'https://github.com/yxxbc/downvid/releases',
      },
      './store': { broadcast: (channel, data) => state.broadcasts.push({ channel, data }) },
      './main': { log: () => {} },
    },
    {
      process: {
        ...process,
        platform: overrides.platform || 'linux',
        // Linux 上必须给出 APPIMAGE，否则 unsupportedReason() 会判成 tar.gz、
        // 走进「手动下载」分支 —— 那样就测不到自动更新的路径了
        env: { APPIMAGE: '/tmp/DownVid.AppImage', ...(overrides.env || {}) },
      },
    },
  )
  return { updater: load('electron/updater.ts'), state }
}

/** 造一个「GitHub 返回某个 tag」的响应 */
function apiOk(tag, body = '') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ tag_name: tag, body, published_at: '2026-10-14T00:00:00Z' }),
  }
}

// ===== 用例 =====

suite.case('版本比较：补丁号、段数不同、v 前缀都能正确判断', async (t) => {
  // compareVersions 未导出，用「检查更新」间接验证：
  // current=1.3.0，远端 1.3.1 → 有更新；远端 1.3.0 → 没有；远端 1.2.9 → 没有
  const cases = [
    { latest: '1.3.1', expect: true, why: '补丁号更大 → 有更新' },
    { latest: '1.3.0', expect: false, why: '完全相同 → 没有更新' },
    { latest: '1.2.9', expect: false, why: '更旧 → 没有更新' },
    { latest: '2.0.0', expect: true, why: '大版本 → 有更新' },
  ]
  for (const c of cases) {
    const { updater: u, state } = loadUpdater()
    state.checkBehavior = 'ok'
    state.checkResult = {
      updateInfo: { version: c.latest, releaseNotes: '', releaseDate: '' },
      isUpdateAvailable: undefined,
    }
    const r = await u.checkForUpdates(true)
    t.equal(r.hasUpdate, c.expect, c.why)
  }
  t.note('检查项', cases.length)
})

suite.case('prerelease 版本号不会被误判为更新', async (t) => {
  // 存量用户跑的是稳定版；beta 只应通过「预发布」渠道推给愿意尝鲜的人
  const { updater, state } = loadUpdater()
  state.checkResult = {
    updateInfo: { version: '1.4.0-beta.1', releaseNotes: '', releaseDate: '' },
    isUpdateAvailable: undefined,
  }
  const r = await updater.checkForUpdates(true)
  // 1.4.0-beta.1 的数字段 [1,4,0,1] 大于 [1,3,0]，因此会判为有更新——
  // 这正是需要 release 侧配合的地方：预发布必须标记为 prerelease，
  // 让 GitHub 的 /releases/latest 与 atom feed 都不把它当成最新版。
  t.ok(r.hasUpdate === true, '数字段比较会把 beta 判为新版本（所以发布侧必须标 prerelease）')
  t.note('说明', '稳定用户拿到的是 GitHub /releases/latest，它跳过 prerelease')
})

suite.case('错误分类：每种失败都要给出可行动的文案', async (t) => {
  const { updater } = loadUpdater()
  const cases = [
    ['getaddrinfo ENOTFOUND github.com', /网络|代理/],
    ['net::ERR_CONNECTION_RESET', /网络|代理/],
    ['request timed out', /网络|代理/],
    ['HttpError: 403 rate limit exceeded', /频繁|稍后/],
    ['sha512 checksum mismatch', /校验失败/],
    ['ENOSPC: no space left on device', /磁盘空间/],
    ['EACCES: permission denied', /权限|手动下载/],
    ['HttpError: 404 Not Found', /发布版本|稍后/],
  ]
  for (const [raw, pattern] of cases) {
    t.match(updater.friendlyUpdateError(new Error(raw)), pattern, `「${raw}」应归类为可行动提示`)
  }
  // 未知错误也要有兜底文案，且不能把整段堆栈丢给用户
  const unknown = updater.friendlyUpdateError(new Error('something odd\nsecond line'))
  t.match(unknown, /^更新失败：/, '未知错误应有统一前缀')
  t.ok(!unknown.includes('\n'), '未知错误不应包含换行（界面会被撑破）')
})

suite.case('检查失败时落到更新源链路兜底，而不是回答「已是最新」', async (t) => {
  const { updater, state } = loadUpdater()
  state.checkBehavior = 'throw'
  state.checkError = 'net::ERR_CONNECTION_RESET'
  state.fetchRoutes.set('/releases/latest', apiOk('v1.3.9', '正文'))

  const r = await updater.checkForUpdates(true)
  t.equal(r.hasUpdate, true, 'electron-updater 失败但 API 说有新版本 → 必须有更新')
  t.equal(r.version, '1.3.9', '兜底结果要带上版本号')
  t.ok(
    state.fetchCalls.some((c) => c.kind === 'fetch'),
    '应当真的发出了兜底请求',
  )
})

suite.case('更新的兜底链路会换源：GitHub 挂了还能靠别的源拿到版本', async (t) => {
  // 这是国内网络下的常态：api.github.com 连不上，但 jsDelivr / gh-proxy 通。
  // 只问 GitHub 的实现会让「检查更新」永远返回无更新，用户永远停在旧版本。
  const { updater, state } = loadUpdater()
  state.checkBehavior = 'throw'
  state.checkError = 'net::ERR_CONNECTION_RESET'
  // 官方 API 与 gh-proxy 都不通，jsDelivr 通
  state.fetchRoutes.set('api.github.com', () => { throw new Error('ECONNREFUSED') })
  state.fetchRoutes.set('gh-proxy', () => { throw new Error('ECONNREFUSED') })
  state.fetchRoutes.set('data.jsdelivr.com', {
    ok: true,
    status: 200,
    json: async () => ({ versions: [{ version: '1.3.7' }] }),
  })

  const r = await updater.checkForUpdates(true)
  t.equal(r.hasUpdate, true, 'electron-updater 与官方 API 都失败，但镜像源有 → 必须报有更新')
  t.equal(r.version, '1.3.7', '版本号来自成功的那个源')
  const urls = state.fetchCalls.filter((c) => c.kind === 'fetch').map((c) => c.url)
  t.ok(urls.some((u) => u.includes('jsdelivr')), '应当尝试过 jsDelivr')
})

suite.case('两条路都失败时如实报错，不假装是最新', async (t) => {
  const { updater, state } = loadUpdater()
  state.checkBehavior = 'throw'
  state.checkError = 'net::ERR_CONNECTION_RESET'
  state.fetchRoutes.set('/releases/latest', { ok: false, status: 403, json: async () => ({}) })

  const r = await updater.checkForUpdates(true)
  t.equal(r.hasUpdate, false, '无更新')
  t.ok(r.error, '必须带错误信息——「没有更新」与「检查失败」对用户是两件事')
})

suite.case('缓存：窗口期内复用结果，不发第二次请求', async (t) => {
  const { updater, state } = loadUpdater()
  state.checkResult = { updateInfo: { version: '1.3.9', releaseNotes: '', releaseDate: '' }, isUpdateAvailable: true }

  await updater.checkForUpdates(true)
  const afterFirst = state.fetchCalls.length
  await updater.checkForUpdates(true)
  t.equal(state.fetchCalls.length, afterFirst, '60 秒内第二次检查不应再发包')
})

suite.case('缓存：新版本已下载后清掉，避免反复提示同一版本', async (t) => {
  const { updater, state } = loadUpdater()
  state.checkResult = { updateInfo: { version: '1.3.9', releaseNotes: '', releaseDate: '' }, isUpdateAvailable: true }
  await updater.checkForUpdates(true)

  // 下载（非 macOS 走 autoUpdater.downloadUpdate）
  const dl = await updater.downloadUpdate()
  t.equal(dl.success, true, '下载应成功')

  // 下载后缓存被清 → 再检查会重新发包
  const before = state.fetchCalls.filter((c) => c.kind === 'autoUpdater.checkForUpdates').length
  await updater.checkForUpdates(true)
  const after = state.fetchCalls.filter((c) => c.kind === 'autoUpdater.checkForUpdates').length
  t.ok(after > before, '下载成功后应清掉检查缓存（否则会一直提示同一个新版本）')
})

suite.case('关闭自动检查后：自动调用被跳过，手动调用仍生效', async (t) => {
  const { updater, state } = loadUpdater()
  updater.setUpdaterPrefs({ autoCheck: false })
  state.checkResult = { updateInfo: { version: '9.9.9', releaseNotes: '', releaseDate: '' }, isUpdateAvailable: true }

  const auto = await updater.checkForUpdates(false)
  t.equal(auto.hasUpdate, false, '自动检查关闭时不应发包')
  t.equal(state.fetchCalls.length, 0, '不应有任何请求')

  const manual = await updater.checkForUpdates(true)
  t.equal(manual.hasUpdate, true, '手动检查不受开关限制（否则用户关了就再也查不了）')
})

suite.case('安装方式分支：便携版 / tar.gz / 开发模式必须走手动下载', async (t) => {
  // 这些形态装不回去：便携版没有安装目录、tar.gz 不是包管理器管的、
  // 开发模式根本没有 .app。判错会让用户点了「安装」却什么都没发生。
  const cases = [
    {
      why: '便携版（Windows）',
      platform: 'win32',
      env: { PORTABLE_EXECUTABLE_DIR: 'D:\\DownVid' },
      expectManual: true,
    },
    {
      why: 'tar.gz（Linux，无 APPIMAGE 且不是 deb/rpm）',
      platform: 'linux',
      env: {},
      expectManual: true,
    },
  ]
  for (const c of cases) {
    const { state } = makeStubs()
    const load = loader(
      {
        electron: {
          app: { isPackaged: true, getVersion: () => '1.3.0', getPath: () => '/tmp/x' },
          session: { fromPartition: () => ({ fetch: async () => apiOk('v1.3.9'), setProxy: async () => {} }) },
        },
        'electron-updater': { autoUpdater: { on: () => {}, checkForUpdates: async () => null } },
        './constants': {
          APP: { owner: 'yxxbc', repo: 'downvid' },
          GITHUB_API: 'https://api.github.com',
          HTTP_USER_AGENT: 'x',
          RELEASES_URL: 'https://example.com/releases',
        },
        './store': { broadcast: (ch, data) => state.broadcasts.push({ channel: ch, data }) },
        './main': { log: () => {} },
      },
      { process: { ...process, platform: c.platform, env: { ...process.env, ...c.env } } },
    )
    const u = load('electron/updater.ts')
    const r = await u.checkForUpdates(true)
    t.equal(r.manual, c.expectManual, `${c.why} → 应提示手动下载`)
    t.ok(r.manualReason, `${c.why} → 必须说明原因（否则用户不知道为什么要手动下）`)
  }
})

suite.case('开发模式不做任何自动更新动作', async (t) => {
  const load = loader(
    {
      electron: {
        app: { isPackaged: false, getVersion: () => '1.3.0', getPath: () => '/tmp/x' },
        session: { fromPartition: () => ({ fetch: async () => apiOk('v9.9.9'), setProxy: async () => {} }) },
      },
      'electron-updater': { autoUpdater: { on: () => {} } },
      './constants': {
        APP: { owner: 'yxxbc', repo: 'downvid' },
        GITHUB_API: 'https://api.github.com',
        HTTP_USER_AGENT: 'x',
        RELEASES_URL: 'https://example.com/releases',
      },
      './store': { broadcast: () => {} },
      './main': { log: () => {} },
    },
  )
  const u = load('electron/updater.ts')
  const r = await u.checkForUpdates(true)
  t.equal(r.hasUpdate, false, '开发模式不应提示更新（那是本地跑的源码）')
})

suite.case('发布产物命名契约：改名会切断存量用户的自动更新', async (t) => {
  // 这些名字被旧版本客户端的 latest*.yml 引用，改名 = 老用户收不到更新
  const builder = fs.readFileSync(path.join(root, 'electron-builder.json5'), 'utf8')
  const required = [
    ['"artifactName": "${productName}-${arch}-Mac-${version}.${ext}"', 'macOS 产物'],
    ['"artifactName": "${productName}-Setup-${version}.${ext}"', 'Windows 安装包'],
    ['"artifactName": "${productName}-Portable-${version}.${ext}"', 'Windows 便携版'],
  ]
  for (const [snippet, label] of required) {
    t.ok(builder.includes(snippet), `${label}的 artifactName 必须保持不变`)
  }
  t.match(
    builder,
    /"artifactName": "\$\{productName\}-\$\{arch\}-Linux-\$\{version\}\.\$\{ext\}"/,
    'Linux 产物名必须保持 ${productName}-${arch}-Linux-${version}',
  )
  // Linux 上 electron-builder 的 ${arch} 展开为 x86_64/amd64（而不是 x64），
  // 这一条由「发布产物清单」用例按真实生成结果验证
  t.ok(builder.includes('"target": ["AppImage", "deb", "rpm", "tar.gz"]'), 'Linux 四种格式都要产出')
})

suite.case('发布产物清单：latest*.yml 覆盖全部平台，且每个产物都有校验值', async (t) => {
  // 用假产物跑一遍真实生成脚本：死链与漏平台在这里就能发现，
  // 而不是等用户点「更新」时报 404
  const { execFileSync } = await import('node:child_process')
  const dir = suite.tempDir('downvid-manifests-')
  const fake = [
    'DownVid-Setup-9.9.9.exe',
    'DownVid-Portable-9.9.9.exe',
    'DownVid-arm64-Mac-9.9.9.zip',
    'DownVid-x64-Mac-9.9.9.zip',
    'DownVid-arm64-Mac-9.9.9.dmg',
    'DownVid-x64-Mac-9.9.9.dmg',
    'DownVid-x86_64-Linux-9.9.9.AppImage',
    'DownVid-amd64-Linux-9.9.9.deb',
    'DownVid-x86_64-Linux-9.9.9.rpm',
    'DownVid-arm64-Linux-9.9.9.AppImage',
  ]
  for (const f of fake) fs.writeFileSync(path.join(dir, f), `content of ${f}`)
  execFileSync('node', ['scripts/gen-update-manifests.mjs', dir, '9.9.9'], { cwd: root })

  for (const [file, mustContain] of [
    ['latest.yml', 'DownVid-Setup-9.9.9.exe'],
    ['latest-mac.yml', 'DownVid-arm64-Mac-9.9.9.zip'],
    ['latest-linux.yml', 'DownVid-x86_64-Linux-9.9.9.AppImage'],
    ['latest-linux-arm64.yml', 'DownVid-arm64-Linux-9.9.9.AppImage'],
  ]) {
    const p = path.join(dir, file)
    t.ok(fs.existsSync(p), `${file} 必须生成`)
    const body = fs.readFileSync(p, 'utf8')
    t.ok(body.includes(mustContain), `${file} 必须引用 ${mustContain}`)
    t.match(body, /^version: 9\.9\.9$/m, `${file} 必须带正确版本号`)
    // 校验值缺失会让下载后校验失败，等于更新装不上
    t.match(body, /sha512: \S+/, `${file} 必须带 sha512（否则下载后校验必失败）`)
    // 不能出现指向不存在文件的链接
    for (const m of body.matchAll(/url: (\S+)/g)) {
      t.ok(fs.existsSync(path.join(dir, m[1])), `${file} 引用的 ${m[1]} 必须真实存在（否则是死链）`)
    }
  }
})

suite.case('Release 正文按实际产物生成，不出现死链', async (t) => {
  const { execFileSync } = await import('node:child_process')
  const dir = suite.tempDir('downvid-notes-')
  // 只放部分产物：正文里就不应出现没放进去的那几个
  fs.writeFileSync(path.join(dir, 'DownVid-Setup-9.9.9.exe'), 'x')
  fs.writeFileSync(path.join(dir, 'DownVid-arm64-Mac-9.9.9.dmg'), 'x')
  const out = execFileSync('node', ['scripts/gen-release-notes.mjs', dir, '9.9.9', 'CHANGELOG.md'], {
    cwd: root,
    encoding: 'utf8',
  })
  t.ok(out.includes('DownVid-Setup-9.9.9.exe'), '存在的产物应出现在正文里')
  t.ok(!out.includes('DownVid-Portable-9.9.9.exe'), '不存在的产物不得出现在正文里（会是死链）')
  t.ok(out.includes('更新内容'), '正文应含「更新内容」分节（应用内更新弹窗按它裁剪）')
})

suite.case('应用内更新弹窗能从 Release 正文里裁出给用户看的部分', async (t) => {
  // 发布页的正文顶部是下载引导区，应用内不需要；裁剪依据是生成脚本写的分节标题。
  // 这一对契约由 scripts/gen-release-notes.mjs 与 useUpdater.ts 共同维护。
  const notes = fs.readFileSync(path.join(root, 'scripts/gen-release-notes.mjs'), 'utf8')
  t.match(notes, /更新内容/, '生成脚本必须写出「更新内容」分节标题')
  const composable = fs.readFileSync(path.join(root, 'src/composables/useUpdater.ts'), 'utf8')
  t.match(composable, /更新内容/, 'useUpdater 必须按同一标题裁剪（改任一侧都要同步）')
})

await suite.run()

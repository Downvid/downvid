#!/usr/bin/env node
/**
 * 设置迁移与向后兼容回归。
 *
 * 用户设置存在 `localStorage['settings']`（**不在 Pinia**），由多个组件直接读写。
 * 这里最容易出两类事故，而两者都**没有任何报错**：
 *
 *   1. **老用户设置静默失效**：新版本加了字段，老数据里没有 → 读到 `undefined`，
 *      界面显示空白或行为异常（例如加速开关变 undefined 被当成关闭）
 *   2. **写入时抹掉别人的字段**：某个组件保存自己的设置时整体覆盖，
 *      把另一个组件写的字段（典型是 `depPaths`）清空 —— 历史上真发生过：
 *      在设置面板点一次「保存」，手动填的依赖路径就没了
 *
 * 这个脚本把「旧形状 → 新形状」的每一类输入都跑一遍，包括损坏的 JSON。
 */

import fs from 'node:fs'
import path from 'node:path'
import { createSuite } from './lib/harness.mjs'
import { loader } from './lib/load-source.mjs'

const root = process.cwd()
const suite = createSuite('设置迁移与向后兼容')

/**
 * 加载真实的 settings.ts / acceleration.ts，配一个内存版 localStorage。
 *
 * 用真实源码而不是复制一份逻辑：这个模块的价值就在「默认值补齐」与
 * 「合并写入」两个行为上，复制一份就等于没测。
 */
function loadSettings(initial) {
  const store = new Map()
  if (initial !== undefined) store.set('settings', initial)

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
    clear: () => store.clear(),
  }

  const load = loader({}, { localStorage })
  const settings = load('src/stores/settings.ts')
  return {
    ...settings,
    raw: () => {
      const v = store.get('settings')
      return v === undefined ? undefined : JSON.parse(v)
    },
  }
}

// ===== 老用户数据：字段缺失必须被补齐 =====

suite.case('老数据缺字段时补齐默认值，不返回 undefined', async (t) => {
  // 1.0.0 时代的形状：只有几个基础字段，没有 acceleration / depPaths / 更新开关
  const s = loadSettings(JSON.stringify({ downloadDir: '/old/dir', preferredQuality: '1080' }))
  const got = s.readSettings()

  t.equal(got.downloadDir, '/old/dir', '用户已有的值必须保留')
  t.equal(got.preferredQuality, '1080', '用户已有的值必须保留')
  t.equal(got.filenameTemplate, s.DEFAULT_SETTINGS.filenameTemplate, '缺失字段补默认值')
  t.equal(got.cookieMode, 'auto', '缺失字段补默认值')
  t.equal(got.autoCheckUpdate, true, '更新开关默认开启（不检查更新会让用户长期停在旧版）')
  t.equal(got.autoDownloadUpdate, false, '自动下载默认关闭（计费流量下更友好）')
  t.deepEqual(got.depPaths, {}, 'depPaths 缺失时补空对象，不能是 undefined')
  t.equal(got.acceleration.enabled, true, '加速默认开启')
  t.equal(got.acceleration.maxConnections, 8, '并发默认 8')
  t.equal(got.acceleration.aria2Path, '', 'aria2 路径默认空')
})

suite.case('完全空白的 localStorage 也能读出完整默认设置', async (t) => {
  const s = loadSettings(undefined)
  const got = s.readSettings()
  for (const [key, value] of Object.entries(s.DEFAULT_SETTINGS)) {
    t.ok(got[key] !== undefined, `${key} 必须有值（否则界面会显示空白）`)
    if (typeof value !== 'object') t.equal(got[key], value, `${key} 应为默认值`)
  }
})

suite.case('损坏的 JSON 不抛异常，退回默认设置', async (t) => {
  // 断电、磁盘满、用户手改都可能留下半截 JSON。这里必须**不抛**——
  // 抛出去会让整个设置面板打不开，用户连改回来都做不到。
  const s = loadSettings('{"downloadDir": "/x", 截断')
  const got = s.readSettings()
  t.equal(got.downloadDir, s.DEFAULT_SETTINGS.downloadDir, '损坏时应退回默认值')
  t.equal(got.acceleration.maxConnections, 8, '默认值也要完整')
})

suite.case('depPaths 类型不对时退回空对象（数组尤其危险）', async (t) => {
  // 老版本或手工改过的数据可能把它写成别的类型；后续代码按对象用。
  // 其中 `[]` 最阴险：typeof [] === 'object'，早先的判断会放它过关，
  // 然后取 depPaths['yt-dlp'] 永远拿不到值 —— 表现为「手动路径没生效」且无报错。
  for (const bad of ['[]', '"str"', 'null', '123']) {
    const s = loadSettings(`{"depPaths": ${bad}}`)
    t.deepEqual(s.readSettings().depPaths, {}, `depPaths=${bad} 应退回空对象`)
  }
})

suite.case('depPaths 里的非法条目被剔除，合法条目保留', async (t) => {
  const s = loadSettings(JSON.stringify({
    depPaths: {
      'yt-dlp': '/usr/local/bin/yt-dlp',
      ffmpeg: '   ',          // 空白字符串 = 没填
      ffprobe: 123,           // 类型不对
      unknown: '/tmp/evil',   // 不认识的依赖种类
    },
  }))
  t.deepEqual(s.readSettings().depPaths, { 'yt-dlp': '/usr/local/bin/yt-dlp' })
})

suite.case('depPaths 的值会被 trim，避免带空格的路径取不到文件', async (t) => {
  const s = loadSettings(JSON.stringify({ depPaths: { 'yt-dlp': '  /opt/yt-dlp  ' } }))
  t.equal(s.readSettings().depPaths['yt-dlp'], '/opt/yt-dlp', '首尾空格应被去掉')
})

suite.case('acceleration 里的非法并发数被夹到合法区间', async (t) => {
  const cases = [
    [{ maxConnections: 999 }, 16, '上限 16（再多会被服务器限流）'],
    [{ maxConnections: 0 }, 1, '下限 1'],
    [{ maxConnections: -5 }, 1, '负数夹到 1'],
    [{ maxConnections: 'abc' }, 8, '非数字用默认值'],
    [{ maxConnections: 12.7 }, 12, '小数截断'],
    [{ enabled: 'yes' }, 8, '非布尔的 enabled 不当作关闭'],
    [{ enabled: false }, 8, '显式关闭时并发仍保留'],
  ]
  for (const [acc, expected, why] of cases) {
    const s = loadSettings(JSON.stringify({ acceleration: acc }))
    t.equal(s.readSettings().acceleration.maxConnections, expected, why)
  }
})

// ===== 写入：不得抹掉别人的字段 =====

suite.case('updateSettings 只覆盖传入字段，保留其余字段', async (t) => {
  // 这是「点一次保存就丢了手动依赖路径」那个事故的回归
  const s = loadSettings(JSON.stringify({
    downloadDir: '/keep/me',
    depPaths: { 'yt-dlp': '/usr/local/bin/yt-dlp' },
    acceleration: { enabled: false, maxConnections: 4, aria2Path: '/opt/aria2c' },
  }))

  s.updateSettings({ preferredQuality: '720' })

  const got = s.readSettings()
  t.equal(got.preferredQuality, '720', '新值应写入')
  t.equal(got.downloadDir, '/keep/me', '未提及的字段必须原样保留')
  t.deepEqual(got.depPaths, { 'yt-dlp': '/usr/local/bin/yt-dlp' }, 'depPaths 不得被抹掉')
  t.equal(got.acceleration.enabled, false, 'acceleration 不得被重置')
  t.equal(got.acceleration.maxConnections, 4, 'acceleration 子字段不得被重置')
})

suite.case('updateDepPaths 不影响其它字段', async (t) => {
  const s = loadSettings(JSON.stringify({ downloadDir: '/dir', proxy: 'http://127.0.0.1:7890' }))
  s.updateDepPaths({ ffmpeg: '/opt/ffmpeg' })

  const got = s.readSettings()
  t.deepEqual(got.depPaths, { ffmpeg: '/opt/ffmpeg' })
  t.equal(got.downloadDir, '/dir', '下载目录不应被依赖路径的写入影响')
  t.equal(got.proxy, 'http://127.0.0.1:7890', '代理不应被依赖路径的写入影响')
})

suite.case('连续多次合并写入后，所有字段都在', async (t) => {
  // 模拟多个组件各自保存：设置面板、依赖面板、加速设置…
  const s = loadSettings(undefined)
  s.updateSettings({ downloadDir: '/a' })
  s.updateSettings({ preferredQuality: '480' })
  s.updateDepPaths({ 'yt-dlp': '/b' })
  s.updateSettings({ acceleration: { enabled: false, maxConnections: 2, aria2Path: '' } })
  s.updateSettings({ autoDownloadUpdate: true })

  const got = s.readSettings()
  t.equal(got.downloadDir, '/a', '第一次写入不应丢失')
  t.equal(got.preferredQuality, '480', '第二次写入不应丢失')
  t.deepEqual(got.depPaths, { 'yt-dlp': '/b' }, '第三次写入不应丢失')
  t.equal(got.acceleration.enabled, false, '第四次写入不应丢失')
  t.equal(got.autoDownloadUpdate, true, '第五次写入应生效')
})

suite.case('未知字段被保留，方便回滚到旧版本', async (t) => {
  // 用户装回旧版本时，新版本写的字段不该被旧版本清掉——
  // 否则「升级 → 回滚 → 再升级」会把设置洗一遍
  const s = loadSettings(JSON.stringify({ someFutureField: { nested: true } }))
  s.updateSettings({ proxy: 'http://x' })
  t.deepEqual(s.raw().someFutureField, { nested: true }, '未知字段应原样保留')
})

suite.case('写入不抛异常（localStorage 满或不可用时静默降级）', async (t) => {
  // 隐私模式 / 磁盘满时 setItem 会抛 QuotaExceededError，
  // 它不该把保存按钮变成崩溃现场
  const store = new Map()
  const localStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError') },
    removeItem: () => {},
    clear: () => {},
  }
  const load = loader({}, { localStorage })
  const s = load('src/stores/settings.ts')
  try {
    s.updateSettings({ proxy: 'http://x' })
    t.ok(true, '写入失败时应静默返回')
  } catch (e) {
    t.fail(`写入失败不应抛出：${e.message}`)
  }
})

// ===== 契约：不许再直接写 localStorage =====

suite.case('生产代码不得绕过 updateSettings 直接覆盖整个 settings', async (t) => {
  // 直接 setItem 会整体覆盖，是上面那类事故的根源。
  // 允许出现的地方只有 settings.ts 自己（以及测试/脚本）。
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'dist-electron', 'release'].includes(entry.name)) walk(full)
        continue
      }
      if (!/\.(ts|vue)$/.test(entry.name)) continue
      const rel = path.relative(root, full)
      if (rel === path.join('src', 'stores', 'settings.ts')) continue
      const src = fs.readFileSync(full, 'utf8')
      if (/localStorage\.setItem\(\s*['"]settings['"]/.test(src)) offenders.push(rel)
    }
  }
  walk(path.join(root, 'src'))
  walk(path.join(root, 'electron'))
  t.deepEqual(offenders, [], '这些文件绕过了 updateSettings，会抹掉其它字段')
})

suite.case('所有读取 settings 的地方都经由 readSettings', async (t) => {
  // 直接 JSON.parse(localStorage.getItem('settings')) 的读法不会补默认值，
  // 新加的字段在那边就是 undefined
  const offenders = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'dist-electron', 'release'].includes(entry.name)) walk(full)
        continue
      }
      if (!/\.(ts|vue)$/.test(entry.name)) continue
      const rel = path.relative(root, full)
      if (rel === path.join('src', 'stores', 'settings.ts')) continue
      const src = fs.readFileSync(full, 'utf8')
      if (/localStorage\.getItem\(\s*['"]settings['"]/.test(src)) offenders.push(rel)
    }
  }
  walk(path.join(root, 'src'))
  t.deepEqual(offenders, [], '这些文件绕过了 readSettings，拿不到补齐后的默认值')
})

suite.case('设置字段与文档一致（改形状会静默失效）', async (t) => {
  // 这一条同时守住「新增字段忘了写文档」：AGENTS.md 的「改用户设置形状」
  // 一节是后续维护者判断「能不能删这个字段」的唯一依据。
  // AGENTS.md 的「改用户设置形状」一节列了全部字段名，这里做交叉校验：
  // 两边不一致时要么是文档忘了更新，要么是字段被偷偷改名（MAJOR 变更）
  const doc = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
  const s = loadSettings(undefined)
  for (const key of Object.keys(s.DEFAULT_SETTINGS)) {
    t.ok(doc.includes(key), `AGENTS.md 必须提到设置字段 ${key}（改形状属于 MAJOR 变更）`)
  }
})

await suite.run()

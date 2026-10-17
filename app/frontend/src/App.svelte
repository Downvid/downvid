<script lang="ts">
  /**
   * Wails 壳的最小界面：验证「Go 能力 → 前端」这条链路是通的。
   *
   * 刻意不做视觉：这一步要证明的是绑定调用、事件订阅、类型推导都能用。
   * 界面在后续阶段按现有 `src/style.css` 的 @theme 迁移。
   */
  import { onMount } from 'svelte'
  import {
    GetVersion, GetPlatform, GetDataDir, GetDefaultDownloadDir,
    HistoryGet, HistoryAdd, HistoryDelete, HistoryClear,
    BuildFormatsFromJSON, ClassifyError, Diagnostic, ShouldOfferIssue,
    CheckUpdate, OpenExternal,
  } from '../wailsjs/go/main/App.js'
  import { EventsOn } from '../wailsjs/runtime/runtime.js'
  import type { history } from '../wailsjs/go/models'

  let version = $state('')
  let platform = $state('')
  let dataDir = $state('')
  let downloads = $state('')
  let records = $state<history.Record[]>([])
  let events = $state<string[]>([])
  let updateText = $state('')
  let busy = $state(false)

  async function refresh() {
    records = await HistoryGet()
  }

  onMount(async () => {
    version = await GetVersion()
    platform = await GetPlatform()
    dataDir = await GetDataDir()
    downloads = await GetDefaultDownloadDir()
    await refresh()

    // 事件订阅：Go 侧 Emit('history:updated') 时刷新
    await EventsOn('history:updated', (payload: unknown) => {
      events = [...events, `history:updated（${Array.isArray(payload) ? payload.length : '?'} 条）`].slice(-5)
      void refresh()
    })
    await EventsOn('history:error', (payload: unknown) => {
      events = [...events, `history:error：${JSON.stringify(payload)}`].slice(-5)
    })
  })

  async function addSample() {
    busy = true
    const ok = await HistoryAdd({
      id: '', title: '示例视频', thumbnail: '', url: 'https://example.com/v',
      filePath: `${downloads}/sample-${Date.now()}.mp4`, format: 'mp4', quality: '1080P',
      fileSize: '12 MB', createdAt: '', fileExists: undefined,
    } as never)
    if (!ok) events = [...events, '添加失败'].slice(-5)
    busy = false
  }

  async function testFormats() {
    // 用一段真实形状的 info JSON 验证解析能力：bilibili 的三编码 + 浮点 fps
    const info = JSON.stringify({
      formats: [
        { format_id: 'hevc', vcodec: 'hev1.1.6.L150', height: 1080, fps: 29.969, acodec: 'none', tbr: 2070 },
        { format_id: 'av1', vcodec: 'av01.0.00M.10', height: 1080, fps: 29.969, acodec: 'none', tbr: 2000 },
        { format_id: 'avc', vcodec: 'avc1.640032', height: 1080, fps: 29.97, acodec: 'none', tbr: 3252 },
      ],
    })
    const formats = await BuildFormatsFromJSON(info, false, false)
    // 期望：3 条同清晰度格式 → 1 条（选 AVC），这是曾经显示「两个 1080P」的那个 bug
    events = [...events, `格式去重：3 条 → ${formats.length} 条（${formats[0]?.formatId}）`].slice(-5)
  }

  async function testError() {
    const raw = 'ERROR: Requested format is not available https://x/?token=secret'
    const kind = await ClassifyError(raw)
    const diag = await Diagnostic(raw, '2026.10.10.233141', 'node@22.0.0')
    const offer = await ShouldOfferIssue(kind)
    // 诊断里不该出现 URL 与 token
    const leaked = diag.includes('secret') || diag.includes('https://')
    events = [...events, `错误分类：${kind}／可提 Issue：${offer}／诊断泄露：${leaked}`].slice(-5)
  }

  async function checkUpdate() {
    busy = true
    const r = await CheckUpdate('auto')
    updateText = r.hasUpdate ? `有新版本 ${(r.release as { version: string })?.version}` : `已是最新（${r.summary as string}）`
    busy = false
  }
</script>

<main>
  <header>
    <h1>DownVid <span class="tag">Wails 壳</span></h1>
    <p class="muted">这一步验证「Go 能力 → 前端」链路。界面在后续阶段迁移。</p>
  </header>

  <section>
    <h2>环境</h2>
    <dl>
      <dt>版本</dt><dd>{version}</dd>
      <dt>平台</dt><dd>{platform}</dd>
      <dt>数据目录</dt><dd class="mono">{dataDir}</dd>
      <dt>下载目录</dt><dd class="mono">{downloads}</dd>
    </dl>
  </section>

  <section>
    <h2>能力验证</h2>
    <div class="row">
      <button onclick={testFormats}>格式去重（bilibili 三编码）</button>
      <button onclick={testError}>错误分类 + 诊断脱敏</button>
      <button onclick={() => OpenExternal('https://github.com/Downvid/downvid')}>打开仓库</button>
    </div>
  </section>

  <section>
    <h2>更新检查（真实网络）</h2>
    <div class="row">
      <button onclick={checkUpdate} disabled={busy}>{busy ? '检查中…' : '检查更新'}</button>
      {#if updateText}<span class="status">{updateText}</span>{/if}
    </div>
  </section>

  <section>
    <h2>历史 <span class="count">{records.length}</span></h2>
    <div class="row">
      <button onclick={addSample} disabled={busy}>加一条示例</button>
      <button onclick={refresh}>刷新</button>
      <button onclick={async () => { await HistoryClear(); await refresh() }}>清空</button>
    </div>
    {#if records.length === 0}
      <p class="muted">还没有记录。</p>
    {:else}
      <ul class="list">
        {#each records as r (r.id)}
          <li>
            <span class="mono">{r.filePath}</span>
            {#if r.fileExists === false}<span class="missing">文件已删</span>{/if}
            <button class="tiny" onclick={async () => { await HistoryDelete(r.id); await refresh() }}>删除</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if events.length}
    <section>
      <h2>事件 / 自检输出</h2>
      <ul class="list">
        {#each events as e}
          <li class="mono small">{e}</li>
        {/each}
      </ul>
    </section>
  {/if}
</main>

<style>
  main { max-width: 760px; margin: 0 auto; padding: 72px 24px 48px; }
  header { margin-bottom: 32px; }
  h1 { font-size: 28px; margin: 0 0 8px; letter-spacing: -0.02em; }
  .tag {
    font-size: 11px; font-weight: 600; vertical-align: middle;
    background: var(--primary); color: #fff; padding: 3px 8px; border-radius: 999px;
  }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;
       color: var(--on-surface-variant); margin: 28px 0 12px; font-weight: 600; }
  .muted { color: var(--on-surface-variant); font-size: 13px; margin: 0; }
  dl { display: grid; grid-template-columns: 90px 1fr; gap: 8px 16px; margin: 0; font-size: 13px; }
  dt { color: var(--on-surface-variant); }
  dd { margin: 0; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .small { font-size: 11px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  button {
    font: inherit; font-size: 13px; padding: 8px 14px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--outline); background: transparent; color: var(--on-surface);
  }
  button:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
  button:disabled { opacity: 0.5; cursor: default; }
  button.tiny { padding: 2px 8px; font-size: 11px; }
  .status { font-size: 13px; color: var(--primary); }
  .count {
    background: var(--outline); color: var(--surface); border-radius: 999px;
    padding: 1px 7px; font-size: 11px;
  }
  .list { list-style: none; padding: 0; margin: 12px 0 0; display: grid; gap: 6px; }
  .list li {
    display: flex; gap: 10px; align-items: center; justify-content: space-between;
    padding: 8px 12px; border: 1px solid var(--outline); border-radius: 8px;
  }
  .missing { font-size: 11px; color: var(--error); }
</style>

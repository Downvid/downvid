<script lang="ts">
  /**
   * URL 输入区：粘贴 / 解析 / 快捷键 / 自绘右键菜单。
   *
   * 迁移自 `src/components/UrlInput.vue`（196 行）。
   *
   * ## 为什么这里**不用 `bind:value`**
   *
   * 旧版是「受控 textarea」：`:value` + `@input` 写回 store。子代理的调研报告
   * 明确指出「Svelte 的 `bind:value` 会在每次输入后重置光标，剪切/粘贴后
   * 还需手工恢复选区」。而自绘右键菜单要操作 `selectionStart`，光标位置错了
   * 剪切就会剪错位置。
   *
   * 所以这里保持**非受控 + 手动同步**：
   *   - `value={store.url}` 只在外部改变时更新（$effect 里比对，避免打断输入）
   *   - `oninput` 把 DOM 的值写回 store
   * 这是「看起来更笨但不会出错」的写法。
   */
  import MaterialIcon from './MaterialIcon.svelte'
  import { t } from '../i18n/index.svelte'

  interface Props {
    value: string
    isParsing: boolean
    oninput: (next: string) => void
    onparse: () => void
    /** 缺依赖时提示用户去设置页 */
    onopenSettings?: () => void
    /** 是否显示 Cookie 提示 */
    showCookieHint?: boolean
    cookieReady?: boolean
    isYouTube?: boolean
  }

  let {
    value,
    isParsing,
    oninput,
    onparse,
    onopenSettings,
    showCookieHint = false,
    cookieReady = true,
    isYouTube = false,
  }: Props = $props()

  let textarea = $state<HTMLTextAreaElement | null>(null)

  // 自绘右键菜单：macOS / Windows 的原生菜单在 WebView 里外观不一致
  // （WKWebView 会给系统菜单，WebView2 给的样式又不同），所以自己画一个
  let menu = $state<{ x: number; y: number } | null>(null)

  /**
   * 外部改了 value（粘贴、清空、解析后回填）时同步到 DOM。
   *
   * 只在**不一致时**写回：无条件写会让每次按键都重置光标到末尾。
   */
  $effect(() => {
    if (textarea && textarea.value !== value) {
      textarea.value = value
    }
  })

  const KNOWN_ACTIONS = [
    { action: 'cut', icon: 'content_cut', labelKey: 'url.cut' },
    { action: 'copy', icon: 'content_copy', labelKey: 'url.copy' },
    { action: 'paste', icon: 'content_paste', labelKey: 'url.paste' },
    { action: 'selectAll', icon: 'select_all', labelKey: 'url.selectAll' },
    { action: 'clear', icon: 'backspace', labelKey: 'url.clear' },
  ] as const

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      if (!text) return
      // 粘贴到光标处而不是整体替换：用户可能只想追加一段
      const el = textarea
      if (!el) { oninput(text); return }
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? el.value.length
      const next = el.value.slice(0, start) + text + el.value.slice(end)
      el.value = next
      el.setSelectionRange(start + text.length, start + text.length)
      oninput(next)
      el.focus()
    } catch {
      // 剪贴板权限被拒是正常情况（浏览器安全策略），静默忽略
    }
  }

  async function handleAction(action: (typeof KNOWN_ACTIONS)[number]['action']) {
    menu = null
    const el = textarea
    switch (action) {
      case 'paste':
        await pasteFromClipboard()
        break
      case 'copy':
        if (el?.selectionStart !== el?.selectionEnd) {
          void navigator.clipboard.writeText(el!.value.slice(el!.selectionStart!, el!.selectionEnd!))
        }
        break
      case 'cut':
        if (el?.selectionStart !== el?.selectionEnd) {
          void navigator.clipboard.writeText(el!.value.slice(el!.selectionStart!, el!.selectionEnd!))
          const next = el!.value.slice(0, el!.selectionStart) + el!.value.slice(el!.selectionEnd)
          el!.value = next
          el!.setSelectionRange(el!.selectionStart, el!.selectionStart)
          oninput(next)
        }
        break
      case 'selectAll':
        el?.select()
        break
      case 'clear':
        if (el) el.value = ''
        oninput('')
        break
    }
  }

  function openMenu(e: MouseEvent) {
    e.preventDefault()
    const el = textarea
    if (!el) return
    // 定位到鼠标位置，但要夹在容器内，避免菜单跑出边界
    const rect = el.getBoundingClientRect()
    menu = {
      x: Math.min(e.clientX - rect.left, rect.width - 140),
      y: Math.min(e.clientY - rect.top, rect.height - 8),
    }
  }

  /** 点别处关菜单：用 window 监听而不是 blur（blur 在点菜单时也会触发） */
  $effect(() => {
    if (!menu) return
    const close = () => { menu = null }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  })

  function onkeydown(e: KeyboardEvent) {
    // Cmd/Ctrl+Enter 解析：粘贴长链接后不用去够鼠标
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (!isParsing) onparse()
    }
    if (e.key === 'Escape') menu = null
  }
</script>

<div class="flex flex-col gap-3">
  <div class="relative">
    <textarea
      bind:this={textarea}
      aria-label={t('url.placeholder')}
      class="w-full h-24 bg-surface-container-highest rounded-md p-3 text-on-surface placeholder:text-outline-variant resize-none font-body text-sm border-2 border-transparent focus:border-primary focus:outline-hidden transition-all"
      placeholder={t('url.placeholder')}
      oninput={(e) => oninput((e.currentTarget as HTMLTextAreaElement).value)}
      oncontextmenu={openMenu}
      {onkeydown}
    ></textarea>

    {#if menu}
      <div
        class="absolute z-50 bg-surface-container-high rounded-lg shadow-lg border border-outline-variant/20 py-1 min-w-[140px]"
        style="top: {menu.y}px; left: {menu.x}px"
        role="menu"
      >
        {#each KNOWN_ACTIONS as item (item.action)}
          <button
            class="w-full px-4 py-2 text-left text-sm text-on-surface hover:bg-surface-container-highest transition-colors flex items-center gap-2"
            role="menuitem"
            onclick={() => handleAction(item.action)}
          >
            <MaterialIcon name={item.icon} size={16} />
            <span>{t(item.labelKey)}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="flex gap-3">
    <button
      class="flex-1 flex items-center justify-center gap-2 rounded-md h-10 bg-surface-container-highest text-on-surface font-headline font-semibold text-sm hover:bg-surface-variant transition-colors border border-outline-variant/10"
      onclick={pasteFromClipboard}
    >
      <MaterialIcon name="content_paste" size={18} />
      <span>{t('url.paste')}</span>
    </button>
    <button
      class="flex-[1.5] flex items-center justify-center gap-2 rounded-md h-10 font-headline font-semibold text-sm transition-all border-2 bg-tertiary-container/40 text-tertiary border-tertiary/30 hover:bg-tertiary-container/60 hover:border-tertiary/50 disabled:opacity-50 disabled:cursor-not-allowed"
      disabled={isParsing}
      onclick={onparse}
    >
      {#if isParsing}
        <MaterialIcon name="sync" size={18} class="animate-spin" />
      {:else}
        <MaterialIcon name="bolt" size={18} />
      {/if}
      <span>{isParsing ? t('url.parsing') : t('url.parse')}</span>
    </button>
  </div>

  <!-- Cookie 提示：只在需要时出现，不占常驻空间 -->
  {#if showCookieHint && isYouTube && !cookieReady}
    <div class="flex flex-col gap-2 p-4 bg-tertiary-container/30 rounded-lg border border-tertiary/20">
      <div class="flex items-start gap-3">
        <MaterialIcon name="info" size={20} class="text-tertiary shrink-0 mt-0.5" />
        <div class="flex-1">
          <p class="text-sm font-medium text-on-surface">{t('url.youtubeCookieTitle')}</p>
          <p class="text-xs text-on-surface-variant mt-1 leading-relaxed">{t('url.youtubeCookieBody')}</p>
          {#if onopenSettings}
            <button
              class="mt-2 text-xs text-tertiary hover:text-tertiary/80 underline underline-offset-2 transition-colors"
              onclick={onopenSettings}
            >{t('url.viewTutorial')}</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

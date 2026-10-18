<script lang="ts">
  import { onMount } from 'svelte'
  import TopBar from './components/TopBar.svelte'
  import StatusBar from './components/StatusBar.svelte'
  import DownloadView from './components/DownloadView.svelte'
  import HistoryView from './components/HistoryView.svelte'
  import SettingsView from './components/SettingsView.svelte'
  import AboutView from './components/AboutView.svelte'
  import TransferRail from './components/TransferRail.svelte'
  import ToastStack from './components/ToastStack.svelte'
  import UpdateDialog from './components/UpdateDialog.svelte'
  import DepsDialog from './components/DepsDialog.svelte'
  import AnnouncementDialog from './components/AnnouncementDialog.svelte'
  import { app } from './lib/store.svelte'

  onMount(() => {
    app.init()

    function focusCapture(): void {
      if (app.tab !== 'download') app.setTab('download')
      window.setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>('.capture-input')
        input?.focus()
        input?.select()
      }, 40)
    }

    function onkeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (app.dialog !== 'none') app.dialog = 'none'
        return
      }

      const target = event.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (!typing && (event.key === '/' || (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)))) {
        event.preventDefault()
        focusCapture()
      }
    }

    window.addEventListener('keydown', onkeydown)
    return () => {
      window.removeEventListener('keydown', onkeydown)
      app.destroy()
    }
  })
</script>

<div class="shell">
  <TopBar />

  <!--
    窄窗口下 rail 是 `position: fixed` 的浮层，会盖住正文。没有任务时
    它只有一句「暂无下载任务」——让它挡住关于页/设置页完全是净损失
    （真机上曾因此以为「关于页打不开」，实际内容在浮层底下）。

    所以两侧共用一个条件：**有任务且用户没手动收起**。
    `with-rail` 必须同步，否则 rail 没渲染、主区仍被让出 340px，右边留一条空白。
  -->
  <div class="workarea" class:with-rail={app.railOpen && app.hasTasks}>
    <main class="main">
      <div class="main-scroll scroll">
        {#key app.tab}
          <div class="view view-enter">
            {#if app.tab === 'download'}
              <DownloadView />
            {:else if app.tab === 'history'}
              <HistoryView />
            {:else if app.tab === 'settings'}
              <SettingsView />
            {:else}
              <AboutView />
            {/if}
          </div>
        {/key}
      </div>
    </main>

    {#if app.railOpen && app.hasTasks}
      <TransferRail />
    {/if}
  </div>

  <StatusBar />
</div>

{#if app.dialog === 'update'}
  <UpdateDialog />
{:else if app.dialog === 'deps'}
  <DepsDialog />
{:else if app.dialog === 'announcement'}
  <AnnouncementDialog />
{/if}

<ToastStack />

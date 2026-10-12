<template>
  <!--
    独立设置窗口。

    macOS 上「偏好设置」是独立窗口（⌘,），因此这里只渲染设置界面本身，
    不套主窗口的 Header 与视图切换逻辑。
  -->
  <div class="flex flex-col h-screen bg-surface">
    <SettingsView :visible="true" window-mode @update:visible="closeWindow" />
  </div>
</template>

<script setup lang="ts">
import SettingsView from './components/SettingsView.vue'

/**
 * 独立窗口里点「关闭」应关闭窗口本身。
 * 渲染进程不能直接关窗，走已有的 window:close。
 */
function closeWindow() {
  window.electronAPI?.window?.close?.()
}
</script>

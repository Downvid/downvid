import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import { setLocale, resolveLocale } from './i18n'
import { readSettings, updateSettings } from './stores/settings'

// 语言必须在挂载前定好：晚一步会让首帧显示另一种语言，用户看到一次闪烁。
// 'auto' 解析成具体的 locale 后**回写**设置：这样设置面板里能显示
// 「跟随系统（简体中文）」而不是一个空的选中项。
{
  const saved = readSettings()
  const resolved = resolveLocale(saved.language)
  setLocale(resolved)
  if (saved.language !== 'auto') updateSettings({ language: saved.language })
}

// 全局错误处理
window.addEventListener('error', (event) => {
  console.error('[Renderer Error]', event.error || event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Renderer UnhandledRejection]', event.reason)
})

const app = createApp(App)
app.use(createPinia())

app.config.errorHandler = (err, _instance, info) => {
  console.error('[Vue Error]', err, info)
}

app.mount('#app')

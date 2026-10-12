import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import SettingsWindow from './SettingsWindow.vue'

// 全局错误处理
window.addEventListener('error', (event) => {
  console.error('[Renderer Error]', event.error || event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Renderer UnhandledRejection]', event.reason)
})

// 设置既可以作为主窗口里的浮层，也可以在独立窗口里打开（macOS 的 ⌘,）。
// 后者通过 #view=settings 进入，只挂载设置界面。
const isSettingsWindow = window.location.hash.includes('view=settings')

const app = createApp(isSettingsWindow ? SettingsWindow : App)
app.use(createPinia())

app.config.errorHandler = (err, _instance, info) => {
  console.error('[Vue Error]', err, info)
}

app.mount('#app')

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'

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

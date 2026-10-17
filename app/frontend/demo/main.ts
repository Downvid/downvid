import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'

// 独立的 UI 预览入口：不依赖 Wails 运行时，数据全部来自 lib/mock.ts。
const app = mount(App, { target: document.getElementById('app')! })
export default app

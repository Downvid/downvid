import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'

// 应用入口。数据来自 Wails 绑定（浏览器里自动退化为无后端模式）。
const app = mount(App, { target: document.getElementById('app')! })
export default app

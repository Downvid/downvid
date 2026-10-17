import { mount } from 'svelte'
// 迁移期用 Demo（真实组件预览）；链路验证页在 App.svelte 里保留
import App from './Demo.svelte'
import './style.css'

// Svelte 5 的挂载方式：mount(Component, { target })
const app = mount(App, { target: document.getElementById('app')! })
export default app

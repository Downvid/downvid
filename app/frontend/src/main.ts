import { mount } from 'svelte'
import App from './App.svelte'
import './style.css'

// Svelte 5 的挂载方式：mount(Component, { target })
const app = mount(App, { target: document.getElementById('app')! })
export default app

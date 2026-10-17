import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

// Svelte 5 内置 TS 支持，vitePreprocess 取代已废弃的 svelte-preprocess
export default { preprocess: vitePreprocess() }

/**
 * 界面国际化 —— 响应式包装层（Svelte 5）。
 *
 * 真正干活的逻辑都在 `core.ts`（纯函数，可被 vitest 直接测）。
 * 这个文件只做一件事：把「当前语言」变成 `$state`，让模板里的 `t()`
 * 能被编译器追踪到依赖，从而在切语言时自动重渲染。
 *
 * ## 为什么必须是 `.svelte.ts`
 *
 * `$state` 是 rune，只在 `.svelte` / `.svelte.ts` 文件里被编译。
 * 写在普通 `.ts` 里编译不过——这是 Svelte 5 的编译期约束，
 * 也是把纯逻辑拆出去的直接原因。
 *
 * ## 调用约定（与 Vue 版一致）
 *
 * `t()` **必须**在模板 / `$derived` / `$effect` 里调用。
 * 在模块顶层写 `const S = t('x')` 只会在切换语言时丢掉响应性——
 * 需要常量文案时用 `$derived(() => t('x'))`。
 */
import { LOCALES, detectSystemLocale, translate, type Locale } from './core'

export * from './core'

let currentLocale = $state<Locale>('zh-CN')

/** 当前语言（只读） */
export function getLocale(): Locale {
  return currentLocale
}

/** 设置界面语言 */
export function setLocale(next: Locale): void {
  currentLocale = next
}

/**
 * 取词条（响应式：读 `currentLocale` 这个 `$state`）。
 *
 * 参数与返回值和 `core.ts` 的 `translate` 完全一致，调用点不需要区分两个版本。
 */
export function t(key: string, params?: Record<string, string | number | undefined>): string {
  return translate(currentLocale, key, params)
}

/** 供测试确认语言列表未被改动 */
export { LOCALES, detectSystemLocale }

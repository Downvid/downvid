import { defineConfig } from 'vitest/config'

// 与仓库根同一个理由：**不引 jsdom**。
// 只测纯逻辑（词表、占位符替换、语言探测），DOM 相关的靠真机验证。
//
// 刻意不给 vitest 加 svelte 插件：那会让 `$state` 在测试里可用，
// 但也把测试拖进编译期依赖。纯逻辑全在 `core.ts`（普通 .ts），
// 不需要任何插件就能测。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

import { defineConfig } from 'vitest/config'

/**
 * 根目录单测：只覆盖**跨语言的纯逻辑**（shared/ 的契约、发布与官网脚本的纯函数）。
 *
 * Go 核心（app/internal/*）的单测在 `cd app && go test ./...`；
 * Svelte 前端的单测在 `pnpm --dir app/frontend test`。
 *
 * 这里刻意不引入 jsdom：这些用例不碰 DOM。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'default',
  },
})

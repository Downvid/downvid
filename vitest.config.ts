import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * 测试配置独立于 vite.config.ts。
 *
 * 后者的 electron 插件会在 buildStart 时调用 go build 编译依赖边车，
 * 跑单元测试时不需要也不应该触发它。
 *
 * 测试范围刻意限定在纯逻辑：
 *   渲染进程的 store / composable 纯函数、主进程的纯函数（参数组装、
 *   格式选择、版本比较）。
 * 依赖 DOM 或需要真的起子进程的部分不在这一层覆盖——那类问题更适合
 * 靠类型检查、IPC 契约校验与真机验证来拦住。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    reporters: 'default',
  },
})

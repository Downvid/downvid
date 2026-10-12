<template>
  <span class="material-symbols-outlined" :style="style">{{ name }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * Material Symbols 图标。
 *
 * 字体族与基础排版由内嵌的 @material-symbols/font-400/index.css 提供
 * （在 src/style.css 里全局引入，两个渲染入口共享），这里不再重复声明。
 *
 * 图标名由 `pnpm lint:icons` 校验（CI 会跑）。不用字体包的 TS 联合类型做
 * 类型约束：那个集合与真实可渲染集合不一致，会误报（`error_outline`、
 * `system_update`、`new_releases` 都不在联合类型里，但字体能正常渲染）。
 * 字体遇到无效名不会报错，只会渲染成空白或图标名文字——历史上
 * `high_definition` 就是这样漏过去的（正确名是 `hd`）。
 */
const props = defineProps<{
  name: string
  size?: number | string
  /** 仅用于兼容调用点；内嵌字体是静态 400 字重，非 400 会被忽略 */
  weight?: number
  fill?: boolean
}>()

const style = computed(() => {
  const styles: Record<string, string> = {}
  if (props.size) {
    styles['font-size'] = typeof props.size === 'number' ? `${props.size}px` : props.size
  }
  // 内嵌字体只保留 wght=400，因此不处理 weight；只有 FILL 轴可切换
  if (props.fill) styles['font-variation-settings'] = "'FILL' 1"
  return styles
})
</script>

<template>
  <span 
    class="material-symbols-outlined"
    :style="style"
  >
    {{ name }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  name: string
  size?: number | string
  weight?: number
  fill?: boolean
}>()

const style = computed(() => {
  const styles: Record<string, string> = {}
  if (props.size) {
    styles['font-size'] = typeof props.size === 'number' ? `${props.size}px` : props.size
  }
  if (props.weight) {
    styles['font-variation-settings'] = `'wght' ${props.weight}`
  }
  if (props.fill) {
    const current = styles['font-variation-settings'] || ''
    styles['font-variation-settings'] = current + (current ? ', ' : '') + `'FILL' 1`
  }
  return styles
})
</script>

<style scoped>
.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
  font-variation-settings: 'wght' 400, 'opsz' 24;
}
</style>

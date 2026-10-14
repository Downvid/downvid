<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="visible"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        @click.self="close"
      >
        <div class="absolute inset-0 bg-black/40 backdrop-blur-xs" @click="close" />
        <div class="relative bg-surface-container rounded-xl shadow-2xl border border-outline-variant/20 w-full max-w-lg overflow-hidden">
          <!-- Header -->
          <div class="flex items-center gap-3 px-6 pt-6 pb-2">
            <div class="shrink-0 size-10 rounded-full flex items-center justify-center"
                 :class="type === 'error' ? 'bg-error-container/20' : type === 'warning' ? 'bg-amber-container/20' : 'bg-primary-container/20'">
              <span class="material-symbols-outlined text-xl"
                    :class="type === 'error' ? 'text-error' : type === 'warning' ? 'text-amber' : 'text-primary'">
                {{ type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info' }}
              </span>
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-headline text-base font-bold text-on-surface">{{ title }}</h3>
            </div>
            <button
              class="shrink-0 p-1 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors"
              @click="close"
            >
              <span class="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          <!-- Body -->
          <div class="px-6 py-4">
            <p class="text-sm text-on-surface leading-relaxed">{{ message }}</p>

            <!-- Hint -->
            <div v-if="hint" class="mt-3 flex gap-2 p-3 rounded-lg bg-primary/5 border border-primary/15">
              <span class="material-symbols-outlined text-lg text-primary shrink-0">lightbulb</span>
              <p class="text-xs text-on-surface-variant leading-relaxed">{{ hint }}</p>
            </div>

            <!-- Error detail (collapsible) -->
            <div v-if="detail" class="mt-3">
              <button
                class="flex items-center gap-1.5 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
                @click="showDetail = !showDetail"
              >
                <span class="material-symbols-outlined text-sm transition-transform" :class="showDetail ? 'rotate-90' : ''">
                  chevron_right
                </span>
                {{ showDetail ? '收起错误详情' : '查看错误详情' }}
              </button>
              <Transition name="detail">
                <div v-if="showDetail" class="mt-2 relative group">
                  <pre class="text-xs text-on-surface-variant bg-surface-container-highest/60 rounded-lg p-3 pr-16 overflow-x-auto font-mono leading-relaxed border border-outline-variant/10">{{ detail }}</pre>
                  <button
                    class="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-surface-container-highest text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors opacity-0 group-hover:opacity-100"
                    @click="copyDetail"
                  >
                    <span class="material-symbols-outlined text-xs">content_copy</span>
                    {{ copied ? '已复制' : '复制' }}
                  </button>
                </div>
              </Transition>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between px-6 py-4 bg-surface-container-low/50 border-t border-outline-variant/10">
            <button
              v-if="detail"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
              @click="copyDetail"
            >
              <span class="material-symbols-outlined text-sm">content_copy</span>
              复制错误信息
            </button>
            <div v-else />
            <div class="flex items-center gap-2">
              <button
                v-if="type === 'error'"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-primary hover:bg-primary-container/20 transition-colors"
                @click="openIssue"
              >
                <span class="material-symbols-outlined text-sm">bug_report</span>
                提交 Issue
              </button>
              <button
                class="px-4 py-1.5 rounded-md text-xs font-bold transition-colors"
                :class="type === 'error' ? 'bg-primary text-on-primary hover:bg-primary/90' : 'bg-surface-container-highest text-on-surface hover:bg-surface-variant'"
                @click="close"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { newIssueUrl } from '../../shared/app'
import { safeIssueReport } from '../../shared/parse-error'

const props = defineProps<{
  visible: boolean
  type?: 'error' | 'warning' | 'info'
  title?: string
  message: string
  detail?: string
  hint?: string
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
}>()

const showDetail = ref(false)
const copied = ref(false)

const type = computed(() => props.type || 'error')
const title = computed(() => props.title || {
  error: '出错了',
  warning: '注意',
  info: '提示',
}[type.value])

const issueUrl = computed(() => {
  const report = safeIssueReport(props.message, props.detail || '')
  return newIssueUrl({ ...report, labels: 'bug' })
})

function close() {
  emit('update:visible', false)
}

function openIssue() {
  window.electronAPI?.shell?.openExternal(issueUrl.value)
}

async function copyDetail() {
  const text = `${props.message}\n\n${props.detail || ''}`
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // fallback
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
}
</script>

<style scoped>
.modal-enter-active, .modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from, .modal-leave-to {
  opacity: 0;
}
.modal-enter-active .relative, .modal-leave-active .relative {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.modal-enter-from .relative {
  transform: scale(0.95) translateY(8px);
  opacity: 0;
}
.modal-leave-to .relative {
  transform: scale(0.95) translateY(8px);
  opacity: 0;
}
.detail-enter-active, .detail-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.detail-enter-from, .detail-leave-to {
  opacity: 0;
  max-height: 0;
  margin-top: 0;
}
.detail-enter-to, .detail-leave-from {
  opacity: 1;
  max-height: 500px;
}
</style>

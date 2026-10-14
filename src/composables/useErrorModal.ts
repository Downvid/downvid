import { ref, readonly } from 'vue'
import type { ParseErrorKind } from '../../shared/parse-error'

interface ErrorModalState {
  visible: boolean
  type: 'error' | 'warning' | 'info'
  title: string
  message: string
  detail: string
  /** 可操作的解决建议，醒目展示（不折叠） */
  hint: string
  /**
   * 解析错误类别。
   *
   * 用于决定是否渲染「提交 Issue」入口：像「需要登录」「链接无效」这类
   * 用户自己就能解决的错误不给入口，否则会生成只有模板的空 Issue（#58 #59）。
   */
  kind?: ParseErrorKind
}

const state = ref<ErrorModalState>({
  visible: false,
  type: 'error',
  title: '',
  message: '',
  detail: '',
  hint: '',
  kind: undefined,
})

function showModal(options: {
  type?: 'error' | 'warning' | 'info'
  title?: string
  message: string
  detail?: string
  hint?: string
  kind?: ParseErrorKind
}) {
  state.value = {
    visible: true,
    type: options.type || 'error',
    title: options.title || '',
    message: options.message,
    detail: options.detail || '',
    hint: options.hint || '',
    kind: options.kind,
  }
}

function showError(message: string, detail?: string, hint?: string, kind?: ParseErrorKind) {
  showModal({ type: 'error', message, detail, hint, kind })
}

function showWarning(message: string, detail?: string) {
  showModal({ type: 'warning', message, detail })
}

function showInfo(message: string, detail?: string) {
  showModal({ type: 'info', message, detail })
}

function close() {
  state.value.visible = false
}

export function useErrorModal() {
  return {
    state: readonly(state),
    showModal,
    showError,
    showWarning,
    showInfo,
    close,
  }
}

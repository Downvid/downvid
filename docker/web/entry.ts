// 1. 注入 Web 版 window.electronAPI（在 Vue 启动前就绪）
import './bridge'

// 2. 注入 WebUI 专有样式：隐藏桌面端专属的窗口控制三键（最小化/最大化/关闭）并解除拖拽限制
if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.id = 'downvid-web-overrides'
  style.textContent = `
    /* Web 模式下隐藏桌面端专属的最小化/最大化/关闭按钮 */
    header > div:last-child > div:last-child { display: none !important; }
    /* 取消桌面窗口的不可选拖拽区域 */
    header, [style*="-webkit-app-region"] { -webkit-app-region: no-drag !important; }
  `
  document.head.appendChild(style)
}

// 3. 启动应用本体（100% 原始 src/main.ts，无侵入无耦合）
import '../../src/main'

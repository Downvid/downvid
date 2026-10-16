// 1. 注入 Web 版 window.electronAPI（在 Vue 启动前就绪）
import './bridge'

// 2. 注入 WebUI 专有样式：精简 Web 模式下无效或误导性的桌面端元素，解除拖拽限制
if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.id = 'downvid-web-overrides'
  style.textContent = `
    /* Web 模式下隐藏桌面端专属的窗口控制三键（最小化/最大化/关闭） */
    header > div:last-child > div:last-child { display: none !important; }
    /* 取消桌面窗口的不可选拖拽区域 */
    header, [style*="-webkit-app-region"] { -webkit-app-region: no-drag !important; }

    /* 1. 设置面板：隐藏「更新」侧边栏 tab 及其对应内容分区 */
    .w-40 > button:last-child { display: none !important; }
    .flex-1.overflow-y-auto.px-6.py-5 > div:nth-child(5) { display: none !important; }

    /* 2. 关于页面：隐藏「检查更新」按钮（容器更新通过拉取镜像完成） */
    [class*="bg-linear-to-br"] button { display: none !important; }

    /* 3. 运行依赖：隐藏底部操作按钮行（重新检测/打开安装目录等）与手动指定折叠框，保留纯状态展示 */
    .flex.items-center.gap-2.flex-wrap { display: none !important; }
    details { display: none !important; }
    .flex.items-start.gap-3.p-3.rounded-lg.border > button { display: none !important; }

    /* 4. 下载设置：隐藏下载目录右侧的「选择」按钮（容器环境下载目录固定挂载在 /data/downloads） */
    .flex-1.overflow-y-auto.px-6.py-5 > div:first-child .flex.gap-2 > button { display: none !important; }

    /* 5. 任务队列底部：隐藏存储目录旁的打开文件夹按钮 */
    section .mt-auto .flex.items-center.gap-2:has(> .font-mono) > button { display: none !important; }
  `
  document.head.appendChild(style)
}

// 3. 启动应用本体（100% 原始 src/main.ts，无侵入无耦合）
import '../../src/main'

<template>
  <div class="flex-1 bg-surface overflow-y-auto">
    <div class="max-w-2xl mx-auto px-6 py-8">
      <!-- Header -->
      <div class="mb-8">
        <h1 class="font-headline text-2xl font-bold text-on-surface">关于</h1>
      </div>

      <!-- App Info Card -->
      <div class="bg-linear-to-br from-primary/5 to-secondary/5 rounded-2xl p-6 mb-6 border border-outline-variant/10">
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
            <img src="@/assets/logo.png" alt="DownVid" class="w-full h-full object-contain" />
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="font-headline text-xl font-bold text-on-surface">DownVid</h2>
            <p class="text-on-surface-variant text-sm mt-0.5">v{{ appVersion }}</p>
          </div>
          <button
            class="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
            @click="showUpdateDrawer = true"
          >
            <MaterialIcon name="update" :size="16" />
            <span>检查更新</span>
          </button>
        </div>
      </div>

      <!-- Description：一句话说明即可，详细能力在 README 与文档里 -->
      <div class="bg-surface-container-low rounded-xl px-4 py-3 mb-6 border border-outline-variant/10">
        <p class="text-xs text-on-surface-variant leading-relaxed">
          开源视频下载工具，基于 yt-dlp，支持抖音、B站、YouTube 等平台。
        </p>
      </div>

      <!-- Links -->
      <div class="space-y-3 mb-6">
        <button
          @click="openExternal(REPO_URL)"
          class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container-low hover:bg-surface-container-highest transition-colors group border border-outline-variant/10 text-left"
        >
          <div class="w-9 h-9 rounded-lg bg-surface-container-highest flex items-center justify-center group-hover:bg-surface transition-colors">
            <GitHubIcon :size="18" class="text-on-surface" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-on-surface">GitHub</p>
            <p class="text-xs text-on-surface-variant truncate">{{ repoLabel }}</p>
          </div>
          <MaterialIcon name="arrow_forward_ios" :size="14" class="text-on-surface-variant" />
        </button>

        <button
          @click="openExternal(ISSUES_URL)"
          class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container-low hover:bg-surface-container-highest transition-colors group border border-outline-variant/10 text-left"
        >
          <div class="w-9 h-9 rounded-lg bg-surface-container-highest flex items-center justify-center group-hover:bg-surface transition-colors">
            <MaterialIcon name="feedback" :size="18" class="text-on-surface" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-on-surface">问题反馈</p>
            <p class="text-xs text-on-surface-variant">提交建议或报告问题</p>
          </div>
          <MaterialIcon name="arrow_forward_ios" :size="14" class="text-on-surface-variant" />
        </button>
      </div>

      <!-- 贡献者：固定名单（不请求 API、不显示提交次数） -->
      <div class="mb-6">
        <h3 class="text-xs font-medium text-on-surface-variant uppercase tracking-wider mb-3">贡献者</h3>
        <ul class="m-0 list-none p-0 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <li v-for="member in CONTRIBUTORS" :key="member.login" class="min-w-0">
            <a
              :href="member.url"
              target="_blank"
              rel="noopener noreferrer"
              class="flex min-w-0 flex-col items-center gap-2.5 rounded-xl bg-surface-container-low border border-outline-variant/10 p-4 transition-colors hover:bg-surface-container-highest"
            >
              <div class="relative">
                <div class="size-14 rounded-full overflow-hidden bg-surface-container-highest flex items-center justify-center">
                  <img
                    v-if="!brokenAvatars.has(member.login)"
                    :src="avatarUrl(member.login)"
                    :alt="member.login"
                    class="w-full h-full object-cover"
                    loading="lazy"
                    @error="brokenAvatars.add(member.login)"
                  />
                  <span v-else class="text-base font-bold text-on-surface-variant">
                    {{ member.login.slice(0, 1).toUpperCase() }}
                  </span>
                </div>
                <span
                  v-if="member.role"
                  class="absolute -top-1 -right-2 px-1 py-0.5 text-[8px] font-bold rounded-sm leading-none"
                  :class="member.role === 'DEV' ? 'bg-primary text-on-primary' : 'bg-tertiary-container text-on-tertiary-container'"
                >
                  {{ member.role }}
                </span>
              </div>
              <span class="w-full text-center text-xs font-medium text-on-surface wrap-anywhere">{{ member.login }}</span>
            </a>
          </li>
        </ul>
      </div>

      <!-- 开源组件致谢：Material Symbols 是 Apache-2.0，随应用分发需保留声明 -->
      <div class="mb-6">
        <h3 class="text-xs font-medium text-on-surface-variant uppercase tracking-wider mb-3">开源组件</h3>
        <div class="bg-surface-container-low rounded-xl p-4 border border-outline-variant/10 flex flex-col gap-2">
          <div v-for="item in ossCredits" :key="item.name" class="flex items-baseline justify-between gap-3 text-xs">
            <span class="text-on-surface">{{ item.name }}</span>
            <span class="text-on-surface-variant text-right">
              {{ item.license }}
              <a
                v-if="item.url"
                class="text-tertiary hover:underline underline-offset-2 ml-1"
                @click="openExternal(item.url)"
              >主页</a>
            </span>
          </div>
        </div>
      </div>

      <!-- Tech Stack -->
      <div class="mb-6">
        <h3 class="text-xs font-medium text-on-surface-variant uppercase tracking-wider mb-3">技术栈</h3>
        <div class="flex flex-wrap gap-2">
          <span
            v-for="tech in techStack"
            :key="tech.name"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-surface-container-low rounded-lg text-on-surface border border-outline-variant/10"
            :title="tech.note || tech.name"
          >
            <MaterialIcon v-if="tech.icon" :name="tech.icon" :size="14" class="text-on-surface-variant" />
            {{ tech.name }}
          </span>
        </div>
      </div>

      <!-- License -->
      <div class="flex items-center justify-between py-4 border-t border-outline-variant/20">
        <div class="flex items-center gap-2">
          <MaterialIcon name="gavel" :size="16" class="text-on-surface-variant" />
          <span class="text-sm text-on-surface-variant">开源协议</span>
        </div>
        <span class="text-xs font-medium text-primary bg-primary/10 px-3 py-1 rounded-full">MIT License</span>
      </div>

      <!-- 支持项目 -->
      <div class="mt-6 p-4 rounded-xl bg-surface-container-low border border-outline-variant/10">
        <div class="flex items-center gap-2 mb-3">
          <MaterialIcon name="favorite" :size="18" class="text-primary" />
          <p class="text-sm font-medium text-on-surface">支持 DownVid</p>
        </div>
        <p class="text-xs text-on-surface-variant leading-relaxed mb-3">
          如果这个工具对你有帮助，欢迎请作者喝杯咖啡 ☕
        </p>
        <button
          class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest transition-colors border border-outline-variant/15"
          @click="showDonate = !showDonate"
        >
          <MaterialIcon :name="showDonate ? 'expand_less' : 'qr_code_2'" :size="18" class="text-on-surface-variant" />
          <span class="text-sm font-medium text-on-surface">{{ showDonate ? '收起赞赏码' : '显示赞赏码' }}</span>
        </button>

        <Transition name="donate">
          <div v-if="showDonate" class="mt-3 flex flex-col items-center gap-2">
            <img
              src="../assets/donate.jpg"
              alt="微信赞赏码"
              class="w-52 rounded-lg border border-outline-variant/15"
            />
            <p class="text-[11px] text-on-surface-variant">微信扫码赞赏 — 给 Black Cat 赞赏</p>
          </div>
        </Transition>
      </div>

      <!-- Copyright -->
      <div class="text-center pt-4">
        <p class="text-xs text-on-surface-variant/60">© 2026 DownVid</p>
        <p class="text-xs text-on-surface-variant/40 mt-1">Based on <a href="https://github.com/cshuangyy/videdown" class="hover:underline">Videdown</a> by cshuangyy (MIT License)</p>
      </div>
    </div>

    <!-- Update Modal -->
    <UpdateModal :visible="showUpdateDrawer" @close="showUpdateDrawer = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'
import GitHubIcon from './icons/GitHubIcon.vue'
import UpdateModal from './UpdateModal.vue'
import { ISSUES_URL, REPO_SLUG, REPO_URL } from '../../shared/app'

/** 界面展示用的仓库标识（去掉 https:// 前缀） */
const repoLabel = `github.com/${REPO_SLUG}`

/**
 * 贡献者：**固定名单**，不请求 GitHub API。
 *
 * 原先从 `/contributors` 拉取，而未认证请求限额 60 次/小时且按 IP 共享，
 * 很容易 403；客户端带 token 不可行。改为手写名单：
 * 稳定、离线可用、不再有失败态，也不用为"提交次数"这种会变化的数字做缓存。
 *
 * 顺序即展示顺序；`role` 只用于身份标。原作者不必额外标注 —— 许可证里已经写明。
 */
const CONTRIBUTORS = [
  { login: 'yxxbc', url: 'https://github.com/yxxbc', role: 'DEV' },
  { login: 'cshuangyy', url: 'https://github.com/cshuangyy' },
  { login: 'hailaij', url: 'https://github.com/hailaij', role: 'CONTRIBUTOR' },
  { login: 'jwfstars', url: 'https://github.com/jwfstars', role: 'CONTRIBUTOR' },
]

/** 头像地址：固定名单用 GitHub 头像，不依赖接口 */
function avatarUrl(login: string): string {
  return `https://github.com/${login}.png?size=112`
}

const showDonate = ref(false)

/** 技术栈：与 README、package.json 保持一致，改其一时同步另一处 */
const techStack = [
  { name: 'Electron', icon: 'desktop_windows' },
  { name: 'Vue 3', icon: 'code' },
  { name: 'TypeScript', icon: 'data_object' },
  { name: 'Tailwind CSS', icon: 'palette' },
  { name: 'Vite', icon: 'bolt' },
  { name: 'Pinia', icon: 'database' },
  { name: 'Go', icon: 'memory', note: '依赖边车：探测并复用系统已安装的 yt-dlp / ffmpeg' },
  { name: 'yt-dlp', icon: 'download', note: '不随安装包分发，运行时解析' },
  { name: 'FFmpeg', icon: 'movie', note: '不随安装包分发，运行时解析' },
]

/**
 * 随应用分发的开源组件与许可。
 * Material Symbols 是 Apache-2.0，分发时须保留声明，因此必须列出。
 */
const ossCredits = [
  { name: 'Material Symbols', license: 'Apache-2.0', url: 'https://fonts.google.com/icons' },
  { name: 'yt-dlp', license: 'Unlicense', url: 'https://github.com/yt-dlp/yt-dlp' },
  { name: 'FFmpeg (ffmpeg-static)', license: 'GPL-3.0', url: 'https://github.com/eugeneware/ffmpeg-static' },
  { name: 'Electron', license: 'MIT', url: 'https://www.electronjs.org' },
  { name: 'Vue', license: 'MIT', url: 'https://vuejs.org' },
]

const appVersion = ref('1.0.0')
const showUpdateDrawer = ref(false)

const brokenAvatars = reactive(new Set<string>())

onMounted(async () => {
  try {
    const version = await window.electronAPI?.app?.getVersion?.()
    if (version) appVersion.value = version
  } catch {}
})

async function openExternal(url: string) {
  try {
    await window.electronAPI.shell.openExternal(url)
  } catch {}
}
</script>

<style scoped>
.donate-enter-active, .donate-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.donate-enter-from, .donate-leave-to { opacity: 0; transform: translateY(-4px); }
</style>

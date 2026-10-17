<template>
  <div class="flex-1 bg-surface overflow-y-auto">
    <div class="max-w-2xl mx-auto px-6 py-8">
      <!-- Header -->
      <div class="mb-8">
        <h1 class="font-headline text-2xl font-bold text-on-surface">{{ t('about.title') }}</h1>
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
            <span>{{ t('about.checkUpdate') }}</span>
          </button>
        </div>
      </div>

      <!-- Description：一句话说明即可，详细能力在 README 与文档里 -->
      <div class="bg-surface-container-low rounded-xl px-4 py-3 mb-6 border border-outline-variant/10">
        <p class="text-xs text-on-surface-variant leading-relaxed">
          {{ t('about.intro') }}
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
          @click="openExternal(WEBSITE_URL)"
          class="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container-low hover:bg-surface-container-highest transition-colors group border border-outline-variant/10 text-left"
        >
          <div class="w-9 h-9 rounded-lg bg-surface-container-highest flex items-center justify-center group-hover:bg-surface transition-colors">
            <MaterialIcon name="public" :size="18" class="text-on-surface" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-on-surface">{{ t('about.website') }}</p>
            <p class="text-xs text-on-surface-variant truncate">{{ websiteLabel }}</p>
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
            <p class="text-sm font-medium text-on-surface">{{ t('about.feedback') }}</p>
            <p class="text-xs text-on-surface-variant">{{ t('about.feedbackHint') }}</p>
          </div>
          <MaterialIcon name="arrow_forward_ios" :size="14" class="text-on-surface-variant" />
        </button>
      </div>

      <!-- 贡献者：固定名单（不请求 API、不显示提交次数） -->
      <div class="mb-6">
        <h3 class="text-xs font-medium text-on-surface-variant uppercase tracking-wider mb-3">{{ t('about.contributors') }}</h3>
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
        <h3 class="text-xs font-medium text-on-surface-variant uppercase tracking-wider mb-3">{{ t('about.openSource') }}</h3>
        <div class="bg-surface-container-low rounded-xl p-4 border border-outline-variant/10 flex flex-col gap-2">
          <div v-for="item in ossCredits" :key="item.name" class="flex items-baseline justify-between gap-3 text-xs">
            <span class="text-on-surface">{{ item.name }}</span>
            <span class="text-on-surface-variant text-right">
              {{ item.license }}
              <a
                v-if="item.url"
                class="text-tertiary hover:underline underline-offset-2 ml-1"
                @click="openExternal(item.url)"
              >{{ t('about.homepage') }}</a>
            </span>
          </div>
        </div>
      </div>

      <!-- Tech Stack -->
      <div class="mb-6">
        <h3 class="text-xs font-medium text-on-surface-variant uppercase tracking-wider mb-3">{{ t('about.techStack') }}</h3>
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
          <span class="text-sm text-on-surface-variant">{{ t('about.license') }}</span>
        </div>
        <span class="text-xs font-medium text-primary bg-primary/10 px-3 py-1 rounded-full">MIT License</span>
      </div>

      <!-- 支持项目 -->
      <div class="mt-6 p-4 rounded-xl bg-surface-container-low border border-outline-variant/10">
        <div class="flex items-center gap-2 mb-3">
          <MaterialIcon name="favorite" :size="18" class="text-primary" />
          <p class="text-sm font-medium text-on-surface">{{ t('about.support') }}</p>
        </div>
        <p class="text-xs text-on-surface-variant leading-relaxed mb-3">
          {{ t('about.supportHint') }}
        </p>
        <button
          class="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest transition-colors border border-outline-variant/15"
          @click="showDonate = !showDonate"
        >
          <MaterialIcon :name="showDonate ? 'expand_less' : 'qr_code_2'" :size="18" class="text-on-surface-variant" />
          <span class="text-sm font-medium text-on-surface">{{ showDonate ? t('about.hideDonate') : t('about.showDonate') }}</span>
        </button>

        <Transition name="donate">
          <div v-if="showDonate" class="mt-3 flex flex-col items-center gap-2">
            <img
              src="../assets/donate.jpg"
              :alt="t('about.donateAlt')"
              class="w-52 rounded-lg border border-outline-variant/15"
            />
            <p class="text-[11px] text-on-surface-variant">{{ t('about.donateCaption') }}</p>
          </div>
        </Transition>

        <!-- 商务合作 / 赞助接洽：需要私下沟通的事走邮箱，其余仍引导到 Issues -->
        <div class="mt-4 pt-4 border-t border-outline-variant/15">
          <p class="text-xs text-on-surface-variant leading-relaxed mb-3">
            {{ t('about.contactHint') }}
          </p>
          <button
            class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest transition-colors border border-outline-variant/15 text-left"
            @click="openExternal(sponsorMailto)"
          >
            <MaterialIcon name="handshake" :size="18" class="text-on-surface-variant shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-on-surface">{{ t('about.contactSponsor') }}</p>
              <p class="text-xs text-on-surface-variant truncate">{{ CONTACT_EMAIL }}</p>
            </div>
          </button>
          <button
            class="mt-2 w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest transition-colors border border-outline-variant/15 text-left"
            @click="openExternal(businessMailto)"
          >
            <MaterialIcon name="campaign" :size="18" class="text-on-surface-variant shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-on-surface">{{ t('about.contactBusiness') }}</p>
              <p class="text-xs text-on-surface-variant truncate">{{ CONTACT_EMAIL }}</p>
            </div>
          </button>
        </div>
      </div>

      <!-- Copyright -->
      <div class="text-center pt-4">
        <p class="text-xs text-on-surface-variant/60">© 2026 DownVid</p>
        <p class="text-xs text-on-surface-variant/40 mt-1"><a href="https://github.com/Downvid/downvid/blob/main/LICENSE" class="hover:underline">MIT License</a></p>
      </div>
    </div>

    <!-- Update Modal -->
    <UpdateModal :visible="showUpdateDrawer" @close="showUpdateDrawer = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { t } from '../i18n'
import MaterialIcon from './icons/MaterialIcon.vue'
import GitHubIcon from './icons/GitHubIcon.vue'
import UpdateModal from './UpdateModal.vue'
import { CONTACT_EMAIL, ISSUES_URL, REPO_SLUG, REPO_URL, WEBSITE_URL, contactMailto } from '../../shared/app'

/** 界面展示用的仓库标识（去掉 https:// 前缀） */
const repoLabel = `github.com/${REPO_SLUG}`

/** 官网地址展示用（去掉协议前缀，省得一行放不下） */
const websiteLabel = WEBSITE_URL.replace(/^https?:\/\//, '')

/**
 * 商务合作 / 赞助接洽的 mailto。
 *
 * 主题带上项目名与类别，收件箱里一眼能分清是哪一类来信——
 * 只写一个裸邮箱时，用户往往不写主题，事后完全无法归类。
 * 主题**随界面语言切换**（与官网一致）：写死中文时英文用户点开会收到一封
 * 中文主题的邮件，同样没法归类。用 computed 而不是模块级常量，否则切语言不更新。
 */
const sponsorMailto = computed(() => contactMailto({ subject: t('about.mailSubjectSponsor') }))
const businessMailto = computed(() => contactMailto({ subject: t('about.mailSubjectBusiness') }))

/**
 * 贡献者：**固定名单**，不请求 GitHub API。
 *
 * 原先从 `/contributors` 拉取，而未认证请求限额 60 次/小时且按 IP 共享，
 * 很容易 403；客户端带 token 不可行。改为手写名单：
 * 稳定、离线可用、不再有失败态，也不用为"提交次数"这种会变化的数字做缓存。
 *
 * 顺序即展示顺序；`role` 只用于身份标。原作者不必额外标注 —— 许可证里已经写明。
 *
 * 名单口径：**在 main 上留下过代码贡献的人**，与 README 的
 * `contributors` 徽章、CHANGELOG 的致谢保持同一批人。加人时两处一起看，
 * 漏掉谁都不会报错，只会让人以为他没参与过。
 * 机器人（dependabot / github-actions）与 AI 助手不列：前者是自动化，
 * 后者在 README 的致谢里单独说明。
 */
const CONTRIBUTORS = [
  { login: 'yxxbc', url: 'https://github.com/yxxbc', role: 'DEV' },
  { login: 'cshuangyy', url: 'https://github.com/cshuangyy' },
  { login: 'hailaij', url: 'https://github.com/hailaij', role: 'CONTRIBUTOR' },
  { login: 'jwfstars', url: 'https://github.com/jwfstars', role: 'CONTRIBUTOR' },
  { login: 'zerow', url: 'https://github.com/zerow', role: 'CONTRIBUTOR' },
  { login: 'linuztx', url: 'https://github.com/linuztx', role: 'CONTRIBUTOR' },
  // 容器镜像（#70）的完整实现：原生 WebUI + WebSocket RPC 桥 + electron-shim。
  // 归档时补登——名单漏人不会报错，只会让那位贡献者从界面上消失。
  { login: 'Glaroday', url: 'https://github.com/Glaroday', role: 'CONTRIBUTOR' },
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
  { name: 'Go', icon: 'memory', get note() { return t('about.techGo') } },
  { name: 'yt-dlp', icon: 'download', get note() { return t('about.techNotBundled') } },
  { name: 'FFmpeg', icon: 'movie', get note() { return t('about.techNotBundled') } },
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

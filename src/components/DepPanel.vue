<template>
  <div class="flex flex-col gap-4">
    <!-- 总览 -->
    <div
      class="flex items-start gap-3 p-3 rounded-lg border"
      :class="store.ready
        ? 'bg-primary/5 border-primary/20'
        : 'bg-amber-container/20 border-amber/30'"
    >
      <MaterialIcon :name="store.ready ? 'check_circle' : 'warning'" :size="20"
                    :class="store.ready ? 'text-primary' : 'text-amber'" />
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-on-surface">
          {{ store.ready ? t('deps.ready') : t('deps.missing') }}
        </p>
        <p class="text-[11px] text-on-surface-variant mt-0.5 leading-relaxed">
          <template v-if="store.ready">
            {{ t('deps.reusing') }}
            <span v-if="store.managedCount">{{ t('deps.managedCount', { count: store.managedCount }) }}</span>
          </template>
          <template v-else>
            {{ t('deps.willDownload') }}
          </template>
        </p>
      </div>
      <button
        class="shrink-0 p-1.5 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors disabled:opacity-40"
        :disabled="store.checking || store.downloading"
        :title="t('deps.recheck')"
        @click="store.refresh(true)"
      >
        <MaterialIcon name="refresh" :size="16" :class="store.checking ? 'animate-spin' : ''" />
      </button>
    </div>

    <!-- 依赖列表 -->
    <div class="flex flex-col gap-2">
      <div
        v-for="dep in store.deps"
        :key="dep.kind"
        class="flex items-center gap-3 p-3 rounded-lg border border-outline-variant/15 bg-surface-container-highest/40"
      >
        <MaterialIcon
          :name="dep.found ? 'check_circle' : (dep.optional ? 'info' : 'error')"
          :size="18"
          :class="dep.found ? 'text-primary' : (dep.optional ? 'text-on-surface-variant' : 'text-error')"
        />

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-on-surface">{{ kindLabel(dep.kind) }}</span>
            <span
              v-if="dep.found && dep.version"
              class="text-[10px] px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-mono"
            >{{ dep.version }}</span>
            <span
              v-if="dep.found"
              class="text-[10px] px-1.5 py-0.5 rounded font-medium"
              :class="sourceClass(dep.source)"
            >{{ sourceLabel(dep.source) }}</span>
            <span v-if="dep.optional" class="text-[10px] text-on-surface-variant">{{ t('deps.optional') }}</span>
          </div>
          <!-- 路径：有就显示，没有就显示缺失原因 -->
          <p class="text-[11px] text-on-surface-variant mt-0.5 truncate font-mono" :title="dep.path || dep.reason">
            {{ dep.found ? dep.path : (dep.reason || t('deps.notFound')) }}
          </p>
          <!-- 该依赖正在下载 -->
          <div v-if="store.activeTool === dep.kind && store.downloading" class="mt-1.5">
            <div class="h-1 rounded-full bg-surface-container-highest overflow-hidden">
              <div
                class="h-full bg-primary transition-all duration-200"
                :class="store.percent === null ? 'animate-pulse w-1/3' : ''"
                :style="store.percent === null ? {} : { width: `${store.percent}%` }"
              />
            </div>
            <p class="text-[10px] text-on-surface-variant mt-1">{{ store.sizeText || store.notice }}</p>
          </div>
        </div>

        <div class="shrink-0 flex items-center gap-1">
          <!-- 缺依赖：下载（四个依赖同一套流程，不做平台特判） -->
          <button
            v-if="!dep.found"
            class="px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:opacity-40"
            :disabled="store.downloading"
            :title="dep.stale ? t('deps.outdatedHint', { version: dep.requiredVersion }) : t('deps.installHint')"
            @click="store.download([dep.kind])"
          >{{ dep.stale ? t('deps.update') : t('deps.download') }}</button>
          <!-- 托管副本确实落后于清单：才给「更新」。
               早先只看 dep.managed，于是版本与清单一致时也显示「更新」，
               用户点下去白下 37MB —— 这是「明明版本一样还提示更新」的根因。 -->
          <button
            v-else-if="isOutdated(dep)"
            class="px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:opacity-40"
            :disabled="store.downloading"
            :title="t('deps.versionHint', { current: dep.version, required: dep.requiredVersion })"
            @click="store.download([dep.kind], true)"
          >{{ t('deps.update') }}</button>
          <!-- 形态提示：让用户看见差异，而不是只提示「有更新」却不知道为什么要更新 -->
          <span v-else-if="dep.managed && dep.form === 'zipapp'" class="text-[10px] text-primary px-1.5">{{ t('deps.fastForm') }}</span>
          <span v-else-if="dep.managed" class="text-[10px] text-on-surface-variant px-1.5">{{ t('deps.upToDate') }}</span>
          <span v-else class="text-[10px] text-on-surface-variant px-1.5">{{ t('deps.system') }}</span>
        </div>
      </div>
    </div>

    <!-- 操作 -->
    <div class="flex items-center gap-2 flex-wrap">
      <button
        v-if="store.anyMissing"
        class="px-3 py-2 rounded-md text-sm font-medium bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:opacity-40"
        :disabled="store.downloading"
        @click="store.downloadMissing()"
      >
        {{ store.downloading ? t('deps.downloading') : t('deps.downloadMissing') }}
      </button>
      <button
        class="px-3 py-2 rounded-md text-sm font-medium bg-surface-container-highest text-on-surface border border-outline-variant/20 hover:bg-surface-variant transition-colors disabled:opacity-40"
        :disabled="store.checking || store.downloading"
        @click="store.refresh(true)"
      >{{ store.checking ? t('deps.checking') : t('deps.recheck') }}</button>
      <button
        v-if="store.downloading"
        class="px-3 py-2 rounded-md text-sm font-medium bg-error-container text-on-error-container hover:bg-error hover:text-on-error transition-colors"
        @click="store.cancel()"
      >{{ t('deps.cancelDownload') }}</button>
      <button
        class="px-3 py-2 rounded-md text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
        @click="store.openManagedDir()"
      >{{ t('deps.openInstallDir') }}</button>
    </div>

    <!-- 下载源：与「更新源」同一个形态（标签 + 下拉 + 说明），**不折叠**。
         折叠会让它看起来像「高级/无关选项」，而这恰恰是下载失败时用户最需要改的一项。 -->
    <div class="flex flex-col gap-1.5">
      <label class="text-sm font-medium text-on-surface">{{ t('deps.mirrorLabel') }}</label>
      <select
        v-model="depMirror"
        class="px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-sm text-on-surface focus:outline-hidden focus:border-primary/40"
        @change="onMirrorChange"
      >
        <option v-for="opt in mirrorOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
      </select>
      <p class="text-[11px] text-on-surface-variant leading-relaxed">{{ t('deps.mirrorHint') }}</p>
    </div>

    <!-- 错误 -->
    <div v-if="store.error" class="flex gap-2 p-3 rounded-lg bg-error-container/20 border border-error/30">
      <MaterialIcon name="error" :size="16" class="text-error shrink-0 mt-0.5" />
      <p class="text-xs text-on-surface leading-relaxed break-all">{{ store.error }}</p>
    </div>

    <!-- 手动指定路径：同样**不折叠**。
         折叠时它看起来像「无关的高级项」，而「我明明装了却显示未找到」正是
         用户最需要填它的时刻 —— 那一刻找不到入口，就等于没有这个功能。 -->
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-0.5">
        <label class="text-sm font-medium text-on-surface">{{ t('deps.manualTitle') }}</label>
        <p class="text-[11px] text-on-surface-variant leading-relaxed">
          {{ t('deps.manualHint') }}
        </p>
      </div>
      <div v-for="kind in kinds" :key="kind" class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-on-surface">{{ kindLabel(kind) }}</label>
        <div class="flex gap-2">
          <input
            :value="paths[kind] || ''"
            type="text"
            class="flex-1 px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-xs text-on-surface font-mono focus:outline-hidden focus:border-primary/40"
            :placeholder="t('deps.manualPlaceholder')"
            @input="onPathInput(kind, ($event.target as HTMLInputElement).value)"
          />
          <button
            class="px-3 py-2 bg-surface-container-highest text-on-surface rounded-md text-xs font-medium hover:bg-surface-variant transition-colors border border-outline-variant/20"
            @click="pick(kind)"
          >{{ t('common.select') }}</button>
          <button
            v-if="paths[kind]"
            class="px-3 py-2 bg-surface-container-highest text-on-surface-variant rounded-md text-xs font-medium hover:bg-surface-variant transition-colors border border-outline-variant/20"
            @click="clear(kind)"
          >{{ t('common.clear') }}</button>
        </div>
      </div>
      <button
        class="self-start px-3 py-2 rounded-md text-sm font-medium bg-surface-container-highest text-on-surface border border-outline-variant/20 hover:bg-surface-variant transition-colors disabled:opacity-40"
        :disabled="store.checking || store.downloading"
        @click="store.refresh(true)"
      >{{ t('deps.applyAndRecheck') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'
import { useDepsStore } from '../stores/deps'
import { t } from '../i18n'
import { readDepPaths, readSettings, updateDepPaths, updateSettings } from '../stores/settings'
import { useErrorModal } from '../composables/useErrorModal'
import { DEP_KINDS, DEP_MIRROR_IDS, type DepMirrorId } from '../../shared/acceleration'
import type { DepStatus } from '../types/deps'

/**
 * 下载源选择。
 *
 * 放在「运行依赖」面板里而不是设置里：用户真正需要它的时刻，
 * 就是**下载失败之后**——那时他已经在盯着这个面板的报错。
 * 藏进设置面板等于让他先学会去哪里找。
 */
const depMirror = ref(readSettings().depMirror)

const MIRROR_LABEL_KEYS: Record<DepMirrorId, () => string> = {
  auto: () => t('deps.mirror.auto'),
  direct: () => t('deps.mirror.direct'),
  ghproxy: () => t('deps.mirror.ghproxy'),
  'ghproxy-net': () => t('deps.mirror.ghproxyNet'),
  ghfast: () => t('deps.mirror.ghfast'),
}

const mirrorOptions = DEP_MIRROR_IDS.map(id => ({
  id,
  get label() { return MIRROR_LABEL_KEYS[id]() },
}))

function onMirrorChange() {
  updateSettings({ depMirror: depMirror.value })
  showInfo(t('deps.mirrorSaved'))
}

/**
 * 该依赖是否需要更新。
 *
 * 两种情况：
 *   1. **版本落后**于清单要求；
 *   2. **版本相同但形态不对**（yt-dlp 只对托管副本有意义）：
 *      zipapp 启动 0.4s，PyInstaller 独立包 9~10s，而两者的 `--version`
 *      完全一样。只看版本号时，「装的是慢的那个」会永远显示「已是最新」——
 *      用户被升级了清单却仍要等十几秒，且看不出原因（实测就是这样：
 *      10 月 14 日下的 35MB 独立包，版本号与新清单一致，于是永远不会被替换）。
 *
 * 反过来说，缺任一侧版本号时仍返回 false：宁可少提示，也不要在信息不全时
 * 把「更新」按钮亮出来（用户点下去要白下 37MB）。
 */
function isOutdated(dep: DepStatus): boolean {
  if (!dep.managed) return false
  if (dep.version && dep.requiredVersion && compareVersions(dep.version, dep.requiredVersion) < 0) return true
  // 形态不符：清单要 zipapp（有 python3 时）但装的是独立包
  if (dep.form === 'native' && prefersZipApp.value) return true
  return false
}

/**
 * 当前平台是否应该用 zipapp。
 *
 * 与 `manifest.HasUsablePython()` 是同一个判断的两端：那边决定**装哪一种**，
 * 这边决定**是否提示换掉现有的**。Windows 不在其列（那边 python3 不普遍，
 * 官方 exe 自带解释器，native 就是正确形态）。
 */
const prefersZipApp = computed(() => {
  const os = (store.status?.platform || '').split('/')[0]
  return os === 'darwin' || os === 'linux'
})

/** 按数字段逐个比较版本号，与后端 probe.CompareVersions 的语义保持一致 */
function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.\-+]/).map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n))
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}
import type { DepKind, DepSource } from '../types/deps'

const store = useDepsStore()
const { showInfo } = useErrorModal()
// 顺序即展示顺序：必需依赖在前，可选的 aria2 在后（与 DEP_KINDS 一致）
const kinds: DepKind[] = [...DEP_KINDS]

/** 手动路径单独存 localStorage['settings'].depPaths，与其它设置解耦 */
const paths = ref<Partial<Record<DepKind, string>>>({})

function persist() {
  // 合并写入：只改 depPaths，不动设置面板维护的字段（反之亦然）
  updateDepPaths({ ...paths.value })
}

function onPathInput(kind: DepKind, value: string) {
  paths.value = { ...paths.value, [kind]: value }
  persist()
}

async function pick(kind: DepKind) {
  const file = await window.electronAPI.dialog.selectFile()
  if (!file) return
  paths.value = { ...paths.value, [kind]: file }
  persist()
  await store.refresh(true)
}

async function clear(kind: DepKind) {
  paths.value = { ...paths.value, [kind]: '' }
  persist()
  await store.refresh(true)
}

/** 依赖在界面上的名字（aria2 需要点明用途，否则用户不知道它是什么） */
function kindLabel(kind: DepKind): string {
  return kind === 'aria2' ? t('deps.kind.aria2') : kind
}

// aria2 与其它依赖走完全相同的下载流程：五个平台都有自包含的静态构建
// （清单见 backend/internal/manifest/assets.gen.go 的 aria2Assets）。
// 这里刻意不做平台特判 —— 「macOS 只能装系统包」曾经是对的结论，但那是因为
// 只找过 Homebrew bottle（它链接 HOMEBREW_PREFIX 下的库，拷出来跑不了）；
// 换成社区静态构建后 macOS 也能一键下载。

function sourceLabel(source?: DepSource): string {
  if (source === 'system') return t('deps.sourceSystem')
  if (source === 'managed') return t('deps.sourceManaged')
  if (source === 'manual') return t('deps.sourceManual')
  if (source === 'scanned') return t('deps.sourceScanned')
  return ''
}

function sourceClass(source?: DepSource): string {
  if (source === 'system') return 'bg-primary/10 text-primary'
  if (source === 'managed') return 'bg-tertiary/10 text-tertiary'
  if (source === 'manual') return 'bg-surface-variant text-on-surface-variant'
  // 扫描发现的：提示用户这不是标准安装位置，便于判断是否要改用托管版本
  if (source === 'scanned') return 'bg-amber-container/30 text-amber'
  return 'text-on-surface-variant'
}

onMounted(() => {
  paths.value = readDepPaths()
  // 不阻塞首帧：refresh() 会 spawn Go 边车（冷启动 1~3 秒），
  // 直接 await 会让整个设置界面白屏那么久。先渲染，再在后台补数据。
  void store.refresh()
})
</script>

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
            <span class="text-sm font-medium text-on-surface">{{ dep.kind }}</span>
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
          <!-- 缺依赖：下载 -->
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

    <!-- 错误 -->
    <div v-if="store.error" class="flex gap-2 p-3 rounded-lg bg-error-container/20 border border-error/30">
      <MaterialIcon name="error" :size="16" class="text-error shrink-0 mt-0.5" />
      <p class="text-xs text-on-surface leading-relaxed break-all">{{ store.error }}</p>
    </div>

    <!-- 手动指定路径 -->
    <details class="rounded-lg border border-outline-variant/15 overflow-hidden">
      <summary class="px-3 py-2.5 text-sm font-medium text-on-surface cursor-pointer hover:bg-surface-container-highest transition-colors">
        {{ t('deps.manualTitle') }}
      </summary>
      <div class="px-3 pb-3 flex flex-col gap-3">
        <p class="text-[11px] text-on-surface-variant leading-relaxed">
          {{ t('deps.manualHint') }}
        </p>
        <div v-for="kind in kinds" :key="kind" class="flex flex-col gap-1.5">
          <label class="text-xs font-medium text-on-surface">{{ kind }}</label>
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
    </details>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'
import { useDepsStore } from '../stores/deps'
import { t } from '../i18n'
import { readDepPaths, updateDepPaths } from '../stores/settings'
import type { DepStatus } from '../types/deps'

/**
 * 该依赖是否**确实**落后于清单要求。
 *
 * 只在两边都有版本号且前者更旧时才为 true。缺任一侧版本号时返回 false——
 * 宁可少提示，也不要在版本一致时把「更新」按钮亮出来（用户点下去要白下
 * 37MB，而且下完还是同一个版本）。
 */
function isOutdated(dep: DepStatus): boolean {
  if (!dep.managed || !dep.version || !dep.requiredVersion) return false
  return compareVersions(dep.version, dep.requiredVersion) < 0
}

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
const kinds: DepKind[] = ['yt-dlp', 'ffmpeg', 'ffprobe']

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

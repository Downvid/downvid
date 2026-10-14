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
          {{ store.ready ? '运行依赖已就绪' : '缺少必需的运行依赖' }}
        </p>
        <p class="text-[11px] text-on-surface-variant mt-0.5 leading-relaxed">
          <template v-if="store.ready">
            正在复用本机已安装的组件，无需内置二进制。
            <span v-if="store.managedCount">其中 {{ store.managedCount }} 项由 DownVid 下载托管。</span>
          </template>
          <template v-else>
            DownVid 会优先使用系统已安装的版本，找不到时由你点击按钮下载。
          </template>
        </p>
      </div>
      <button
        class="shrink-0 p-1.5 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors disabled:opacity-40"
        :disabled="store.checking || store.downloading"
        :title="'重新检测'"
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
            <span v-if="dep.optional" class="text-[10px] text-on-surface-variant">可选</span>
          </div>
          <!-- 路径：有就显示，没有就显示缺失原因 -->
          <p class="text-[11px] text-on-surface-variant mt-0.5 truncate font-mono" :title="dep.path || dep.reason">
            {{ dep.found ? dep.path : (dep.reason || '未找到') }}
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
          <button
            v-if="!dep.found"
            class="px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:opacity-40"
            :disabled="store.downloading"
            @click="store.download([dep.kind])"
          >下载</button>
          <button
            v-else-if="dep.managed"
            class="px-2.5 py-1.5 rounded-md text-xs font-medium bg-surface-container-highest text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors disabled:opacity-40"
            :disabled="store.downloading"
            :title="'重新下载并覆盖（用于升级）'"
            @click="store.download([dep.kind], true)"
          >更新</button>
          <span v-else class="text-[10px] text-on-surface-variant px-1.5">系统自带</span>
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
        {{ store.downloading ? '下载中...' : '下载缺失的依赖' }}
      </button>
      <button
        class="px-3 py-2 rounded-md text-sm font-medium bg-surface-container-highest text-on-surface border border-outline-variant/20 hover:bg-surface-variant transition-colors disabled:opacity-40"
        :disabled="store.checking || store.downloading"
        @click="store.refresh(true)"
      >{{ store.checking ? '检测中...' : '重新检测' }}</button>
      <button
        v-if="store.downloading"
        class="px-3 py-2 rounded-md text-sm font-medium bg-error-container text-on-error-container hover:bg-error hover:text-on-error transition-colors"
        @click="store.cancel()"
      >取消下载</button>
      <button
        class="px-3 py-2 rounded-md text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
        @click="store.openManagedDir()"
      >打开安装目录</button>
    </div>

    <!-- 错误 -->
    <div v-if="store.error" class="flex gap-2 p-3 rounded-lg bg-error-container/20 border border-error/30">
      <MaterialIcon name="error" :size="16" class="text-error shrink-0 mt-0.5" />
      <p class="text-xs text-on-surface leading-relaxed break-all">{{ store.error }}</p>
    </div>

    <!-- 手动指定路径 -->
    <details class="rounded-lg border border-outline-variant/15 overflow-hidden">
      <summary class="px-3 py-2.5 text-sm font-medium text-on-surface cursor-pointer hover:bg-surface-container-highest transition-colors">
        手动指定可执行文件（进阶）
      </summary>
      <div class="px-3 pb-3 flex flex-col gap-3">
        <p class="text-[11px] text-on-surface-variant leading-relaxed">
          自动检测不到，或想固定使用某个版本时，可在此指定绝对路径。留空则自动检测。
        </p>
        <div v-for="kind in kinds" :key="kind" class="flex flex-col gap-1.5">
          <label class="text-xs font-medium text-on-surface">{{ kind }}</label>
          <div class="flex gap-2">
            <input
              :value="paths[kind] || ''"
              type="text"
              class="flex-1 px-3 py-2 bg-surface-container-highest border border-outline-variant/20 rounded-md text-xs text-on-surface font-mono focus:outline-hidden focus:border-primary/40"
              :placeholder="'留空则自动检测'"
              @input="onPathInput(kind, ($event.target as HTMLInputElement).value)"
            />
            <button
              class="px-3 py-2 bg-surface-container-highest text-on-surface rounded-md text-xs font-medium hover:bg-surface-variant transition-colors border border-outline-variant/20"
              @click="pick(kind)"
            >选择</button>
            <button
              v-if="paths[kind]"
              class="px-3 py-2 bg-surface-container-highest text-on-surface-variant rounded-md text-xs font-medium hover:bg-surface-variant transition-colors border border-outline-variant/20"
              @click="clear(kind)"
            >清除</button>
          </div>
        </div>
        <button
          class="self-start px-3 py-2 rounded-md text-sm font-medium bg-surface-container-highest text-on-surface border border-outline-variant/20 hover:bg-surface-variant transition-colors disabled:opacity-40"
          :disabled="store.checking || store.downloading"
          @click="store.refresh(true)"
        >应用并重新检测</button>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MaterialIcon from './icons/MaterialIcon.vue'
import { useDepsStore } from '../stores/deps'
import { readDepPaths, updateDepPaths } from '../stores/settings'
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
  if (source === 'system') return '系统安装'
  if (source === 'managed') return 'DownVid 托管'
  if (source === 'manual') return '手动指定'
  if (source === 'scanned') return '扫描发现'
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

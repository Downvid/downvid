/**
 * 演示数据。全部是「真实形状」的假数据：字段、数量级、平台差异都参照
 * 旧版 src/types/index.ts 与真实 yt-dlp 输出，方便 UI 验证而不是只看空壳。
 *
 * 不联网：缩略图是本地资源，避免「组件对不对」和「网络通不通」混在一起。
 */
import thumbFuji from '../assets/demo-thumb.jpg'
import posterFuji from '../assets/posters/fuji.jpg'
import posterKyoto from '../assets/posters/kyoto.jpg'
import posterTokyo from '../assets/posters/tokyo.jpg'
import posterDesk from '../assets/posters/desk.jpg'

export const GB = 1024 * 1024 * 1024
export const MB = 1024 * 1024

export const APP_VERSION = '1.4.0'
export const NEXT_VERSION = '1.5.0'
export const REPO_URL = 'https://github.com/Downvid/downvid'
export const WEBSITE_URL = 'https://downvid-coral.vercel.app'

export const POSTERS = { fuji: posterFuji, kyoto: posterKyoto, tokyo: posterTokyo, desk: posterDesk }

export type PlatformId = 'bilibili' | 'youtube' | 'douyin' | 'xiaohongshu' | 'instagram' | 'kuaishou' | 'other'

export const SAMPLE_URLS: Record<string, string> = {
  youtube: 'https://www.youtube.com/watch?v=n_PxJ2Pyecl',
  bilibili: 'https://www.bilibili.com/video/BV1xx411c7mD',
  douyin: 'https://v.douyin.com/iRNBho6u/',
  xiaohongshu: 'https://www.xiaohongshu.com/discovery/item/66f0a1b2c3',
}
export const SAMPLE_URL = SAMPLE_URLS.youtube

export type Mode = 'video' | 'audio' | 'subtitle'

export interface FormatOption {
  id: string
  label: string
  ext: string
  sizeBytes: number
  height?: number
  fps?: number
  codec?: string
  recommended?: boolean
  hasAudio?: boolean
}

export interface AudioOption {
  id: string
  label: string
  kbps: number
  ext: string
  sizeBytes: number
  codec?: string
}

export interface TrackOption {
  id: string
  name: string
  lang: string
}

export interface SubtitleOption {
  id: string
  lang: string
  name: string
  ext: string
  auto?: boolean
}

export interface DemoVideo {
  url: string
  platformId: PlatformId
  platformName: string
  host: string
  title: string
  uploader: string
  duration: number
  thumbnail: string
  formats: FormatOption[]
  audios: AudioOption[]
  tracks: TrackOption[]
  subtitles: SubtitleOption[]
  needsCookies: boolean
  notice?: string
}

export interface HistoryItem {
  id: string
  title: string
  thumbnail: string
  url: string
  filePath: string
  quality: string
  ext: string
  mode: Mode
  sizeBytes: number
  createdAt: number
  fileExists: boolean
}

export type TaskStatus = 'queued' | 'downloading' | 'merging' | 'paused' | 'completed' | 'error'

export interface TaskItem {
  id: string
  title: string
  thumbnail: string
  url: string
  mode: Mode
  quality: string
  ext: string
  totalBytes: number
  bytesDone: number
  progress: number
  speedBps: number
  speedBase: number
  etaSec: number
  status: TaskStatus
  createdAt: number
  startedAt: number
  mergeUntil?: number
  seed: number
  speedHistory: number[]
  filePath: string
  error?: string
}

export interface DepItem {
  id: string
  name: string
  version?: string
  required: boolean
  status: 'ready' | 'missing' | 'outdated'
  source: 'system' | 'managed' | 'none'
  path?: string
  progress?: number
  busy?: boolean
}

export interface DemoSettings {
  language: 'auto' | 'zh-CN' | 'en-US'
  downloadDir: string
  filenameTemplate: string
  quality: 'best' | '1080p' | '720p' | '480p'
  cookieMode: 'auto' | 'manual'
  cookieFile: string
  proxy: string
  accelEnabled: boolean
  maxConnections: number
  updateSource: 'auto' | 'github' | 'jsdelivr' | 'ghproxy' | 'gitee' | 'website'
  autoCheckUpdate: boolean
  autoDownloadUpdate: boolean
}

export const DEFAULT_SETTINGS: DemoSettings = {
  language: 'auto',
  downloadDir: '~/Downloads/DownVid',
  filenameTemplate: '%(title)s.%(ext)s',
  quality: 'best',
  cookieMode: 'auto',
  cookieFile: '',
  proxy: '',
  accelEnabled: true,
  maxConnections: 8,
  updateSource: 'auto',
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
}

export const STORAGE_TOTAL = 460.4 * GB
export const STORAGE_FREE = 180.9 * GB

export function detectPlatform(url: string): PlatformId {
  const u = url.toLowerCase()
  if (u.includes('bilibili.com') || u.includes('b23.tv')) return 'bilibili'
  if (u.includes('youtu')) return 'youtube'
  if (u.includes('douyin') || u.includes('iesdouyin')) return 'douyin'
  if (u.includes('xiaohongshu')) return 'xiaohongshu'
  if (u.includes('instagram')) return 'instagram'
  if (u.includes('kuaishou')) return 'kuaishou'
  return 'other'
}

/** 从一段文本里取出第一个 http(s) 链接（等价旧版 extractUrl 的简化版） */
export function extractUrl(raw: string): string | null {
  const match = raw.match(/https?:\/\/[^\s]+/i)
  if (!match) return null
  try {
    const parsed = new URL(match[0])
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

function makeYoutube(url: string): DemoVideo {
  return {
    url,
    platformId: 'youtube',
    platformName: 'YouTube',
    host: 'youtube.com',
    title: 'Day Trip to Mt. Fuji Area from Tokyo | Winter Train Trip | JAPAN TRAVEL VLOG',
    uploader: 'Unique Japan Travel',
    duration: 1122,
    thumbnail: thumbFuji,
    needsCookies: false,
    formats: [
      { id: '313', label: '2160P', ext: 'MP4', sizeBytes: 2.28 * GB, height: 2160, fps: 30, codec: 'VP9' },
      { id: '271', label: '1440P', ext: 'WEBM', sizeBytes: 1.0 * GB, height: 1440, fps: 30, codec: 'VP9' },
      { id: '299', label: '1080P60', ext: 'MP4', sizeBytes: 457.1 * MB, height: 1080, fps: 60, codec: 'H.264', recommended: true },
      { id: '137', label: '1080P', ext: 'MP4', sizeBytes: 302.4 * MB, height: 1080, fps: 30, codec: 'H.264' },
      { id: '136', label: '720P', ext: 'MP4', sizeBytes: 142.2 * MB, height: 720, fps: 30, codec: 'H.264' },
      { id: '135', label: '480P', ext: 'MP4', sizeBytes: 81.8 * MB, height: 480, fps: 30, codec: 'H.264' },
      { id: '134', label: '360P', ext: 'MP4', sizeBytes: 47.4 * MB, height: 360, fps: 30, codec: 'H.264' },
      { id: '133', label: '240P', ext: 'MP4', sizeBytes: 21.0 * MB, height: 240, fps: 30, codec: 'H.264' },
    ],
    audios: [
      { id: '251', label: 'Opus 160k', kbps: 160, ext: 'WEBM', sizeBytes: 17.3 * MB, codec: 'Opus' },
      { id: '140', label: 'AAC 128k', kbps: 128, ext: 'M4A', sizeBytes: 12.4 * MB, codec: 'AAC' },
      { id: '139', label: 'AAC 48k', kbps: 48, ext: 'M4A', sizeBytes: 6.1 * MB, codec: 'AAC' },
    ],
    tracks: [
      { id: 'ja', name: '日本語（原音）', lang: 'ja' },
      { id: 'en', name: 'English dub', lang: 'en' },
    ],
    subtitles: [
      { id: 'zh-Hans', lang: 'zh-Hans', name: '中文（简体）', ext: 'SRT' },
      { id: 'en', lang: 'en', name: 'English', ext: 'SRT' },
      { id: 'ja', lang: 'ja', name: '日本語', ext: 'SRT', auto: true },
    ],
  }
}

function makeBilibili(url: string): DemoVideo {
  return {
    url,
    platformId: 'bilibili',
    platformName: '哔哩哔哩',
    host: 'bilibili.com',
    title: '【4K】京都 · 秋日寺院散步｜环境音 ASMR｜京都旅行',
    uploader: '旅行的意义',
    duration: 1268,
    thumbnail: posterKyoto,
    needsCookies: true,
    formats: [
      { id: '120', label: '4K', ext: 'MP4', sizeBytes: 1.86 * GB, height: 2160, fps: 30, codec: 'HEVC' },
      { id: '116', label: '1080P60', ext: 'MP4', sizeBytes: 612.0 * MB, height: 1080, fps: 60, codec: 'HEVC', recommended: true },
      { id: '80', label: '1080P', ext: 'MP4', sizeBytes: 438.7 * MB, height: 1080, fps: 30, codec: 'AVC' },
      { id: '64', label: '720P', ext: 'MP4', sizeBytes: 214.5 * MB, height: 720, fps: 30, codec: 'AVC' },
      { id: '32', label: '480P', ext: 'MP4', sizeBytes: 98.2 * MB, height: 480, fps: 30, codec: 'AVC' },
      { id: '16', label: '360P', ext: 'MP4', sizeBytes: 52.6 * MB, height: 360, fps: 30, codec: 'AVC' },
    ],
    audios: [
      { id: '30280', label: 'M4A 192k', kbps: 192, ext: 'M4A', sizeBytes: 29.8 * MB, codec: 'AAC' },
      { id: '30216', label: 'M4A 64k', kbps: 64, ext: 'M4A', sizeBytes: 10.1 * MB, codec: 'AAC' },
    ],
    tracks: [],
    subtitles: [{ id: 'zh-Hans', lang: 'zh-Hans', name: '中文（简体）', ext: 'SRT' }],
  }
}

function makeDouyin(url: string): DemoVideo {
  return {
    url,
    platformId: 'douyin',
    platformName: '抖音',
    host: 'douyin.com',
    title: '城市夜骑 · 滨江 4K｜风从耳边过',
    uploader: '夜骑阿远',
    duration: 47,
    thumbnail: posterTokyo,
    needsCookies: false,
    notice: '抖音直链有时效，解析后会立即开始下载。',
    formats: [
      { id: 'direct-1080', label: '1080P', ext: 'MP4', sizeBytes: 24.8 * MB, height: 1080, fps: 30, codec: 'H.264', hasAudio: true, recommended: true },
    ],
    audios: [],
    tracks: [],
    subtitles: [],
  }
}

function makeXiaohongshu(url: string): DemoVideo {
  return {
    url,
    platformId: 'xiaohongshu',
    platformName: '小红书',
    host: 'xiaohongshu.com',
    title: '周末去有风的地方｜大理 · 喜洲古镇两日',
    uploader: '一颗柚子',
    duration: 194,
    thumbnail: posterFuji,
    needsCookies: false,
    formats: [
      { id: 'h264-1080', label: '1080P', ext: 'MP4', sizeBytes: 88.6 * MB, height: 1080, fps: 30, codec: 'H.264', recommended: true },
      { id: 'h264-720', label: '720P', ext: 'MP4', sizeBytes: 42.1 * MB, height: 720, fps: 30, codec: 'H.264' },
    ],
    audios: [],
    tracks: [],
    subtitles: [],
  }
}

export function makeVideoInfo(url: string): DemoVideo {
  const platform = detectPlatform(url)
  if (platform === 'bilibili') return makeBilibili(url)
  if (platform === 'douyin') return makeDouyin(url)
  if (platform === 'xiaohongshu') return makeXiaohongshu(url)
  return makeYoutube(url)
}

export function historySeed(): HistoryItem[] {
  const now = Date.now()
  const MIN = 60_000
  const HOUR = 3_600_000
  return [
    {
      id: 'h-1',
      title: 'Day Trip to Mt. Fuji Area from Tokyo | Winter Train Trip | JAPAN TRAVEL VLOG',
      thumbnail: thumbFuji,
      url: SAMPLE_URLS.youtube,
      filePath: '~/Downloads/DownVid/Day Trip to Mt. Fuji Area from Tokyo.mp4',
      quality: '4K',
      ext: 'MP4',
      mode: 'video',
      sizeBytes: 2.28 * GB,
      createdAt: now - 34 * MIN,
      fileExists: true,
    },
    {
      id: 'h-2',
      title: '【4K】京都 · 秋日寺院散步｜环境音 ASMR｜京都旅行',
      thumbnail: posterKyoto,
      url: SAMPLE_URLS.bilibili,
      filePath: '~/Downloads/DownVid/京都 · 秋日寺院散步.mp4',
      quality: '1080P60',
      ext: 'MP4',
      mode: 'video',
      sizeBytes: 612.0 * MB,
      createdAt: now - 3 * HOUR,
      fileExists: true,
    },
    {
      id: 'h-3',
      title: '城市夜骑 · 滨江 4K｜风从耳边过',
      thumbnail: posterTokyo,
      url: SAMPLE_URLS.douyin,
      filePath: '~/Downloads/DownVid/城市夜骑 · 滨江 4K.mp4',
      quality: '1080P',
      ext: 'MP4',
      mode: 'video',
      sizeBytes: 24.8 * MB,
      createdAt: now - 27 * HOUR,
      fileExists: true,
    },
    {
      id: 'h-4',
      title: 'lofi 深夜工作电台 · 2 小时不间断',
      thumbnail: posterDesk,
      url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
      filePath: '~/Downloads/DownVid/lofi 深夜工作电台.m4a',
      quality: 'Opus 160k',
      ext: 'M4A',
      mode: 'audio',
      sizeBytes: 86.3 * MB,
      createdAt: now - 29 * HOUR,
      fileExists: true,
    },
    {
      id: 'h-5',
      title: '周末去有风的地方｜大理 · 喜洲古镇两日',
      thumbnail: posterFuji,
      url: SAMPLE_URLS.xiaohongshu,
      filePath: '~/Downloads/DownVid/大理 · 喜洲古镇.mp4',
      quality: '720P',
      ext: 'MP4',
      mode: 'video',
      sizeBytes: 42.1 * MB,
      createdAt: now - 4 * 24 * HOUR,
      fileExists: false,
    },
    {
      id: 'h-6',
      title: '富士山樱花航拍 · 4K HDR',
      thumbnail: posterFuji,
      url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
      filePath: '~/Downloads/DownVid/富士山樱花航拍.mp4',
      quality: '4K',
      ext: 'MP4',
      mode: 'video',
      sizeBytes: 966.0 * MB,
      createdAt: now - 6 * 24 * HOUR,
      fileExists: true,
    },
  ]
}

export function depsSeed(): DepItem[] {
  return [
    {
      id: 'yt-dlp',
      name: 'yt-dlp',
      version: '2026.10.10',
      required: true,
      status: 'ready',
      source: 'managed',
      path: '~/Library/Application Support/DownVid/runtime/bin/yt-dlp',
    },
    {
      id: 'ffmpeg',
      name: 'ffmpeg',
      version: '7.1',
      required: true,
      status: 'ready',
      source: 'system',
      path: '/opt/homebrew/bin/ffmpeg',
    },
    {
      id: 'ffprobe',
      name: 'ffprobe',
      version: '7.1',
      required: true,
      status: 'ready',
      source: 'system',
      path: '/opt/homebrew/bin/ffprobe',
    },
    {
      id: 'aria2c',
      name: 'aria2c',
      required: false,
      status: 'missing',
      source: 'none',
    },
  ]
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

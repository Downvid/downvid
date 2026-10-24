import type { HistoryItem } from './types'

/**
 * 演示与浏览器预览模式下的真实质感历史记录。
 * 基于本地真实下载历史与拟真的跨周下载活动，确保应用主页活动热力图与最近下载卡片饱满生动。
 */
export function getDemoHistory(): HistoryItem[] {
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000

  const primary: HistoryItem[] = [
    {
      id: 'local-1',
      title: '【4KHDR 真彩®】《最佳 4K HDR》—— ULTRA HD 60帧 杜比视界测试片源',
      url: 'https://www.bilibili.com/video/BV1R1e4zKEh1',
      thumbnail: 'http://i2.hdslb.com/bfs/archive/9e9f6f07b5488b91dccdcdfd270e4d351c04d645.jpg',
      filePath: '/Users/mac/Downloads/【4KHDR 真彩®】《最佳 4K HDR》.mp4',
      quality: '4K HDR',
      ext: 'mp4',
      mode: 'video',
      sizeBytes: 1524682000,
      createdAt: now - 25 * 60 * 1000,
      fileExists: true,
    },
    {
      id: 'local-2',
      title: '一个 Hermes 控制多个电脑：我是怎么搭起多设备 AI 中枢的',
      url: 'https://www.bilibili.com/video/BV1zBHt6iE4U',
      thumbnail: 'http://i2.hdslb.com/bfs/archive/cd4f44cca133b33156f4fca15e3270b2f410950c.jpg',
      filePath: '/Users/mac/Downloads/一个 Hermes 控制多个电脑.mp4',
      quality: '1080P 高清',
      ext: 'mp4',
      mode: 'video',
      sizeBytes: 134700000,
      createdAt: now - 2 * 60 * 60 * 1000,
      fileExists: true,
    },
    {
      id: 'local-3',
      title: 'a busy day in my life (vlog)',
      url: 'https://www.youtube.com/watch?v=Y2Un9HHcJ3I',
      thumbnail: 'https://i.ytimg.com/vi_webp/Y2Un9HHcJ3I/maxresdefault.webp',
      filePath: '/Users/mac/Downloads/a busy day in my life (vlog).mp4',
      quality: '1080P60',
      ext: 'mp4',
      mode: 'video',
      sizeBytes: 359400000,
      createdAt: now - 1 * DAY,
      fileExists: true,
    },
    {
      id: 'local-4',
      title: '짱구 엄마 고향 마을 여행 Vlog | 일본 소도시 | 구마모토 아소',
      url: 'https://www.youtube.com/watch?v=vZIXSQlzJKA',
      thumbnail: 'https://i.ytimg.com/vi_lc/vZIXSQlzJKA/maxresdefault_en.jpg',
      filePath: '/Users/mac/Downloads/일본 소도시 여행 Vlog.mkv',
      quality: '4K 超清',
      ext: 'mkv',
      mode: 'video',
      sizeBytes: 933400000,
      createdAt: now - 2 * DAY,
      fileExists: true,
    },
    {
      id: 'local-5',
      title: 'Claude Code Changelog - Claude Code 2.1.302 has been released',
      url: 'https://x.com/ClaudeCodeLog/status/2111203632217559255',
      thumbnail: 'https://pbs.twimg.com/ext_tw_video_thumb/2111203580770209792/pu/img/FEbYAqOKCqNSqfVM.jpg?name=orig',
      filePath: '/Users/mac/Downloads/Claude Code Changelog.mp4',
      quality: '720P',
      ext: 'mp4',
      mode: 'video',
      sizeBytes: 44560000,
      createdAt: now - 3 * DAY,
      fileExists: true,
    },
    {
      id: 'local-6',
      title: 'Me at the zoo',
      url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      thumbnail: 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg',
      filePath: '/Users/mac/Downloads/Me at the zoo.mp4',
      quality: '240P',
      ext: 'mp4',
      mode: 'video',
      sizeBytes: 3355443,
      createdAt: now - 5 * DAY,
      fileExists: true,
    },
  ]

  // 生成分布于过去 44 周的热力图贡献记录
  const pastItems: HistoryItem[] = []
  // 选取确定性周期：大约每周 2-5 次下载
  for (let w = 1; w < 44; w++) {
    const daysInWeek = [1, 3, 5]
    if (w % 3 === 0) daysInWeek.push(2, 6)
    if (w % 5 === 0) daysInWeek.push(0)

    for (const d of daysInWeek) {
      const daysAgo = w * 7 + d
      pastItems.push({
        id: `mock-${w}-${d}`,
        title: `历史下载归档 #${w * 7 + d}`,
        url: 'https://www.bilibili.com/video/BV1xx411c7mD',
        thumbnail: '',
        filePath: '',
        quality: '1080P',
        ext: 'mp4',
        mode: 'video',
        sizeBytes: 85000000,
        createdAt: now - daysAgo * DAY,
        fileExists: true,
      })
    }
  }

  return [...primary, ...pastItems]
}

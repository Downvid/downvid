import { describe, it, expect } from 'vitest'
import { parseAria2Progress } from '../electron/download/aria2-progress'

describe('aria2 实时进度', () => {
  it('解析固定字节单位输出，计算实际下载量和速率', () => {
    expect(parseAria2Progress('[#abc123 1000/4000(25%) CN:8 DL:2000 ETA:1s]'))
      .toEqual({ downloaded: 1000, total: 4000, speed: 2000 })
  })
  it('允许 B 后缀和回车刷新，不依赖换行', () => {
    expect(parseAria2Progress('\r[#abc123 1000B/4000B(25%) CN:8 DL:2000B ETA:1s]')).toEqual({ downloaded: 1000, total: 4000, speed: 2000 })
  })
  it('不把日志、截断、溢出或越界数据当进度', () => {
    for (const line of ['download completed', '[#abc123 1000/4000(25%) CN:8 DL:2000',
      '[#abc123 5000/4000(125%) CN:8 DL:2000]', '[#abc123 0/90071992547409999(0%) CN:1 DL:1]']) {
      expect(parseAria2Progress(line)).toBeNull()
    }
  })
})

/**
 * 下载活动的假数据（GitHub contribution 风格）。
 *
 * 纯函数、按天确定性生成：同一天打开两次得到同一张图，不会每次刷新都变。
 * 正式版应该从主进程的历史记录里按天聚合，这里只是演示形状。
 */

export interface ActivityDay {
  date: Date
  count: number
}

export interface ActivityBuild {
  /** 按周分列，每列 7 天（周一 → 周日），首尾可能为 null */
  weeks: (ActivityDay | null)[][]
  /** 每个月第一次出现的周索引，用于月份标签定位 */
  months: { month: number; week: number }[]
  today: ActivityDay
  total: number
  streak: number
  last30: number
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123
  return x - Math.floor(x)
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000)
}

export function buildActivity(now = new Date()): ActivityBuild {
  const today = startOfDay(now)
  const first = new Date(today)
  first.setDate(first.getDate() - 364)

  // 从 first 所在周的周一开始铺格子
  const mondayOffset = (first.getDay() + 6) % 7
  const gridStart = new Date(first)
  gridStart.setDate(gridStart.getDate() - mondayOffset)

  const weeks: (ActivityDay | null)[][] = []
  const days: ActivityDay[] = []
  let cursor = new Date(gridStart)

  while (cursor <= today) {
    const week: (ActivityDay | null)[] = []
    for (let row = 0; row < 7; row++) {
      const date = new Date(cursor)
      if (date < first || date > today) {
        week.push(null)
      } else {
        const offset = dayDiff(today, date)
        let count = Math.floor(hash(offset) * 7)
        // 最近 23 天保持连续，做出一个可信的 streak
        if (offset < 23) count = Math.max(count, 1)
        // 周末略多一点
        const weekday = date.getDay()
        if (weekday === 0 || weekday === 6) count += Math.floor(hash(offset + 101) * 3)
        // 半年前偶尔断更
        if (offset > 300 && hash(offset + 7) < 0.4) count = 0
        const day = { date, count }
        week.push(day)
        days.push(day)
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }

  const months: { month: number; week: number }[] = []
  let lastMonth = -1
  weeks.forEach((week, weekIndex) => {
    const firstDay = week.find((day): day is ActivityDay => day !== null)
    if (!firstDay) return
    const month = firstDay.date.getMonth()
    if (month !== lastMonth) {
      months.push({ month, week: weekIndex })
      lastMonth = month
    }
  })

  const total = days.reduce((sum, day) => sum + day.count, 0)
  const last30 = days.slice(-30).reduce((sum, day) => sum + day.count, 0)
  let streak = 0
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) streak += 1
    else break
  }

  return { weeks, months, today: days[days.length - 1], total, streak, last30 }
}

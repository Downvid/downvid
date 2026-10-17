/**
 * 文件名模板的「清晰度消歧」。
 *
 * ## 要解决的问题
 *
 * 默认模板是 `%(title)s.%(ext)s`，同一个视频的 1080P 与 4K 会算出**同一个文件名**。
 * 先下 1080P 再下 4K 时，yt-dlp 发现文件已存在就跳过并报成功——用户以为
 * 拿到了 4K，实际还是原来那个文件。所以模板里必须带清晰度。
 *
 * ## 为什么要由**前端**决定加不加
 *
 * 后端不知道用户此刻选的是哪个格式的分辨率，只能瞎补。而纯音频、直链、
 * 本地文件这些格式**根本没有 height**，`%(height)s` 会渲染成 `NA`
 * ——产物名变成 `标题 [NAp].mp4`（真机 e2e 里就出现过）。
 *
 * 前端在选格式时就知道 height，所以：
 *   - 有 height → 追加 `[1080p]`
 *   - 没有 height → 不追加（同一个视频的音频/视频本来就是不同扩展名，
 *     不会互相覆盖）
 *
 * ## 已经带了清晰度字段的模板不处理
 *
 * 用户写 `%(title)s-%(id)s.%(ext)s` 时是有意为之，擅自追加会改乱他的命名。
 */

/** 模板里已有的清晰度占位符（写了任意一个就不再追加） */
const HAS_QUALITY_FIELD = /%\((?:height|resolution|format_id|format|quality)\)/

/** 扩展名占位符：后缀要插在它**前面**，否则会变成 `标题.mp4 [1080p]` */
const EXT_TOKEN = '.%(ext)s'

/**
 * 按当前所选格式的分辨率，给模板补清晰度后缀。
 *
 * @param template 用户设置里的模板
 * @param height   当前格式的高度；`undefined` / `0` / `NaN` 表示没有高度
 */
export function applyQualityDisambiguation(
  template: string,
  height: number | undefined,
): string {
  const base = template?.trim() ? template : '%(title)s.%(ext)s'

  // 模板自己已经区分清晰度 → 尊重用户的写法
  if (HAS_QUALITY_FIELD.test(base)) return base

  // 没有分辨率：追加了只会得到 `[NAp]`，所以什么都不加
  if (!height || !Number.isFinite(height) || height <= 0) return base

  // 模板没写扩展名时，BuildArgs 会补 `.%(ext)s`，这里按同样的规则把后缀
  // 放在末尾——插入位置不同会让两边算出的文件名不一致。
  const idx = base.lastIndexOf(EXT_TOKEN)
  const suffix = ` [${Math.round(height)}p]`
  return idx >= 0 ? `${base.slice(0, idx)}${suffix}${base.slice(idx)}` : `${base}${suffix}`
}

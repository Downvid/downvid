import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const rootDir = process.cwd()
const outDir = path.join(rootDir, '.github/assets')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

const outputFile = path.join(outDir, 'social-preview.png')
const tmpDir = path.join(rootDir, 'node_modules/.cache/social-preview')
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

const FONT_EN_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
const FONT_EN_REG = '/System/Library/Fonts/Supplemental/Arial.ttf'
const FONT_CJK = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'

console.log('1. 生成纯正深邃渐变底板与高品质光晕...')
// 生成 1280x640 纯正深色底板
execSync(`magick -size 1280x640 "gradient:#0d1527-#04060c" "${path.join(tmpDir, 'bg_base.png')}"`)

// 生成点阵星芒纹理 (Dot Matrix)，加 -background none 确保透明通道
let dots = ''
for (let x = 24; x < 1280; x += 36) {
  for (let y = 24; y < 640; y += 36) {
    dots += `<circle cx="${x}" cy="${y}" r="1.1" fill="#64748b" fill-opacity="0.22" />\n`
  }
}
const dotsSvg = `<svg width="1280" height="640" xmlns="http://www.w3.org/2000/svg">${dots}</svg>`
fs.writeFileSync(path.join(tmpDir, 'dots.svg'), dotsSvg)
execSync(`magick -background none "${path.join(tmpDir, 'dots.svg')}" "${path.join(tmpDir, 'dots.png')}"`)

// 生成真实环境光晕
execSync(`magick -size 720x520 "radial-gradient:rgba(56,189,248,0.24)-none" "${path.join(tmpDir, 'glow_left.png')}"`)
execSync(`magick -size 920x640 "radial-gradient:rgba(14,165,233,0.20)-none" "${path.join(tmpDir, 'glow_right.png')}"`)
execSync(`magick -size 600x420 "radial-gradient:rgba(245,158,11,0.11)-none" "${path.join(tmpDir, 'glow_bottom.png')}"`)

// 合成完整背景
execSync(`magick "${path.join(tmpDir, 'bg_base.png')}" \\
  "${path.join(tmpDir, 'dots.png')}" -compose Over -composite \\
  "${path.join(tmpDir, 'glow_left.png')}" -geometry -100-80 -compose Over -composite \\
  "${path.join(tmpDir, 'glow_right.png')}" -geometry +460+0 -compose Over -composite \\
  "${path.join(tmpDir, 'glow_bottom.png')}" -geometry +20+340 -compose Over -composite \\
  "${path.join(tmpDir, 'bg_combined.png')}"`)

console.log('2. 处理右侧应用窗口截屏与立体多层阴影...')
const winW = 660
const winH = 493
const r = 14

execSync(`magick "src/assets/screen.png" -resize ${winW}x${winH}^ -gravity north -extent ${winW}x${winH} "${path.join(tmpDir, 'screen_resized.png')}"`)
execSync(`magick -size ${winW}x${winH} xc:black -fill white -draw "roundrectangle 0,0 ${winW - 1},${winH - 1} ${r},${r}" "${path.join(tmpDir, 'mask.png')}"`)
execSync(`magick "${path.join(tmpDir, 'screen_resized.png')}" "${path.join(tmpDir, 'mask.png')}" -alpha off -compose CopyOpacity -composite "${path.join(tmpDir, 'screen_rounded.png')}"`)

// 精致半透明高光边框
execSync(`magick "${path.join(tmpDir, 'screen_rounded.png')}" \\
  -stroke "rgba(255,255,255,0.24)" -strokewidth 1.2 -fill none \\
  -draw "roundrectangle 0,0 ${winW - 1},${winH - 1} ${r},${r}" "${path.join(tmpDir, 'window_bordered.png')}"`)

// 生成深度环境阴影
execSync(`magick "${path.join(tmpDir, 'window_bordered.png')}" \\
  \\( +clone -background "#000000" -shadow 75x25+0+20 \\) +swap -background none -layers merge +repage \\
  "${path.join(tmpDir, 'window_final.png')}"`)

console.log('3. 处理 Logo 图标与立体外发光...')
const logoSize = 72
execSync(`magick "build/icon.png" -resize ${logoSize}x${logoSize} "${path.join(tmpDir, 'logo.png')}"`)
execSync(`magick "${path.join(tmpDir, 'logo.png')}" \\
  \\( +clone -background "#38bdf8" -shadow 50x14+0+4 \\) +swap -background none -layers merge +repage \\
  "${path.join(tmpDir, 'logo_final.png')}"`)

console.log('4. 准备特性卡片、图标与装饰层...')
// 卡片采用磨砂深蓝半透明背景
execSync(`magick -size 1280x640 xc:none \\
  \\
  -stroke "rgba(56,189,248,0.4)" -strokewidth 1 -fill "rgba(2,132,199,0.22)" \\
  -draw "roundrectangle 346,76 414,100 12,12" \\
  -stroke "rgba(56,189,248,0.4)" -strokewidth 1 -fill "rgba(2,132,199,0.22)" \\
  -draw "roundrectangle 422,76 512,100 12,12" \\
  \\
  -stroke "rgba(56,189,248,0.3)" -strokewidth 1 -fill none \\
  -draw "line 60,218 510,218" \\
  \\
  -stroke "rgba(51,65,85,0.7)" -strokewidth 1 -fill "rgba(15,23,42,0.75)" \\
  -draw "roundrectangle 60,234 510,286 10,10" \\
  -stroke "rgba(56,189,248,0.5)" -strokewidth 1 -fill "rgba(2,132,199,0.55)" \\
  -draw "roundrectangle 72,244 104,276 7,7" \\
  -fill "#ffffff" -stroke none \\
  -draw "polygon 89,248 83,259 88,259 86,272 96,256 91,256" \\
  \\
  -stroke "rgba(51,65,85,0.7)" -strokewidth 1 -fill "rgba(15,23,42,0.75)" \\
  -draw "roundrectangle 60,296 510,348 10,10" \\
  -stroke "rgba(245,158,11,0.5)" -strokewidth 1 -fill "rgba(217,119,6,0.55)" \\
  -draw "roundrectangle 72,306 104,338 7,7" \\
  -fill "#ffffff" -stroke none \\
  -draw "polygon 85,313 85,331 97,322" \\
  \\
  -stroke "rgba(51,65,85,0.7)" -strokewidth 1 -fill "rgba(15,23,42,0.75)" \\
  -draw "roundrectangle 60,358 510,410 10,10" \\
  -stroke "rgba(16,185,129,0.5)" -strokewidth 1 -fill "rgba(5,150,105,0.55)" \\
  -draw "roundrectangle 72,368 104,400 7,7" \\
  -fill none -stroke "#ffffff" -strokewidth 1.6 \\
  -draw "circle 88,384 88,375" \\
  -draw "ellipse 88,384 4,9 0,360" \\
  -draw "line 79,384 97,384" \\
  \\
  -stroke "rgba(51,65,85,0.7)" -strokewidth 1 -fill "rgba(15,23,42,0.75)" \\
  -draw "roundrectangle 60,420 510,472 10,10" \\
  -stroke "rgba(168,85,247,0.5)" -strokewidth 1 -fill "rgba(124,58,237,0.55)" \\
  -draw "roundrectangle 72,430 104,462 7,7" \\
  -fill none -stroke "#ffffff" -strokewidth 1.6 \\
  -draw "roundrectangle 80,438 96,454 4,4" \\
  -draw "line 84,446 92,446" \\
  -draw "line 88,442 88,450" \\
  \\
  -stroke "rgba(51,65,85,0.6)" -strokewidth 1 -fill "rgba(15,23,42,0.65)" \\
  -draw "roundrectangle 60,496 510,542 8,8" \\
  -stroke "rgba(100,116,139,0.4)" -strokewidth 1 -fill "rgba(30,41,59,0.6)" \\
  -draw "roundrectangle 72,506 130,532 5,5" \\
  -draw "roundrectangle 136,506 200,532 5,5" \\
  -draw "roundrectangle 206,506 258,532 5,5" \\
  \\
  "${path.join(tmpDir, 'cards_layer.png')}"`)

console.log('5. 最终图层合成与字体排版...')
const finalCmd = `magick "${path.join(tmpDir, 'bg_combined.png')}" \\
  "${path.join(tmpDir, 'window_final.png')}" -geometry +540+50 -composite \\
  "${path.join(tmpDir, 'cards_layer.png')}" -composite \\
  "${path.join(tmpDir, 'logo_final.png')}" -geometry +52+48 -composite \\
  \\
  -font "${FONT_EN_BOLD}" -pointsize 44 -fill "#ffffff" -annotate +148+108 "DownVid" \\
  -font "${FONT_EN_BOLD}" -pointsize 11 -fill "#38bdf8" -annotate +357+93 "v1.3.3" \\
  -font "${FONT_CJK}" -pointsize 11 -fill "#7dd3fc" -annotate +430+93 "开源跨平台" \\
  \\
  -font "${FONT_CJK}" -pointsize 25 -fill "#ffffff" -annotate +60+168 "全平台桌面视频下载工具" \\
  -font "${FONT_CJK}" -pointsize 15 -fill "#94a3b8" -annotate +60+200 "把喜欢的视频，轻松保存到本地" \\
  \\
  -font "${FONT_CJK}" -pointsize 14 -fill "#7dd3fc" -annotate +116+256 "极速多线程加速" \\
  -font "${FONT_CJK}" -pointsize 12 -fill "#cbd5e1" -annotate +116+275 "多连接并发分块下载 · 智能断点续传 · 提速数倍" \\
  \\
  -font "${FONT_CJK}" -pointsize 14 -fill "#fcd34d" -annotate +116+318 "超清画质与音频提取" \\
  -font "${FONT_CJK}" -pointsize 12 -fill "#cbd5e1" -annotate +116+337 "最高 4K 超清 · 独立 MP3 提取 · SRT 独立字幕" \\
  \\
  -font "${FONT_CJK}" -pointsize 14 -fill "#6ee7b7" -annotate +116+380 "支持 1000+ 视频网站" \\
  -font "${FONT_CJK}" -pointsize 12 -fill "#cbd5e1" -annotate +116+399 "YouTube · 抖音 · B站 · 快手 · 小红书 · X 等" \\
  \\
  -font "${FONT_CJK}" -pointsize 14 -fill "#d8b4fe" -annotate +116+442 "浏览器免登 & 依赖托管" \\
  -font "${FONT_CJK}" -pointsize 12 -fill "#cbd5e1" -annotate +116+461 "一键读取本地浏览器 Cookie · 自动探测与管理依赖" \\
  \\
  -font "${FONT_EN_BOLD}" -pointsize 10 -fill "#cbd5e1" -annotate +80+524 "macOS" \\
  -font "${FONT_EN_BOLD}" -pointsize 10 -fill "#cbd5e1" -annotate +143+524 "Windows" \\
  -font "${FONT_EN_BOLD}" -pointsize 10 -fill "#cbd5e1" -annotate +218+524 "Linux" \\
  -font "${FONT_CJK}" -pointsize 11 -fill "#94a3b8" -annotate +276+524 "基于 yt-dlp & FFmpeg 引擎驱动 · MIT 协议" \\
  \\
  "${outputFile}"`

execSync(finalCmd)

const stat = fs.statSync(outputFile)
console.log('✅ 最终合成成功:', outputFile)
console.log('文件大小:', (stat.size / 1024).toFixed(1), 'KB')

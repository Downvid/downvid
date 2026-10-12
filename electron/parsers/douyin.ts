import fs from 'node:fs'
import { getSharedBrowser, scheduleBrowserClose } from '../utils/browser'
import {
  buildCookieHeader,
  DOUYIN_COOKIE_DOMAINS,
  estimateFileSize,
  parseCookiesFile,
} from './shared'

// 从 bit_rate 构建格式列表
function buildFormatsFromBitRate(bitRate: any[], duration: number): any[] {
  const qualityMap = new Map<string, any>()

  if (bitRate && bitRate.length > 0) {
    bitRate.forEach((br: any, index: number) => {
      if (br.play_addr?.url_list[0]) {
        let quality = '默认'
        let qualityKey = 'default'
        let height = br.height || 0

        // 优先级：height > gear_name 提取数字 > gear_name 原文
        if (height > 0) {
          quality = `${height}P`
          qualityKey = String(height)
        } else if (br.gear_name) {
          const match = br.gear_name.match(/(\d+)/)
          if (match) {
            quality = `${match[1]}P`
            qualityKey = match[1]
            height = parseInt(match[1])
          } else {
            // 中文 gear_name 映射到常见分辨率
            const gearMap: Record<string, string> = {
              '超清': '1080P',
              '高清': '720P',
              '标清': '480P',
              '流畅': '360P',
              '4K': '2160P',
              '2K': '1440P',
            }
            quality = gearMap[br.gear_name] || br.gear_name
            qualityKey = br.gear_name
          }
        }

        let filesize = br.data_size || 0
        if (!filesize && duration) {
          filesize = estimateFileSize(height, duration)
        }

        const existing = qualityMap.get(qualityKey)
        if (!existing || filesize > existing.filesize) {
          qualityMap.set(qualityKey, {
            formatId: `hd_${index}`,
            quality,
            ext: 'mp4',
            filesize,
            width: br.width || 0,
            height,
            fps: br.fps || 30,
            hasAudio: true,
            url: br.play_addr.url_list[0],
          })
        }
      }
    })
  }

  return Array.from(qualityMap.values())
    .filter(f => f.url)
    .sort((a, b) => (b.height || 0) - (a.height || 0))
}

// 使用直接 API 调用快速解析抖音视频
export async function parseDouyinWithAPI(url: string, cookiesFile?: string): Promise<any> {
  let videoId: string | null = null

  // 解析 cookies
  const cookies = cookiesFile && fs.existsSync(cookiesFile) ? parseCookiesFile(cookiesFile) : []
  const cookieHeader = buildCookieHeader(cookies, DOUYIN_COOKIE_DOMAINS)

  const videoMatch = url.match(/\/video\/(\d+)/)
  if (videoMatch) {
    videoId = videoMatch[1]
  }

  if (!videoId) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
        },
      })
      const redirectedUrl = response.url
      const newVideoMatch = redirectedUrl.match(/\/video\/(\d+)/)
      if (newVideoMatch) videoId = newVideoMatch[1]
    } catch {}
  }

  if (!videoId) throw new Error('无法从 URL 提取视频 ID')

  const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}&aid=6383&channel=channel_pc_web&detail_list=1`
  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.douyin.com/',
      'Accept': 'application/json',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
    },
  })

  const data = await response.json()
  if (!data.aweme_detail) throw new Error('API 解析失败')

  const detail = data.aweme_detail
  const video = detail.video
  let formats = buildFormatsFromBitRate(video.bit_rate, video.duration)

  if (formats.length === 0 && video.play_addr) {
    const playAddr = video.play_addr
    let filesize = playAddr.data_size || 0
    if (!filesize && video.duration) filesize = estimateFileSize(playAddr.height || 720, video.duration)

    formats = [{
      formatId: 'normal',
      quality: '默认',
      ext: 'mp4',
      filesize,
      width: playAddr.width || 0,
      height: playAddr.height || 0,
      fps: 30,
      hasAudio: true,
      url: playAddr.url_list[0],
    }]
  }

  return {
    id: detail.aweme_id,
    title: detail.desc || '抖音视频',
    description: detail.desc,
    thumbnail: detail.video?.cover?.url_list[0] || detail.video?.dynamic_cover?.url_list[0] || '',
    duration: detail.video?.duration ? Math.floor(detail.video.duration / 1000) : 0,
    uploader: detail.author?.nickname || '',
    webpageUrl: url,
    formats,
  }
}

// 使用无头浏览器解析抖音视频
export async function parseDouyinWithPuppeteer(url: string, cookiesFile?: string): Promise<any> {
  const browser = await getSharedBrowser()

  // 解析 cookies 并转换为 Puppeteer 格式
  const cookies = cookiesFile && fs.existsSync(cookiesFile) ? parseCookiesFile(cookiesFile) : []
  const puppeteerCookies = cookies
    .filter(c => c.domain.includes('douyin.com') || c.domain.includes('iesdouyin.com') || c.domain.includes('snssdk.com'))
    .map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      expires: c.expiry > 0 ? c.expiry : -1,
    }))

  let page: any = null
  try {
    page = await browser.newPage()
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    await page.setViewport({ width: 1920, height: 1080 })

    let videoData: any = null
    let renderData: any = null

    await page.setRequestInterception(true)
    page.on('request', (request: any) => request.continue())

    page.on('response', async (response: any) => {
      const resUrl = response.url()
      if (resUrl.includes('/aweme/v1/web/aweme/detail/') ||
          resUrl.includes('/aweme/v1/aweme/detail/') ||
          resUrl.includes('/aweme/v1/multi/aweme/detail/')) {
        try { videoData = await response.json() } catch {}
      }
    })

    // 先访问视频页面，然后设置 cookies，再刷新（避免额外访问首页）
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })

    if (puppeteerCookies.length > 0) {
      try {
        await page.setCookie(...puppeteerCookies)
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
      } catch {}
    }

    // 等待页面渲染数据
    await new Promise(resolve => setTimeout(resolve, 1500))

    renderData = await page.evaluate(() => {
      const ssrData = (window as any)._SSR_HYDRATED_DATA
      if (ssrData) return { source: '_SSR_HYDRATED_DATA', data: ssrData }
      const initialState = (window as any).__INITIAL_STATE__
      if (initialState) return { source: '__INITIAL_STATE__', data: initialState }
      for (const script of document.querySelectorAll('script')) {
        const text = script.textContent || ''
        let match = text.match(/window\._SSR_HYDRATED_DATA\s*=\s*({[\s\S]+?});?\s*$/m)
        if (match) { try { return { source: 'script_SSR', data: JSON.parse(match[1]) } } catch {} }
        match = text.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]+?});?\s*$/m)
        if (match) { try { return { source: 'script_INITIAL', data: JSON.parse(match[1]) } } catch {} }
      }
      return null
    })

    const detailData = videoData?.aweme_detail ||
                       renderData?.data?.aweme?.aweme_detail ||
                       renderData?.data?.app?.aweme_detail ||
                       renderData?.data?.aweme_detail

    let videoInfo: any = null

    if (detailData) {
      const detail = detailData
      const video = detail.video
      const formats = buildFormatsFromBitRate(video.bit_rate, video.duration)

      videoInfo = {
        id: detail.aweme_id,
        title: detail.desc || '抖音视频',
        description: detail.desc,
        thumbnail: detail.video?.cover?.url_list[0] || detail.video?.dynamic_cover?.url_list[0] || '',
        duration: detail.video?.duration ? Math.floor(detail.video.duration / 1000) : 0,
        uploader: detail.author?.nickname || '',
        webpageUrl: url,
        formats,
      }
    } else {
      videoInfo = await page.evaluate(() => {
        const videoEl = document.querySelector('video') as HTMLVideoElement
        const titleEl = document.querySelector('[data-e2e="video-desc"]') || document.querySelector('.title') || document.querySelector('h1')
        const authorEl = document.querySelector('[data-e2e="video-author"]') || document.querySelector('[data-e2e="user-name"]')
        let videoSrc = videoEl?.src || videoEl?.querySelector('source')?.src
        return {
          id: Date.now().toString(),
          title: titleEl?.textContent?.trim() || '抖音视频',
          description: titleEl?.textContent?.trim() || '',
          thumbnail: '',
          duration: videoEl?.duration || 0,
          uploader: authorEl?.textContent?.trim() || '',
          webpageUrl: window.location.href,
          formats: videoSrc ? [{ formatId: 'default', quality: '默认', ext: 'mp4', filesize: 0, width: 0, height: 0, fps: 30, hasAudio: true, url: videoSrc }] : [],
        }
      })
    }

    if (!videoInfo || videoInfo.formats.length === 0) {
      throw new Error('无法获取视频信息，请检查链接是否有效')
    }

    return videoInfo
  } finally {
    if (page) await page.close().catch(() => {})
    scheduleBrowserClose()
  }
}

import { getSharedBrowser, scheduleBrowserClose } from '../utils/browser'
import { estimateFileSize } from './shared'

// 估算文件大小
// 通过视频 ID 查询快手 GraphQL API
export async function queryKuaishouVideoById(videoId: string): Promise<any> {
  const query = {
    operationName: 'VisionVideoDetail',
    variables: { photoId: videoId },
    query: `query VisionVideoDetail($photoId: String!) {
      visionVideoDetail(photoId: $photoId) {
        status
        photo {
          id
          duration
          caption
          likeCount
          viewCount
          realLikeCount
          coverUrl
          photoUrl
          photoH265Url
          manifest {
            version
            businessType
            mediaType
            adaptationSet {
              id
              duration
              representation {
                id
                url
                width
                height
                avgBitrate
                size
                type
              }
            }
          }
        }
        llsid
      }
    }`,
  }

  const response = await fetch('https://www.kuaishou.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: JSON.stringify(query),
  })

  const result = await response.json()
  if (result?.data?.visionVideoDetail?.photo) {
    const photo = result.data.visionVideoDetail.photo
    const formats: any[] = []

    const adaptationSet = photo.manifest?.adaptationSet
    if (adaptationSet?.representation) {
      adaptationSet.representation.forEach((rep: any, index: number) => {
        if (rep.url) {
          let filesize = rep.size || 0
          if (!filesize && photo.duration && rep.avgBitrate) {
            filesize = Math.floor((rep.avgBitrate * photo.duration) / 1000 / 8)
          } else if (!filesize && photo.duration) {
            filesize = estimateFileSize(rep.height || 720, photo.duration)
          }
          formats.push({
            formatId: `ks_${index}`,
            quality: `${rep.height}p`,
            ext: 'mp4',
            filesize,
            width: rep.width || 0,
            height: rep.height || 0,
            fps: 30,
            hasAudio: true,
            url: rep.url,
          })
        }
      })
    }

    if (formats.length === 0 && photo.photoUrl) {
      let filesize = 0
      if (photo.duration) filesize = estimateFileSize(720, photo.duration)
      formats.push({
        formatId: 'default',
        quality: '默认',
        ext: 'mp4',
        filesize,
        width: 0,
        height: 0,
        fps: 30,
        hasAudio: true,
        url: photo.photoUrl,
      })
    }

    formats.sort((a, b) => (b.height || 0) - (a.height || 0))

    return {
      id: photo.id,
      title: photo.caption || '快手视频',
      description: photo.caption,
      thumbnail: photo.coverUrl || '',
      duration: photo.duration ? Math.floor(photo.duration / 1000) : 0,
      uploader: '',
      webpageUrl: `https://www.kuaishou.com/short-video/${videoId}`,
      formats,
    }
  }

  throw new Error('API 解析失败')
}

// 使用直接 API 调用快速解析快手视频
export async function parseKuaishouWithAPI(url: string): Promise<any> {
  let videoId: string | null = null
  let shortCode: string | null = null

  const shortVideoMatch = url.match(/\/short-video\/([^?&#]+)/)
  if (shortVideoMatch) videoId = shortVideoMatch[1]

  const shortLinkMatch = url.match(/\/f\/([^?&#]+)/)
  if (shortLinkMatch) shortCode = shortLinkMatch[1]

  if (shortCode && !videoId) {
    try {
      const fullUrl = `https://www.kuaishou.com/f/${shortCode}`
      const response = await fetch(fullUrl, {
        redirect: 'follow',
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      })
      const redirectedUrl = response.url
      const newVideoMatch = redirectedUrl.match(/\/short-video\/([^?&#]+)/)
      if (newVideoMatch) videoId = newVideoMatch[1]
      if (videoId) return await queryKuaishouVideoById(videoId)
    } catch {}
  }

  if (videoId) return await queryKuaishouVideoById(videoId)

  throw new Error('无法从 URL 提取视频 ID')
}

// 使用无头浏览器解析快手视频
export async function parseKuaishouWithPuppeteer(url: string): Promise<any> {
  const browser = await getSharedBrowser()

  let page: any = null
  try {
    page = await browser.newPage()
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    await page.setViewport({ width: 1920, height: 1080 })

    let videoData: any = null
    let renderData: any = null
    let finalUrl = url

    await page.setRequestInterception(true)
    page.on('request', (request: any) => request.continue())

    page.on('response', async (response: any) => {
      const resUrl = response.url()
      if (resUrl.includes('/graphql') || resUrl.includes('/rest/wd/photo/info') || resUrl.includes('/rest/wd/photo/detail')) {
        try {
          const data = await response.json()
          if (data?.data?.visionVideoDetail || data?.data?.videoDetail || data?.data?.photo) {
            videoData = data
          }
        } catch {}
      }
    })

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    try { await page.waitForSelector('video', { timeout: 5000 }) } catch {}

    try {
      await page.evaluate(() => window.scrollTo(0, 200))
      await new Promise(resolve => setTimeout(resolve, 1000))
      await page.evaluate(() => window.scrollTo(0, 0))
      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch {}

    await new Promise(resolve => setTimeout(resolve, 2000))
    finalUrl = page.url()

    const videoIdMatch = finalUrl.match(/\/short-video\/([^?&#]+)/) || url.match(/\/short-video\/([^?&#]+)/)
    const videoId = videoIdMatch ? videoIdMatch[1] : null

    if (videoId) {
      try {
        const graphqlQuery = {
          operationName: 'VisionVideoDetail',
          variables: { photoId: videoId },
          query: `query VisionVideoDetail($photoId: String!) {
            visionVideoDetail(photoId: $photoId) {
              status
              photo { id duration caption coverUrl photoUrl manifest { version adaptationSet { id duration } } }
              llsid
            }
          }`,
        }
        const response = await page.evaluate(async (query: any) => {
          const res = await fetch('https://www.kuaishou.com/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(query),
          })
          return await res.json()
        }, graphqlQuery)
        if (response?.data?.visionVideoDetail?.photo) videoData = response
      } catch {}
    }

    renderData = await page.evaluate(() => {
      const initialState = (window as any).__INITIAL_STATE__
      if (initialState) return { source: '__INITIAL_STATE__', data: initialState }
      const apolloState = (window as any).__APOLLO_STATE__
      if (apolloState) return { source: '__APOLLO_STATE__', data: apolloState }
      const windowData = (window as any).__DATA__
      if (windowData) return { source: '__DATA__', data: windowData }
      const ksData = (window as any).KS_DATA
      if (ksData) return { source: 'KS_DATA', data: ksData }
      for (const script of document.querySelectorAll('script')) {
        const text = script.textContent || ''
        let match = text.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]+?});?\s*$/m)
        if (match) { try { return { source: 'script_INITIAL', data: JSON.parse(match[1]) } } catch {} }
        match = text.match(/window\.__APOLLO_STATE__\s*=\s*({[\s\S]+?});?\s*$/m)
        if (match) { try { return { source: 'script_APOLLO', data: JSON.parse(match[1]) } } catch {} }
      }
      return null
    })

    let detailData = videoData?.data?.visionVideoDetail?.photo ||
                     videoData?.data?.videoDetail?.photo ||
                     videoData?.data?.photo ||
                     videoData?.data?.visionVideoDetail ||
                     videoData?.data?.videoDetail

    // 处理 visionShortVideoReco.feeds
    if (!detailData && videoData?.data?.visionShortVideoReco?.feeds) {
      const feeds = videoData.data.visionShortVideoReco.feeds
      let targetVideoId: string | null = null

      for (const checkUrl of [finalUrl, url, page.url()]) {
        const shortMatch = checkUrl.match(/\/short-video\/([^?&#/]+)/)
        if (shortMatch) { targetVideoId = shortMatch[1]; break }
        const shareMatch = checkUrl.match(/shareToken=([^&#]+)/)
        if (shareMatch) { targetVideoId = shareMatch[1]; break }
        const shareIdMatch = checkUrl.match(/shareId=([^&#]+)/)
        if (shareIdMatch) { targetVideoId = shareIdMatch[1]; break }
        const objectIdMatch = checkUrl.match(/objectId=([^&#]+)/)
        if (objectIdMatch) { targetVideoId = objectIdMatch[1]; break }
      }

      for (const feed of feeds) {
        if (feed.photo?.id === targetVideoId || (targetVideoId && feed.photo?.caption?.includes(targetVideoId))) {
          detailData = feed.photo
          break
        }
      }
    }

    // 从 renderData 获取
    if (detailData?.photoUrl || detailData?.manifest || detailData?.mvUrls) {
      // 已有有效数据
    } else if (renderData?.data?.defaultClient) {
      for (const key of Object.keys(renderData.data.defaultClient)) {
        const item = renderData.data.defaultClient[key]
        if (item?.manifest || item?.mvUrls || item?.photoUrl) {
          detailData = item
          break
        }
      }
    }

    let videoInfo: any = null

    if (detailData) {
      const photo = detailData
      const formats: any[] = []

      let manifestData = photo.manifest
      if (photo.manifest?.id && renderData?.data?.defaultClient?.[photo.manifest.id]) {
        manifestData = renderData.data.defaultClient[photo.manifest.id]
      }

      let adaptationSet = manifestData?.adaptationSet
      if (Array.isArray(adaptationSet) && adaptationSet[0]?.id && renderData?.data?.defaultClient?.[adaptationSet[0].id]) {
        adaptationSet = renderData.data.defaultClient[adaptationSet[0].id]
      }

      if (adaptationSet?.representation) {
        let representations = adaptationSet.representation
        if (Array.isArray(representations) && representations[0]?.type === 'id') {
          representations = representations.map((ref: any) => ref?.id && renderData?.data?.defaultClient?.[ref.id] ? renderData.data.defaultClient[ref.id] : ref)
        }
        representations.forEach((rep: any, index: number) => {
          if (rep.url) {
            let filesize = rep.size || rep.fileSize || 0
            if (!filesize && photo.duration) {
              filesize = rep.avgBitrate
                ? Math.floor((rep.avgBitrate * photo.duration) / 1000 / 8)
                : estimateFileSize(rep.height || 720, photo.duration)
            }
            formats.push({
              formatId: `ks_${index}`,
              quality: `${rep.height}p`,
              ext: 'mp4',
              filesize,
              width: rep.width || 0,
              height: rep.height || 0,
              fps: rep.frameRate || 30,
              hasAudio: true,
              url: rep.url,
            })
          }
        })
      }

      if (photo.mvUrls && Array.isArray(photo.mvUrls)) {
        photo.mvUrls.forEach((mv: any, index: number) => {
          if (mv.url) {
            let filesize = mv.size || 0
            if (!filesize && photo.duration) filesize = estimateFileSize(mv.height || 720, photo.duration)
            formats.push({
              formatId: `ks_mv_${index}`,
              quality: mv.quality || '默认',
              ext: 'mp4',
              filesize,
              width: mv.width || 0,
              height: mv.height || 0,
              fps: 30,
              hasAudio: true,
              url: mv.url,
            })
          }
        })
      }

      if (formats.length === 0 && photo.mainMvUrls?.[0]?.url) {
        let filesize = photo.mainMvUrls[0].size || photo.size || 0
        if (!filesize && photo.duration) filesize = estimateFileSize(photo.mainMvUrls[0].height || photo.height || 720, photo.duration)
        formats.push({
          formatId: 'default',
          quality: '默认',
          ext: 'mp4',
          filesize,
          width: photo.mainMvUrls[0].width || photo.width || 0,
          height: photo.mainMvUrls[0].height || photo.height || 0,
          fps: 30,
          hasAudio: true,
          url: photo.mainMvUrls[0].url,
        })
      }

      if (formats.length === 0 && photo.photoUrl) {
        let filesize = photo.size || 0
        if (!filesize && photo.duration) filesize = estimateFileSize(photo.height || 720, photo.duration)
        formats.push({
          formatId: 'default',
          quality: '默认',
          ext: 'mp4',
          filesize,
          width: photo.width || 0,
          height: photo.height || 0,
          fps: 30,
          hasAudio: true,
          url: photo.photoUrl,
        })
      }

      formats.sort((a, b) => (b.height || 0) - (a.height || 0))

      videoInfo = {
        id: photo.photoId || photo.id || Date.now().toString(),
        title: photo.caption || '快手视频',
        description: photo.caption,
        thumbnail: photo.coverUrls?.[0]?.url || photo.coverUrl || '',
        duration: photo.duration ? Math.floor(photo.duration / 1000) : 0,
        uploader: photo.userName || photo.authorName || '',
        webpageUrl: finalUrl,
        formats,
      }
    } else {
      // DOM fallback
      await page.evaluate(async () => {
        window.scrollTo(0, document.body.scrollHeight)
        await new Promise(r => setTimeout(r, 1000))
        window.scrollTo(0, 0)
        await new Promise(r => setTimeout(r, 1000))
        const videoContainer = document.querySelector('.video-container') || document.querySelector('video')
        if (videoContainer) { (videoContainer as HTMLElement).click(); await new Promise(r => setTimeout(r, 2000)) }
      })

      await new Promise(resolve => setTimeout(resolve, 3000))

      videoInfo = await page.evaluate(() => {
        const titleEl = document.querySelector('.video-title') || document.querySelector('[class*="title"]') || document.querySelector('h1')
        const authorEl = document.querySelector('.user-name') || document.querySelector('[class*="author"]')
        const videoEl = document.querySelector('video') as HTMLVideoElement
        let videoSrc = videoEl?.src || videoEl?.currentSrc || videoEl?.querySelector('source')?.src
        return {
          id: Date.now().toString(),
          title: titleEl?.textContent?.trim() || '快手视频',
          description: titleEl?.textContent?.trim() || '',
          thumbnail: videoEl?.poster || '',
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

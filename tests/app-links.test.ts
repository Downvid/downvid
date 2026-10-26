import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { APP, CONTACT_EMAIL, REPO_SLUG, WEBSITE_URL, contactMailto } from '../shared/app'

/**
 * 外部链接与联系方式的**唯一来源**契约（shared/app.ts）。
 *
 * 这些地址散落在界面、README、文档与官网里，任一处写错都**不会报错**：
 * 官网域名写错是一个 404，邮箱写错是一封永远寄不到的信，而且都要等用户来反馈
 * 才知道。所以这里把「谁引用了它」钉住。
 *
 * 只断言客观事实（地址一致、出现位置存在），不校验措辞。
 */

const ROOT = path.resolve(import.meta.dirname, '..')
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

describe('官网地址', () => {
  it('shared/app.ts 里是 https 的裸域名（不带尾斜杠）', () => {
    // 尾斜杠会让拼接出的子路径变成双斜杠；带路径的域名则说明写错了地方
    expect(WEBSITE_URL).toMatch(/^https:\/\/[a-z0-9.-]+$/)
  })

  it('website/README.md 记录的部署域名与它一致', () => {
    // 换域名时最容易漏的就是文档：README 里还写着旧域名，读者点进去是 404
    expect(read('website/README.md')).toContain(WEBSITE_URL)
  })

  it('各个 README 的导航行都指向它', () => {
    for (const file of ['README.md', 'README.zh-CN.md', 'README.en.md']) {
      expect(read(file), `${file} 的导航行`).toContain(WEBSITE_URL)
    }
  })

  it('关于页用的是共享常量，而不是自己拼一个地址', () => {
    const about = read('app/frontend/src/components/AboutView.svelte')
    expect(about).toContain('WEBSITE_URL')
    // 硬编码的域名不会随常量一起更新
    expect(about).not.toMatch(/https:\/\/downvid-[a-z]+\.vercel\.app/)
  })
})

describe('商务合作 / 赞助邮箱', () => {
  it('是一个可用的邮箱地址', () => {
    expect(CONTACT_EMAIL).toMatch(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i)
  })

  it('contactMailto 生成 mailto 且主题经过编码', () => {
    const url = contactMailto({ subject: '[DownVid] 赞助 / Sponsor' })
    expect(url.startsWith(`mailto:${CONTACT_EMAIL}?`)).toBe(true)
    // 方括号与中文都必须编码，否则部分邮件客户端会截断主题
    expect(url).toContain('subject=%5BDownVid%5D+')
    expect(url).not.toContain('[')
    expect(url).not.toContain(' ')
    // 能被 URLSearchParams 还原
    const subject = new URLSearchParams(url.slice(url.indexOf('?'))).get('subject')
    expect(subject).toBe('[DownVid] 赞助 / Sponsor')
  })

  it('各个 README 都写出了邮箱与两类入口', () => {
    for (const file of ['README.md', 'README.zh-CN.md', 'README.en.md']) {
      const text = read(file)
      expect(text, `${file} 应写明邮箱`).toContain(CONTACT_EMAIL)
      // 两类入口（赞助 / 商务）各一条主题；导航行与正文小节会各出现一次，
      // 所以要求的是**主题去重后至少两类**，而不是出现次数唯一
      const mails = [...text.matchAll(/mailto:xynrin@icloud\.com\?subject=([^\s"')]+)/g)].map((m) => m[1])
      expect(mails.length, `${file} 应有赞助与商务两条 mailto`).toBeGreaterThanOrEqual(2)
      expect(new Set(mails).size, '赞助与商务必须是两个不同的主题').toBeGreaterThanOrEqual(2)
      // 主题必须编码，否则部分邮件客户端会截断
      for (const subject of mails) expect(subject, `${file} 的主题应已编码`).not.toMatch(/[\[\] ]/)
    }
  })

  it('商务合作在 README 里靠前（不是埋在文末）', () => {
    // 需求是「放前面点」：原先埋在「开源协议与致谢」下的四级子节里，基本没人滑到底。
    // 断言**顺序**而不是行号或百分比：后两者都会随无关编辑漂移，
    // 而「在 FAQ / 参与贡献 / 协议之前」才是这条需求的真实含义。
    const cases: [string, string[]][] = [
      ['README.md', ['## 常见问题', '## 参与贡献', '## 开源协议与致谢']],
      ['README.zh-CN.md', ['## 常见问题', '## 参与贡献', '## 开源协议与致谢']],
      ['README.en.md', ['## FAQ', '## Contributing', '## License and credits']],
    ]
    for (const [file, laterSections] of cases) {
      const text = read(file)
      const heading = /^## (?:Sponsorship and business|赞助与商务合作)$/m.exec(text)
      expect(heading, `${file} 应有独立的赞助与商务合作章节`).not.toBeNull()
      for (const later of laterSections) {
        const at = text.indexOf(later)
        expect(at, `${file} 里找不到章节 ${later}`).toBeGreaterThan(0)
        expect(heading!.index, `${file}: 商务合作应排在「${later}」之前`).toBeLessThan(at)
      }
    }
  })

  it('官网也提供邮箱入口，且主题按语言切换', () => {
    const site = read('website/index.html') + '\n' + read('website/app.js')
    expect(site).toContain(`mailto:${CONTACT_EMAIL}`)
    // 主题写死中文时，英文用户点开会收到一封中文主题的邮件——收件箱里无法归类
    expect(site).toMatch(/data-i18n-subject="sponsor\.subject\./)
    expect(site).toMatch(/sponsor\.subject\.tip': '\[DownVid\] Sponsorship'/)
  })

  it('关于页也提供邮箱入口，且用的是共享常量', () => {
    const about = read('app/frontend/src/components/AboutView.svelte')
    expect(about).toContain('CONTACT_EMAIL')
    expect(about).toContain('contactMailto')
    expect(about).not.toMatch(/xynrin@(?!icloud)/)
  })

  it('README 里区分了「软件内无广告」与项目层面的合作', () => {
    // README.zh-CN 的卖点里写着「无任何弹窗广告、无捆绑插件」。
    // 加了广告位合作入口却不作区分，读者会以为要往安装包里塞广告——
    // 那是与既有承诺直接冲突的表述，必须显式说明谈的是项目层面的展示位。
    expect(read('README.md')).toMatch(/不含任何广告/)
    expect(read('README.zh-CN.md')).toMatch(/不含任何广告/)
    expect(read('README.en.md')).toMatch(/contains no ads|no ads and never will/i)
  })
})

describe('仓库坐标', () => {
  it('拼接形式与字段形式一致（lint:sync:repo 也查，这里再兜一层）', () => {
    expect(REPO_SLUG).toBe(`${APP.owner}/${APP.repo}`)
    expect(read('shared/app.ts')).toContain(`owner: '${APP.owner}'`)
    expect(read('shared/app.ts')).toContain(`repo: '${APP.repo}'`)
  })
})

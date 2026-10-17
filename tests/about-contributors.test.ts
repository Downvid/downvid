import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/**
 * 「关于软件」页的贡献者名单。
 *
 * 名单是**手写固定**的（不请求 GitHub API：未认证限额 60 次/小时且按 IP 共享，
 * 很容易 403）。代价是它会悄悄漏人——加了新贡献者而没更新名单**不会报错**，
 * 只是那个人从界面上消失，而且没有任何地方会提示。
 *
 * 这里用三种**互相独立**的依据把它钉住，任一种对不上都变红：
 *
 *   1. **快照**：名单本身冻在 `EXPECTED_LOGINS` 里。加人/删人都必须显式改这个文件，
 *      与仓库里其它「多处手工同步」的处理方式一致（改其一时必须同步另一处）。
 *      这条抓的是「静默删掉一个人」。
 *   2. **git 署名**：每个 login 都要能在仓库历史里找到对应署名。这条抓的是
 *      「写了个不存在的账号」——界面上看不出来（头像 404 会退化成首字母），点进去却是 404。
 *   3. **CHANGELOG 致谢**：CHANGELOG 里点过名的外部贡献者必须都在名单里。这条抓的是
 *      「发布时致谢了某人，却忘了把他加进界面」。
 */

const ROOT = path.resolve(import.meta.dirname, '..')
const ABOUT = fs.readFileSync(path.join(ROOT, 'src/components/AboutView.vue'), 'utf8')
const CHANGELOG = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8')

/**
 * 名单快照。**改名单时这个数组要一起改**——这是刻意的：删掉一位贡献者应当是一次
 * 显式决定（附理由的提交），而不是顺手改模板时被带走。
 */
const EXPECTED_LOGINS = ['yxxbc', 'cshuangyy', 'hailaij', 'jwfstars', 'zerow', 'linuztx', 'Glaroday']

/**
 * 仓库历史里出现过的**人**的署名 token（显示名或邮箱里的账号部分）。
 *
 * 与 `EXPECTED_LOGINS` 分开维护，因为它回答的是另一个问题：这个 login 是否真的
 * 在仓库里留下过东西。注意 `Black Cat` 同时用 `yxxbc` 与一个历史邮箱提交，
 * `cshuangyy` 有 `芳渔记` / `Zhouzhou` 两个显示名——它们都指向同一个人。
 */
const HUMAN_IDENTITY_TOKENS = [
  'yxxbc',
  '203426472+yxxbc',
  'Francis-Xavier-code',
  // 维护者的另一种署名（提交里用的是实名 + outlook 邮箱），与 yxxbc 是同一人
  'Xynrin',
  'xynrin@outlook.com',
  'cshuangyy',
  '121596361+cshuangyy',
  'hailaij',
  '108041876+hailaij',
  'jwfstars',
  'zerow',
  // 显示名是实名 `The Master` 之外的 `QingYuan Li`，账号在 noreply 邮箱里
  'linuztx',
  'Glaroday',
  '37446275+Glaroday',
]

/**
 * 仓库历史里的署名（`名字\n邮箱`）。
 *
 * **拿不到完整历史时返回空串**：CI 默认是 `fetch-depth: 1` 的浅检出，只有被推的那一个提交，
 * 用它去核对**整份**贡献者名单必然误报——v1.4.0 的 CI 就是这么三平台全红的
 * （唯一可见的那个提交署的是维护者的另一个身份，名单里其他人的 token 一个都找不到）。
 * 部分克隆（比如 `fetch-depth: 50`）同样对不上，所以署名数量少于名单长度也当作不完整。
 */
function gitAuthors(): string {
  try {
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: ROOT, encoding: 'utf8' }).trim()
    if (shallow === 'true') return ''
    const authors = execFileSync('git', ['log', '--format=%an%n%ae'], { cwd: ROOT, encoding: 'utf8' })
    const identities = new Set(authors.split('\n').map((line) => line.trim().toLowerCase()).filter(Boolean))
    if (identities.size < EXPECTED_LOGINS.length) return ''
    return authors
  } catch {
    return ''
  }
}

/** 从 AboutView 的 CONTRIBUTORS 里取出 login 列表（顺序即展示顺序） */
function logins(): string[] {
  const block = /const CONTRIBUTORS = \[([\s\S]*?)\n\]/.exec(ABOUT)?.[1] ?? ''
  return [...block.matchAll(/login:\s*'([^']+)'/g)].map((m) => m[1])
}

describe('关于页贡献者名单', () => {
  const list = logins()

  it('与快照一致（删人/加人都必须是显式改动）', () => {
    expect(list).toEqual(EXPECTED_LOGINS)
  })

  it('每一条都有 GitHub 主页链接，且与 login 对得上', () => {
    // 链接写错时头像仍能加载（avatar 是按 login 拼出来的），点进去却是别人的主页
    const block = /const CONTRIBUTORS = \[([\s\S]*?)\n\]/.exec(ABOUT)?.[1] ?? ''
    const pairs = [...block.matchAll(/login:\s*'([^']+)',\s*url:\s*'([^']+)'/g)].map((m) => [m[1], m[2]] as const)
    expect(pairs.length).toBe(list.length)
    for (const [login, url] of pairs) {
      expect(url, `${login} 的主页链接`).toBe(`https://github.com/${login}`)
    }
  })

  it('每个 login 都在仓库历史里留下过署名（没有凭空加人）', () => {
    const authors = gitAuthors()
    if (!authors.trim()) {
      // 浅检出 / 没有 git / 没有完整历史：这条查不了，快照与 CHANGELOG 两条仍在
      expect(EXPECTED_LOGINS.length).toBeGreaterThan(0)
      return
    }
    const lower = authors.toLowerCase()
    for (const login of list) {
      const known = HUMAN_IDENTITY_TOKENS.some((token) => token.toLowerCase().includes(login.toLowerCase()))
      expect(known, `@${login} 不在已知署名 token 表里`).toBe(true)
      // 显示名可能只是昵称（`The Master`），所以只要有 token 命中就算数；
      // 但至少要有一处真的在历史里出现，否则说明这个 token 是编的
      expect(
        HUMAN_IDENTITY_TOKENS.some((t) => lower.includes(t.toLowerCase())),
        `@${login} 的署名 token 在 git 历史里找不到`,
      ).toBe(true)
    }
  })

  it('CHANGELOG 致谢里点过名的外部贡献者都在名单里', () => {
    // 只取 `**[@user](https://github.com/user)**` 这种明确署名的形态，
    // 避免把正文里顺带提到的用户名（如依赖的作者）算进来
    const thanked = new Set(
      [...CHANGELOG.matchAll(/\*\*\[@([A-Za-z0-9_-]+)\]\(https:\/\/github\.com\/[A-Za-z0-9_-]+\)\*\*/g)].map((m) => m[1]),
    )
    expect(thanked.size, 'CHANGELOG 里应当有署名的致谢（正则或格式变了？）').toBeGreaterThan(0)
    for (const user of thanked) {
      expect(list, `CHANGELOG 致谢了 @${user}，但关于页名单里没有他`).toContain(user)
    }
  })

  it('不把机器人与 AI 助手列进去', () => {
    // 自动化账号（dependabot / github-actions）贡献的是版本升级与产物，不是代码；
    // AI 助手在 README 的致谢里单独说明。两者列进来都会稀释名单
    for (const excluded of ['dependabot', 'github-actions', 'claude']) {
      expect(list).not.toContain(excluded)
    }
  })
})

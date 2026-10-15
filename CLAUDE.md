# CLAUDE.md

Guidance when working in this repository. Mirror of `AGENTS.md` (Chinese) — **keep the two in sync**.

This project has more coupling than its file count suggests: several things are **hand-maintained in
multiple places**, and missing one fails silently (no error, feature just doesn't work). Read
"Change-impact checklist" before touching anything.

---

## Commands

```bash
pnpm install
pnpm dev                    # vite dev server + electron, hot reload; also compiles the Go sidecar
pnpm vue-tsc --noEmit       # renderer/main type check (strict + noUnusedLocals + noUnusedParameters)
pnpm test                   # pure-logic unit tests (Vitest, tests/*.test.ts)
pnpm test:runtime:windows    # native Windows exe integration regression (requires Go)
pnpm test:download:integration # local HTTP/file/store integration regression
pnpm test:parse:integration # parser chain: fallbacks, round cap, cookie lifecycle
pnpm test:acceleration      # acceleration benchmark; see docs/download-acceleration.md
pnpm test:updater           # updater state machine, cache, fallback, install modes
pnpm test:settings:migration # settings defaults/merge and the "no bypass" static scan
pnpm test:package           # unpacked-artifact contents (needs a prior --dir build)
pnpm lint:ipc               # static check of the hand-maintained IPC wiring
pnpm lint:icons             # icon names must be valid (a typo renders as literal text)
pnpm lint:website           # landing page: single file, assets, i18n pairs, theme colors
pnpm lint:docs              # AGENTS.md ↔ CLAUDE.md parity + referenced paths/numbers exist
pnpm deps:manifest:check    # is the dependency manifest behind upstream?
pnpm build                  # vue-tsc && vite build && electron-builder (current platform)
pnpm build:mac:arm64        # also :mac:x64 :win :linux:x64 :linux:arm64
cd backend && gofmt -l . && go vet ./... && go test ./...
```

Requires **Node ≥ 22, pnpm ≥ 8, Go ≥ 1.24**. yt-dlp / ffmpeg need *not* be preinstalled.

No ESLint/Prettier — **do not add them** (formatting churn would swamp the history). TypeScript is
pinned to 5.x: vue-tsc can't run on TypeScript 7 (the Go port drops `typescript/lib/tsc`); Dependabot
ignores its major bumps.

### Tests

Two layers: Go sidecar (`backend/internal/*/**_test.go`) and renderer/main pure logic
(`tests/*.test.ts`, Vitest, `environment: 'node'` — deliberately no jsdom).

- Cover **pure functions only**: format selection, dependency-error parsing, yt-dlp arg assembly,
  parser shared helpers, the updater state machine.
- Do **not** unit-test anything needing the DOM or a real subprocess — type check, `lint:ipc` and
  real-app verification cover that instead.
- Target **branches that have actually broken before**, not coverage numbers.
- **Mutation-check every new test**: break the implementation, confirm the test fails.
  A test that cannot fail is worthless.
- `vitest.config.ts` is separate from `vite.config.ts` on purpose — the latter runs `go build`
  in `buildStart`, which tests must not trigger.

### CI workflow split

Tests are split into three per-platform workflows (`.github/workflows/ci-linux.yml`, `ci-macos.yml`,
`ci-windows.yml`), each with its own jobs, so a failure names the platform *and* the layer:

| job | Contents |
| --- | --- |
| `backend` | gofmt / vet / `go test -shuffle=on` / cross-compile (all 5 targets on Linux, host only on macOS/Windows) |
| `frontend` | type check / IPC contract / icon names / landing page / unit tests / updater / settings migration |
| `main-process` | Linux only: updater / settings migration / manifest check |
| `integration` | download integration / acceleration benchmark / parse integration |
| `native-runtime` | Windows only: native exe runtime-deps regression |
| `package` / `packaging` | build / pack to a directory / artifact contents / manifest & release-notes script self-checks |

**Every new test script must be wired into all three per-platform workflows** — `test:acceleration`
was once added without CI wiring and the acceleration logic went unverified for a long time. Likewise
**`git add` a new workflow file before committing**: when the single test workflow was split into
`ci-*.yml`, the deletion was staged while the three new files were still untracked, so one
`git commit -a` would have left `main` with no CI at all (`scripts/lint-docs.mjs` checks that every
workflow named in the docs exists).

---

## Cross-platform build traps

All four have bitten us for real; the CI windows job caught them, not local macOS.

1. **`process.platform` is not `GOOS`.** Node says `win32`, Go says `windows`. Passing it through
   yields `unsupported GOOS/GOARCH pair win32/amd64`. macOS/Linux pass only because the names
   coincide — that's why local and the ubuntu/macos CI jobs are blind to it. See
   `GOOS_BY_PLATFORM` in `vite.config.ts` and `scripts/build-backend.sh`.
2. **The default shell differs.** Windows runners use PowerShell: `/tmp` resolves to `D:\tmp` and
   `test ! -s` doesn't exist. Add `shell: bash` for POSIX semantics.
3. **Line endings.** Windows defaults to `core.autocrlf=true`, so files check out as CRLF — and CRLF
   is not what `gofmt` emits, so `gofmt -l` flags **every** Go file. The repo root `.gitattributes`
   (`* text=auto eol=lf`) normalizes this. **Do not delete that file.**
4. **Path assertions.** Never hardcode `/tmp/out/...` in tests; production code uses `path.join`,
   which yields backslashes on Windows. Build expectations with `path.join`.

**Hard rule**: any new CI build/check step must first be reproduced locally under
non-host-platform semantics (cross-compile to `win32`, check out with `core.autocrlf=true`).
Validating YAML syntax is not enough.

---

## Architecture

Three components: **renderer** (Vue 3 UI), **main process** (Node — downloading, parsing, updates),
and a **Go sidecar** (detects and installs yt-dlp / ffmpeg). They talk over IPC and NDJSON.

| Path | Contents | Output |
|------|----------|--------|
| `backend/` | Go dependency sidecar | `backend/build/<platform>-<arch>/` |
| `electron/` | main process | `dist-electron/` |
| `src/` | Vue 3 renderer (`<script setup>`, Tailwind v4, Pinia) | `dist/` |
| `shared/app.ts` | **single source** of repo coordinates and external links | imported by all three |
| `tests/` | Vitest pure-logic tests | — |
| `docker/` | container image (entrypoint, virtual display and VNC orchestration; see `docs/docker.md`) | OCI image |
| `website/` | landing page (single file, no build; published by Vercel's Git integration) | — |
| `scripts/` | manifest generation, sidecar build, IPC / website lint, release notes | — |

Both Electron processes are built by `vite-plugin-electron/simple` from one `vite.config.ts`;
the Go sidecar comes from the `goBackend()` plugin in that same file.

### Change-impact checklist

**1. New renderer-callable main capability → three files must change together:**

| # | File | Change |
|---|------|--------|
| 1 | `electron/ipc/<domain>.ts` | `ipcMain.handle(...)`, registered from `electron/main.ts` |
| 2 | `electron/preload.ts` | `contextBridge` entry |
| 3 | `src/env.d.ts` | `Window.electronAPI` type |

`pnpm lint:ipc` cross-checks all three (registered-but-not-exposed, exposed-but-not-implemented,
declared-but-not-exposed, API-group coverage both ways).

> `src/env.d.ts` must have **no top-level import/export** — that turns it from a global declaration
> script into a module and `interface Window` stops applying. Reference dependency types inline:
> `import('./types/deps')`. A second `Window.electronAPI` in `electron/electron-env.d.ts` used to
> shadow the real one and hide broken call sites from the type checker. That file is deleted —
> don't restore it.

**2. New broadcast event (main → renderer) → four places:**

1. the send site (`broadcast('…')` / `webContents.send('…')`)
2. `electron/preload.ts` `ipcRenderer.on` returning an unsubscribe closure
3. the type in `src/env.d.ts`
4. subscribers **must call unsubscribe on unmount** (otherwise hot reload accumulates listeners)

Existing: `download:progress`, `history:updated`, `update:status`, `menu:showAbout`, `deps:progress`.
A broadcast event must **not** double as an `ipcMain.handle` channel (`lint:ipc` enforces this).

**3. Changing user settings shape → silently breaks existing users.**

Settings live in `localStorage['settings']` (**not** Pinia). Fields: `downloadDir`,
`filenameTemplate`, `preferredQuality`, `cookieMode`, `cookiesFile`, `proxy`, `depPaths`,
`acceleration` (enabled/concurrency/optional aria2c path), `autoCheckUpdate` (default on),
`autoDownloadUpdate` (default off), `language` (UI language: `'auto'` follows the system,
`'zh-CN'` or `'en-US'`; default `'auto'`).

**The only entry points are `readSettings()` / `updateSettings()` in `src/stores/settings.ts`:**

- Reads must go through `readSettings()` (it fills defaults and sanitizes `depPaths` /
  `acceleration`); `grep -rn "localStorage.getItem('settings')"` should only match settings.ts
  itself. `deps.ts`, `download.ts` and `DownloadView.vue` each used to carry their own copy, which
  is how `filenameTemplate` ended up with two different defaults
  (`%(title)s` vs `%(title)s.%(ext)s`)
- Writes must go through `updateSettings(patch)` — a raw `setItem` overwrites everything and wipes
  other components' fields (real incident: one "Save" in the settings panel erased `depPaths`)
- **Removing or renaming a field is a MAJOR change** (see `docs/release.md`)
- Update `src/components/SettingsView.vue` and `src/components/DepPanel.vue` too
- `scripts/test-settings-migration.mjs` enforces the above, including the "no bypassing" scan

**4. Runtime dependencies (yt-dlp / ffmpeg / ffprobe):**

- New dep kind → `backend/internal/runtime` (`Kinds`/`Optional`/candidates) + `DepKind` in `src/types/deps.ts`
- Source or version change → only edit the asset table in `scripts/gen-deps-manifest.mjs`, then
  `pnpm deps:manifest`. **Never hand-edit** `assets.gen.go` (generated)
- New platform → manifest asset table + `electron-builder.json5` + `release.yml` matrix
- The `[[deps-missing:<kind>]]` marker is a contract between `electron/utils/binary.ts` (produces)
  and `readMissingKinds` in `src/stores/deps.ts` (parses) — covered by `tests/deps-error.test.ts`

**5. Changing release artifacts → cuts off auto-update for existing users.**

Names are referenced by older clients' `latest*.yml`. Renaming `DownVid-Setup-*`,
`DownVid-Portable-*`, `DownVid-<arch>-Mac-*`, `DownVid-x86_64-Linux-*` breaks every installed copy.
`lint:ipc` checks the `artifactName` entries. Linux uses `amd64`/`x86_64`, not `x64`.

**6. Repo coordinates / links** live only in `shared/app.ts` (main re-exports via
`electron/constants.ts`). `electron-builder.json5`'s `publish` is build-time config that runtime
can't read — `lint:ipc` cross-checks it. Moving repos means editing `shared/app.ts` + `publish` +
workflow references, all three.

### 7. Landing page (`website/`)

One file, `website/index.html`, **no build step**, published straight from `main` by the Git
integration of the Vercel project `downvid` (`vercel.json` sets `outputDirectory: "website"`,
site at <https://downvid-coral.vercel.app>). GitHub Pages is **no longer used**: the repo never
had Pages enabled in Settings, so `actions/configure-pages` only ever failed with
`Get Pages site failed` — that workflow is gone, and `pnpm lint:website` (frontend job of all three
`ci-*.yml`) does the checks instead.

Four silent-failure traps, all covered by `lint:website`:

- **Referenced repo assets** (og:image, favicon, screenshots) use absolute
  `raw.githubusercontent.com/<owner>/<repo>/main/...` URLs — rename or delete a file and the
  live page shows a broken image with no local signal
- **i18n keys must pair both ways**: `data-i18n` placeholders ↔ `I18N.en` entries; a missing
  English entry silently keeps showing Chinese
- **Colors are copied by hand**: `--primary` etc. in the page's `:root` must match the
  `@theme` block in `src/style.css`
- **Zero dependencies**: nothing but Google Fonts may be linked (`.vercelignore` excludes source
  dirs only — it validates nothing)
- **The download count is a static number**: "Downloaded N times" in the hero is refreshed by
  `pnpm website:stats` — no shields.io badge, no client-side fetch (rationale in
  `website/README.md`). Run it after a release.

---

### Runtime dependencies (yt-dlp / ffmpeg)

**The installer ships no binaries** (was ~80 MB per arch, and Git LFS pushed the repo past 800 MB).
A Go sidecar resolves them at startup, "prefer the machine's own, download only if missing":

1. Paths set manually in settings (`localStorage['settings'].depPaths`) — **detection only**
2. `userData/runtime/bin/` (DownVid-installed, safe to overwrite)
3. login shell `PATH` (GUI apps get a stripped `PATH`, so this step is essential) + per-platform
   common install dirs
4. bare command names, left to `PATH`

- Sidecar has two subcommands, `detect` and `fetch`. **stdout carries NDJSON only; logs go to
  stderr** — Electron parses stdout line by line, so a stray log line breaks parsing.
- Go standard library only: it's cross-compiled into five binaries shipped in the installer, so
  auditability wins over convenience. Think twice before adding a third-party dep.
- gzip artifacts are verified **as downloaded** (hash of the compressed file), then extracted.
  Writes go to `.part` and are atomically renamed — a failure never leaves half an executable.
- macOS install must `xattr -c` + `codesign --force --sign -`: network-downloaded executables carry
  quarantine and Apple Silicon kills them outright (`killed: 9`).
- URLs in error messages get their query string stripped — GitHub's signed JWT is hundreds of
  characters and would swamp the UI.
- `electron/utils/runtime.ts` locates the sidecar (packaged: `resources/downvid-deps/`), runs it,
  caches detection 60 s, broadcasts `deps:progress`. Downloads run in main, so closing the window
  doesn't abort them. `electron/ipc/deps.ts` exposes
  `deps:status/check/download/cancel/openDir/diagnostics`.
- Detection has an 80 s total budget (90 s on the Electron side), 45 s per dependency. Candidate
  execution budgets **differ by source**: 15 s for the managed copy, 5 s for system copies. Scanning
  has its own 18 s budget. Windows directories honor actual environment variables; downloading is
  only needed when no usable copy is found. **Do not shrink these numbers casually**: yt-dlp's
  official macOS build (PyInstaller, ~37 MB) takes 8–10 s here for `--version`, and up to 12.4 s on
  its first run, while Homebrew / uv ship a Python zipapp that answers in 0.2 s. Below 15 s the
  **freshly downloaded managed copy is judged "execution timed out, file may be corrupt"**, so the
  UI keeps showing "Download" after a successful download (this really happened). Conversely system
  copies must **not** get a long budget: the candidate list can hold a dozen paths and one hung copy
  at 15 s each drags a single detection out to minutes (the Windows CI job caught exactly that).
  Each number has a **single source of truth** — never restate it elsewhere: total budget
  `rt.DetectTimeout`, per dependency `probeTimeLimit`, candidates `probe.CandidateTimeout` /
  `probe.SystemCandidateTimeout`, scanning `scanTimeLimit` (all under `backend/internal/`). The
  Electron side only owns the 90 s `runSidecar` timeout and **must not pass `--timeout`** (it used to
  hardcode 70, silently overriding the 80 s Go default).
- `cmd.WaitDelay` in `probe.run` **must stay**: on timeout only the direct child is killed, but
  candidates may be shell scripts or PyInstaller launchers whose grandchild still holds the stdout
  pipe, so `cmd.Run()` waits on I/O forever. A `sleep 300` fake binary turned a 5 s budget into
  300 s in a real measurement.
- `resolveDependency()` in `electron/utils/binary.ts` is the single entry point; on failure it throws
  `MissingDependencyError` carrying a `[[deps-missing:<kind>]]` marker the renderer turns into a
  one-click download prompt (same trick as the cookie hint's `\n\n提示：`).
- **Manual paths only affect detection**; `fetch` ignores them, so a user's own install is never
  overwritten.
- `pnpm deps:manifest` (or the `Update dependencies manifest` workflow) refreshes
  `assets.gen.go`. A stale manifest or hash mismatch shows up as "download then checksum failure" on
  user machines, hence `deps:manifest:check` in CI. ffmpeg-static has no published checksums, so the
  script downloads each gzip to hash it (~130 MB of traffic).

### Parse dispatch (`ytdlp:parse`)

Douyin and Kuaishou have bespoke parsers: platform API first, headless `puppeteer-core` (launched via
`electron/utils/browser.ts`) driving a *system-installed* Chrome/Edge as fallback. Every failure is
swallowed by an empty `catch` and falls through to `parseWithYtdlp`. When debugging a parse bug, check
which branch actually ran — the errors are invisible.

### Download has two entirely separate paths

Implementation lives in `electron/download/`; `electron/ipc/download.ts` only dispatches.

- **`direct.ts`**: `directUrl` present (Douyin/Kuaishou only) → `fetch` and a small-block queue,
  8 workers by default (maximum 16). HTTP 429/503 reduces concurrency; segments resume from their written offsets.
  `.part.json` checkpoints accept legacy four-segment layouts and survive connection-setting changes.
  Pause via an `AbortController` in `activeDownloads`. This path exists because those CDN URLs expire
  fast and going through yt-dlp would re-hit the platform API for a different URL.
- **`ytdlp.ts`**: `spawn(yt-dlp)`, using `--load-info-json <parse cacheFile>` when the parse is
  < 20 min old (falls back to the URL if it fails before downloading starts). Progress comes from
  `--progress-template` lines prefixed `[dvp]` (stdout) / `[dvpp]` (postprocess — **stderr** under
  the quiet mode `--print` implies); final path from `--print after_move`. Format selector,
  audio-only, subtitle-only and YouTube multi-audio-track are assembled in `buildYtdlpArgs`.
- **`progress.ts`**: shared broadcast + throttle (≤1 IPC per 200 ms per task). Progress formatting is
  defined here only — don't duplicate it.

`buildYtdlpArgs` is a **pure function**: paths and JS runtime arrive via `BuildArgsContext`, so arg
lists can be asserted without spawning anything (`tests/ytdlp-args.test.ts`).

Optional aria2c (>=1.36) is detected by `electron/download/aria2.ts` via manual path, PATH,
Scoop/WinGet and common install paths. It is neither auto-installed nor a required runtime dependency.
Only HTTP transfers use it; HLS/DASH stay native. Temporary pieces live under `.downvid-aria2`
and a paused task keeps its selected engine, preventing sparse pieces from being treated as sequential data.
The `acceleration` settings field contains enabled/maxConnections/aria2Path.

Formats are built by the pure `electron/parsers/formats.ts`. Three regressions it guards (all
tested): keep formats without `vcodec` (X/Twitter mp4 has none), keep m3u8 only for heights with no
direct link, and offer a `bv*+ba/b` fallback when nothing reports a height.

Pause = `child.kill()` (plus `taskkill /T /F` on Windows), task dropped from the main process's
`electron/store.ts` `activeDownloads`.
Resume re-spawns and continues from the `.part` file. **No cross-restart resume.**

### Task-level concurrency gate (`src/stores/download-rules.ts`)

**At most 3 tasks run at once** (`MAX_CONCURRENT_DOWNLOADS`); the rest stay `pending` in the queue.
`pumpQueue()` is the single enforcement point: `startDownload` / `resumeTask` / `retryTask` all funnel
through it, the pure `selectStartableTasks()` decides who starts, and a finishing task frees its slot
and refills the queue.

- **Never call `processDownload()` directly** — that's the low-level "start this one task" entry, and
  bypassing it breaks the limit. `isDownloading` cannot stop rapid clicking: it's reset to `false`
  synchronously inside `startDownload`.
- Without this gate, clicking "Download" a few times starts several tasks at once, each opening 8–16
  block requests that **compete for bandwidth** (every task gets slower — hard to attribute), and
  site 429s get likelier.
- `merging` occupies a slot too (ffmpeg competes for CPU and disk); `paused` / `error` / `completed`
  do not.
- Scheduling is by ascending `createdAt` (FIFO), otherwise the queue looks broken.
- Failed tasks can be **retried** (`retryTask`, reset rules in `retryReset()`): it must return to
  `pending` to be rescheduled — staying on `error` makes "Retry" look like it does nothing.

### yt-dlp environment quirks

- `--ffmpeg-location` takes a **directory**, not a file: yt-dlp looks for both ffmpeg and ffprobe
  there, which is what makes a managed-dir install work.
- YouTube needs an installed Node / Deno; `checkJsRuntime()` in `utils/js-runtime.ts` must never return the Electron binary.
  It probes asynchronously, requiring Node >=22 / Deno >=2.3, with a six-second total budget and one second per candidate.
  It checks WinGet, Scoop and the user's `.deno/bin` as well as PATH
  so a GUI process with an old PATH can still find the runtime. The sidecar does not install JS runtimes.
- YouTube parsing keeps yt-dlp's default clients. Format/page-reload errors each allow one fallback, at most three rounds.
  Retries share one Cookie lifecycle; downloads reuse successful client arguments and the UI displays a recovery notice.
  `shared/parse-error.ts` emits only categories and validated versions; Issue drafts exclude raw output and environment details.
- **Subtitle mode doesn't need ffmpeg** — it isn't resolved, and no `--ffmpeg-location` is passed.
- Cookies go through `utils/cookies.ts` `runWithCookies`: manual file → none, or (auto) each installed
  browser → snapshot `userData/ytdlp-cookies/browser-cookies.txt` → none. It only moves to the next
  source on a cookie *load* error (`isCookieError`), never on auth errors; an exception while
  preparing a source only skips that source. Downloads prefer a fresh (<30 min) snapshot to match the
  parse. Read failures append a `cookieFailureHint` after the `\n\n提示：` marker, which the renderer
  splits into the error modal's `hint`.
- **Never create anything in `userData` whose name case-insensitively matches a Chromium file**
  (`Cookies`, `Network`, `Preferences`, `Local Storage`…): macOS/Windows filesystems are
  case-insensitive (issue #31 — `userData/cookies` hit `EEXIST`).

### State

| State | Where |
|-------|-------|
| Download queue / selection / orchestration | Pinia `src/stores/download.ts` |
| User settings | **not** Pinia — `localStorage['settings']` |
| Download history | main process, `userData/download-history.json`, merged by local file path, capped at 100, rebroadcast on change |
| Runtime dependencies | Pinia `src/stores/deps.ts` |

- Deps UI: `src/components/DepPanel.vue` (settings section) and `DepsPrompt.vue` (download prompt).
  The "Update" button **must** go through `isOutdated()` (comparing `version` against
  `requiredVersion`) rather than checking `managed` alone — the latter showed "Update" even when the
  installed version already matched the manifest, so users re-downloaded 37 MB for nothing
  mounted in `App.vue`).
- No router. `App.vue` `v-show`s views; navigation uses `window` CustomEvents (`tab-changed`,
  `navigate-to-settings`).
- The updater state machine is `src/composables/useUpdater.ts` (extracted from `UpdateModal.vue`).
  Two easy-to-miss points are documented there: IPC return values and `update:status` broadcasts are
  **two sources that both need handling**, and an error while downloading must be classified as the
  download phase or the retry button jumps back to "check".

### UI conventions

- **All UI strings go through `t('key')`** (`src/i18n/`); never write a literal. `pnpm lint:i18n`
  scans `src/` and rejects hardcoded Chinese. Three easy traps:
  - `t()` reads a reactive `ref`, so **never call it at module top level** — language switches would
    not re-render. Use `computed(() => t('...'))`, or `get label()` for list items.
  - A new key must be added to **both** `zh-CN` and `en-US` with the same placeholder set
    (`lint:i18n` checks both directions).
  - Main-process (`electron/`) error strings are hardcoded Chinese and cannot see the renderer's
    locale; `src/i18n/main-messages.ts` maps known originals to keys and passes unknown text through.
  - **Protocol markers must not be translated** (translation breaks the match): `未找到可用的`
    (matched by `readMissingKinds`), `需要登录` (`friendlyDownloadError` keyword), `\n\n提示：`,
    `更新内容`.
- **Tailwind v4**, CSS-first — no `tailwind.config.js`. Material-3 semantic tokens
  (`bg-surface`, `text-on-surface-variant`, `surface-container-high`, …) are defined in `src/style.css`
  `@theme`. **Use tokens, not raw hex.**
- `@custom-variant dark` is declared but nothing ever toggles the class — there is **no dark mode
  toggle**; don't claim otherwise in docs.
- Icons: generic ones via `src/components/icons/MaterialIcon.vue` (Material Symbols). **Brand icons need
  a dedicated SVG component** (e.g. `GitHubIcon.vue`) — don't substitute a generic Material glyph (a
  `code` chevron was previously standing in for the GitHub mark).
- Most `window.electronAPI` call sites use optional chaining (`?.`) because module-level calls can run
  before preload finishes. Keep that habit.

---

## Release

Bump `package.json` → add a `## [x.y.z]` section to `CHANGELOG.md` → push tag `v*` (or run
`release.yml` manually with a `version` equal to `package.json`'s; the workflow creates the tag).

`release.yml` builds 5 arch targets (each job installs only Go + Node — no binaries are checked in),
then regenerates every `latest*.yml` from the **final artifacts** via
`scripts/gen-update-manifests.mjs` (per-job manifests would overwrite each other).

Release body is generated by `scripts/gen-release-notes.mjs`: clickable download badges on top, and
links are built from **scanned artifacts** so they can't 404. Re-test it against fake artifacts after
editing the template.

Artifact names are what old clients' updater manifests point at — don't rename them.

### A pushed tag is not a published release

**Verify the tag ↔ Release pair.** This really happened: the `v1.3.5` tag was pushed and the
CHANGELOG updated, but the `Build & Release` run was **cancelled after 3 minutes**, so there was no
GitHub Release for it and the updater channel (`/releases/latest`) still pointed at v1.3.4 — the fixes
in that version **could never reach any user**. Nothing signals this: the tag exists, the CHANGELOG
entry exists, `package.json` is bumped; only the Releases page is one entry short, which is the least
noticeable place of all.

- `pnpm verify:release` (`scripts/verify-release.mjs`) checks a tag really has a Release with the
  `latest*.yml` manifests for every platform. `release.yml` runs it once at the end.
- `.github/workflows/release-audit.yml` is a **daily audit independent of the release flow**: it only
  looks at the outcome (newest tag ↔ Release) and opens a `release-audit`-labelled issue on mismatch.
- During local development it is normal for the version to equal the published one; **don't bump the
  version early just to make `verify:release` pass.**

### Unreleased work goes in `[Unreleased]`

With no release planned, keep `package.json` at the **latest published version** and accumulate changes
under `## [Unreleased]`. When releasing, rewrite it to `## [x.y.z] - <date>` and bump the version.

---

## Container image (Dockerfile and docker-compose.yml, entrypoint docker/entrypoint.sh)

DownVid is an Electron desktop app, and a container has no display. The image **replicates a good-enough
desktop**: Xvfb provides the virtual display, fluxbox manages windows, x11vnc + noVNC bring the UI into a
browser. The user guide is `docs/docker.md`; here is what you must know before touching the image.

**The build has two stages.** Stage 1 installs pnpm deps, runs `pnpm vite build` (producing `dist/`,
`dist-electron/` and `backend/build/linux-*/`) and unpacks the Electron binary; stage 2 copies only the
artifacts and installs runtime libraries. The runtime image therefore has **no Go and no node_modules**.
Keep `Dockerfile` in sync with `.github/workflows/ci-*.yml` on Node/pnpm/Go versions, otherwise you get
"CI is green but the image has a different toolchain".

**`dist-electron/main.js` must run under Electron, not bare node.** It contains bare `"electron"` imports.
The runtime stage carries no `node_modules`, so the build stage unpacks Electron to `/opt/electron`.
Electron's asset names are `x64` / `arm64` — **not** Docker's `amd64` / `arm64` — and `Dockerfile` maps
them explicitly. Its version is pinned in `ARG ELECTRON_VERSION`; when bumping Electron, update that
and `package.json` together.

**The Chromium runtime library list has one source.** The `lib*` packages in `Dockerfile` come from
Chromium's `build/install-build-deps.py` `lib_list()` (referenced by Electron's install-deps.sh) —
they are not hand-written, because Chromium's linked libraries change with versions and a guessed list
ends in "works locally, missing one `.so` in the container".

**Runtime dependencies are preinstalled, never committed.** yt-dlp and ffmpeg come from Debian and pip
into `/usr/local/bin` and `/usr/bin`; both are already in the Go sidecar's candidate paths
(Linux common dirs in `backend/internal/runtime`), so detection reports "system" and in-app settings
cannot override them. Upgrade by rebuilding the image through CI — **do not** commit binaries to the
repo, and do not add entries to `assets.gen.go` (that table drives the in-app downloader).

**User data paths in the container come from the environment, not from code.** `entrypoint.sh` points
`XDG_CONFIG_HOME` / `XDG_DATA_HOME` at `${DOWNVID_HOME}/userdata` and sets `DOWNVID_DOWNLOADS`, so
history, cookie snapshots and logs follow the `/data` volume. "Recreating the container wiped my
settings" is almost always an unmounted volume.

**The single-instance lock cannot misfire here.** `main.ts` reads `isDev || app.requestSingleInstanceLock()`
with `isDev = !app.isPackaged`; the container runs the unpackaged `dist-electron/main.js`, so it never
requests the lock at all. A container restart needs no extra flags — but **do not** fake a marker like
`package-type` to make it "look packaged": that would enable the lock *and* push the auto-updater down
the wrong branch (a container should never auto-update; upgrading means rebuilding the image).

**Supervision is "any service exits → stop the container".** `entrypoint.sh` uses `wait -n` on the first
supervised process to exit and then ends with its exit code. A white-screen "running" container is harder
to diagnose than a clear failure. Note that `sshd` and `x11vnc -bg` daemonize, so they are deliberately
outside the supervised set (their parent exiting would read as a crash).

**Image builds are "non-host-platform semantics" (the hard rule above).** POSIX paths, LF endings
(guaranteed by `.gitattributes`), and **resolution driven by environment variables** all have to be
validated under non-Windows semantics. `docker/entrypoint.sh` must stay LF or the `#!/usr/bin/env bash`
shebang fails.

---

## Gotchas

- `electron/main.ts` has one `commandLine.appendSwitch('disable-gpu-sandbox')` — a macOS Tahoe +
  Electron crash workaround. **Don't remove it.**
- The app menu (`electron/menu.ts`) is registered **only on macOS**: on Windows/Linux Electron
  renders it as an in-window menu bar on top of the custom header (`titleBarStyle: 'hidden'`), which
  users saw as a stray tab strip.
- Updates live in `electron/updater.ts` (IPC in `ipc/app.ts` just delegates). Windows/Linux use
  electron-updater with `autoDownload = false`; macOS is unsigned so Squirrel can't work — it
  downloads the arch zip, verifies sha512, strips quarantine, ad-hoc signs, and a detached bash script
  swaps the `.app` after quit (with rollback). Unsupported installs (tar.gz, Windows portable, running
  from DMG) get a GitHub-API check and a "go to releases" button. electron-updater uses its own
  session partition, so `app:setProxy` sets the proxy there too.
- Main logs to `userData/downvid.log` (5 s heartbeat); Settings reads the last 500 lines via
  `app:getLog` — the fastest way to diagnose a packaged-app crash.
- All UI strings, comments and commit bodies are **Chinese** — match that.
- Branch names `feat/…` `fix/…` `docs/…` `chore/…`, Conventional Commits. `main` is **not** protected;
  the maintainer pushes directly. PR conventions are advice for outside contributors.
- `AGENTS.md` (Chinese) and `CLAUDE.md` (this file) are the same knowledge in two languages —
  **changing one means changing the other.**

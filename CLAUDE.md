# CLAUDE.md — DownVid developer quick reference

For anyone (or any AI) changing code in this repo. The coupling here is wider than the file count
suggests: many things are **synchronised by hand**, and a missed spot fails silently (no error, the
feature just does not work). Read the "change checklist" section before editing.

## Scope

You are Claude Code working on DownVid. Stay inside this repository: read the code, make the
change, run the checks below. Do not expand a task into open-ended research — unrelated
repositories, generic technology comparisons, or "best practice" surveys. When external
information is genuinely required, say what you need and why first, then consult the smallest
source that answers it.

---

## Quick start

Architecture: **Go core + Wails desktop shell + Svelte 5 frontend**, shipped as one file.
The old Electron/Vue architecture has been removed entirely.

```bash
pnpm install
pnpm --dir app/frontend install   # app/frontend is its own package, outside the root workspace
bash app/scripts/build.sh         # end-to-end: frontend + dependency sidecar embedded
(cd app && wails dev)             # UI-only development; no dependency sidecar
pnpm --dir app/frontend check     # svelte-check (tsc cannot see .svelte)
(cd app && go test ./...)         # Go core tests
```

Requirements: **Node >= 22**, **pnpm >= 8**, **Go >= 1.25**, Wails CLI v2.16
(`go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`).
yt-dlp / ffmpeg do **not** need to be installed up front (see "Runtime dependencies").

`cd app && wails dev` produces an app **without** the dependency sidecar: the dependency page only
reports "detection helper missing", and the build does not warn. To test dependency and download
flows, use the `build.sh` artifact.

---

## Verification commands

Run the layer you touched. The frontend checks are **no longer run in CI** (see below) — run them
yourself when changing the UI. The backend job still runs the Go core tests, but `go test` locally is
cheap.

```bash
# Go core (app/)
(cd app && gofmt -l . && go vet ./... && go test -shuffle=on ./...)

# Go sidecar (backend/)
cd backend && gofmt -l . && go vet ./... && go test -shuffle=on ./...

# Frontend
pnpm --dir app/frontend check        # svelte-check
pnpm lint:i18n:app                   # zh/en pairs + t() keys exist
pnpm --dir app/frontend test         # frontend pure-logic tests

# Root pure-logic tests (shared/ and release scripts)
pnpm test

# Static checks
pnpm lint:boundaries                 # G1: app/internal packages must not import each other
pnpm lint:icons                      # icon names (a typo renders as text, silently)
pnpm lint:website                    # website copy / assets / palette / artifact names
pnpm lint:docs                       # this file <-> AGENTS.md consistency + real paths
pnpm lint:workflows                  # "uses a tool" implies "installs that tool"
pnpm lint:attribution                # upstream copyright notice while upstream code remains
pnpm audit:provenance                # code provenance audit
pnpm sync:repo && pnpm sync:toolchain && pnpm sync:changelog
pnpm deps:manifest:check             # dependency manifest behind upstream?

# End to end
pnpm test:e2e:real                   # real yt-dlp / ffmpeg (skips explicitly when missing)
bash app/scripts/build.sh            # single-file artifact
```

### About tests

Three layers: **Go core** (`app/internal/*/**_test.go`), **Go sidecar**
(`backend/internal/*/**_test.go`), and **frontend pure logic**
(`app/frontend/src/lib/*.test.ts` and `tests/*.test.ts`).

- Pure-logic tests cover **pure functions** only: format selection, progress lines, argument
  assembly, update-source fallback, settings normalisation.
- Logic that needs the DOM or actually spawns processes / talks to the network is **not** unit
  tested — it goes through integration runs (`app/e2e_*_test.go`, `scripts/test-e2e-real.mjs`),
  or is caught by svelte-check and real-device testing.
- Add one case per branch that has **previously broken**. Chasing coverage numbers is not the goal.
- **Always do a mutation check** after writing a test: break the logic and confirm the test fails.
  A test that cannot fail is not a test.
- The `app/frontend` test setup deliberately avoids jsdom: `environment: 'node'`.

### CI workflow layout

Tests are split by **platform** (`.github/workflows/ci-linux.yml`,
`.github/workflows/ci-macos.yml`, `.github/workflows/ci-windows.yml`), and each workflow splits jobs
by responsibility:

| job | Contents |
| --- | --- |
| `backend` | gofmt / vet / `go test -shuffle=on` for both modules, sidecar cross-compilation |
| `integration` / `build` | Linux only for real-dependency E2E; each platform has a `build` job that compiles the single-file artifact once |

Each of the three workflows starts with a `changes` job: a **docs / website / Markdown-only push**
skips cross-compilation, per-platform artifacts and the real-dependency e2e. The former `frontend`
job (icons / website / docs / provenance / boundaries / repo coords / i18n / workflows / root tests
/ svelte-check / frontend tests) was **removed** because it kept failing and blocked unrelated work;
run those checks locally before a UI change or a release: `pnpm lint:*`, `pnpm test`,
`pnpm --dir app/frontend check`, `pnpm --dir app/frontend test`. `release.yml` still runs the static
checks it needs.

Releases are done by `.github/workflows/release.yml`. `.github/workflows/release-audit.yml` checks
daily and independently that "latest tag <-> Release" match. `.github/workflows/update-deps.yml`
refreshes the dependency manifest. `.github/workflows/triage.yml` classifies issues.

**A new test script must be wired into the platform workflow** — `test:acceleration` was once added
without CI coverage, and acceleration had no automated verification for a long time. Likewise,
**a new workflow file must be `git add`ed** (`scripts/lint-docs.mjs` verifies that workflows
mentioned in the docs actually exist).

### Formatting

There is no ESLint / Prettier, and one must **not** be added (formatting churn pollutes history).
TypeScript strictness plus svelte-check covers the frontend; Go uses `gofmt` + `go vet`.

---

## Project layout

| Path | Contents | Output |
|------|----------|--------|
| `app/internal/*` | **Go core, 16 packages, zero dependencies between them** | — |
| `app/main.go` / `app/app.go` / `app/bindings_*.go` | Wails shell: plumbing only, no business rules | `app/build/bin/` |
| `app/frontend/` | Svelte 5 + Vite renderer | embedded (`go:embed`) |
| `app/scripts/build.sh` | **Build entry point**: sidecar first, then build with `-tags withsidecar` | ~18 MB single file |
| `app/cmd/downvid-server` | Headless entry point (HTTP + WebSocket RPC, `app/internal/server`) | standalone binary (frontend not wired yet) |
| `backend/` | Go dependency sidecar (detect + download yt-dlp/ffmpeg/aria2) | embedded |
| `shared/` | Contracts shared by frontend and scripts: repo coords, update sources, acceleration, parse errors | — |
| `scripts/` | Check / generate / release scripts (zero dependencies, Node stdlib only) | — |
| `tests/` | Root pure-logic tests (shared/ and scripts) | — |
| `website/` | Product landing page (no build, published by Vercel) | — |
| `docs/` | Install, build, release and maintenance docs | — |

The 16 packages under `app/internal/*`:

| Package | Responsibility |
|---|---|
| `changelog` | Parses the local copy of `CHANGELOG.md` (`//go:embed` cannot cross directories; kept in sync by `pnpm sync:changelog`) |
| `clipboard` | Reads the system clipboard (WebView `navigator.clipboard` triggers a permission prompt) |
| `cookie` | Cookie policy, browser cookie extraction and snapshots |
| `deps` | Dependency detection/download: spawns the sidecar, converts NDJSON into events |
| `download` | yt-dlp arguments, progress lines, process-tree termination, aria2 progress |
| `fetch` | Direct-link chunked downloads and resume checkpoints |
| `history` | Download history (atomic write, corruption recovery, win32 path normalisation) |
| `image` | Thumbnail fetch with Referer, converted to a data URL |
| `jsruntime` | Node / Deno detection (YouTube needs a real JS runtime) |
| `netx` | HTTP client with proxy support, proxy liveness check |
| `parse` | Site parsing, format de-duplication, error classification, bounded YouTube fallback |
| `server` | Headless HTTP + WebSocket RPC |
| `settings` | User settings (14 fields, persisted to settings.json in the data directory) |
| `shell` | Open path / reveal in folder / free disk space |
| `sidecar` | Embeds the dependency sidecar and writes it out at runtime |
| `update` | Update discovery/download via wmlUpdate, native self-update install, artifact recognition |

Packages under `app/internal/*` **must not import each other** (`pnpm lint:boundaries` rule G1) and
must not depend on `cmd` (G2). This is the property most worth protecting: every package stays
independently testable and replaceable.

---

## Change checklist (the parts that break silently)

### Adding a backend capability (callable from the frontend)

1. Add an exported method in `app/bindings_*.go` (download/deps) or `app/app.go` (window / update /
   history). Wails generates `wailsjs` from the signature; no preload or IPC registration needed.
2. The frontend calls it **only** through `app/frontend/src/lib/backend.ts`; never import
   `wailsjs/...` inside a component — in a browser that throws `Failed to resolve module` and the
   page goes blank. It is also the single place to change when swapping transports.
3. Field names are a **verbatim contract**: `app/frontend/src/lib/types.ts` must match the Go struct
   JSON tags. Changing one side of an array causes no type error, only a blank UI.
4. Verify: `pnpm --dir app/frontend check` + `cd app && go test ./...`.

### Adding a broadcast event (Go -> frontend)

1. Go side: `a.emit("event", data)` (the `emit` helper in `app/app.go`).
2. Frontend subscribes in `app/frontend/src/lib/backend.ts` and **returns unsubscribe**; call it on
   component teardown.
3. Record the event name and payload shape in `app/frontend/src/lib/types.ts`; otherwise a mismatch
   only shows up at runtime.

### Changing the settings shape

- Single entry point: `app/internal/settings/settings.go`; frontend mapping in
  `app/frontend/src/lib/settings.ts`.
- Additions only (fill missing values from defaults when reading). Removing or renaming a field is a
  MAJOR change.
- `app/frontend/scripts/check-settings-write.mjs` scans for writes that bypass the entry point.

### Changing UI copy

- Message table: `app/frontend/src/lib/i18n.svelte.ts`.
- New keys must exist in both languages; `pnpm lint:i18n:app` checks both directions and verifies
  that every `t()` key exists.
- `t()` is reactive and **must not be called at module top level**; use `computed` / getters.

### Changing runtime dependencies / the manifest

- Detection lives in the `backend/` sidecar; `app/internal/deps` only spawns it and forwards NDJSON
  events. **Do not add a second candidate-path table here** (that is exactly how "the dependency page
  says installed, the acceleration page says missing" happened).
- **New dependency kind**: `Kinds` / `Optional` / candidates in `backend/internal/runtime`, plus
  `DEP_KINDS` in `shared/acceleration.ts`.
- **Changing download source or version**: only edit the asset table in `scripts/gen-deps-manifest.mjs`
  then run `pnpm deps:manifest`. Never hand-edit `backend/internal/manifest/assets.gen.go` (generated).
- **New platform**: asset table + target list in `app/scripts/build.sh` + build matrix in
  `.github/workflows/release.yml`.

### Changing release artifacts

Artifact names start with `DownVid-Wails-` and appear in five places; changing one means changing all
five: the packaging steps in `release.yml`, `app/internal/update/migration.go`, `wmlAssetRules` in
`app/internal/update/wml.go`, the artifact templates in `website/app.js`, and
`scripts/gen-release-notes.mjs`. The asset classifier in `scripts/lib/update-manifest.mjs` parses the
platform/arch segments too. `pnpm lint:website` compares the website side.

After a release, verify that tag <-> Release agree:

- `pnpm verify:release`: checks that a tag really has a Release with all three platform packages.
- `.github/workflows/release-audit.yml`: an independent daily audit; opens an issue labelled
  `release-audit` on mismatch.
- Keeping the local version equal to the last released version is normal; **do not bump early** just
  to make `verify:release` pass.

### Changing repo coordinates / external links

Single source is `shared/app.ts`. `pnpm sync:repo` checks pipelines, scripts and the website.

### New or rewritten modules change the upstream composition (provenance audit)

`docs/provenance/` documents provenance, target architecture and release quality. The numbers are
recomputed by `pnpm audit:provenance`:

- A new file with >=15% (and >=8 lines) verbatim upstream Videdown code **must be registered** in
  `scripts/data/provenance/registry.json`, or CI fails
- Registered numbers that no longer match the measurement fail too (run
  `node scripts/audit-provenance.mjs --write` first)
- Line counts in `docs/provenance/audit.md` must match the measurement

The upstream snapshot lives in `scripts/data/provenance/upstream/`; **do not modify it**.

### Changing the product website (`website/`)

A no-build multi-file site (`index.html` / `styles.css` / `app.js`) published by Vercel's Git
integration after pushes to main (`vercel.json` sets `outputDirectory: "website"`).
`release.yml` explicitly triggers a Vercel Deploy Hook and then reads back the online page's
`data-version` to confirm the deployment.

Things that fail silently, all covered by `pnpm lint:website`:

- **Referenced repo assets** (og:image, favicon, logo) use absolute
  `raw.githubusercontent.com/<owner>/<repo>/main/...` URLs; renaming or deleting a file breaks the
  image online with no local warning
- **zh/en message pairs must be two-way**: `data-i18n` placeholders <-> `I18N.en` entries
- **The palette is copied by hand**: the site's `:root` `--primary` etc. must match the `@theme` block
  in `app/frontend/src/app.css`
- **No build, no dependencies**: only local `styles.css` / `app.js`; no third-party scripts/styles
  besides Google Fonts
- **Download buttons link straight to artifacts**: the `ARTIFACTS` templates in `app.js` must match
  the `build-wails` artifacts in `release.yml`; a mismatch produces no error, it just picks nothing
- **The hero preview is an interactive recreation of the app UI** (not a screenshot): update it when
  the app UI changes

---

## Runtime dependencies (yt-dlp / ffmpeg / aria2)

**The installer ships without these binaries.** At startup the Go sidecar resolves them in this order:

1. Manual paths from settings (**detection only**)
2. `~/.downvid/runtime/bin/` (downloaded by DownVid, overwritable; the legacy
   `userData/runtime/bin` is migrated automatically)

**Nothing else is scanned** — no system PATH, no Homebrew/WinGet/common install directories —
so the three platforms behave identically. A missing tool is downloaded into that same directory.
The login shell's PATH is still merged (`LivePath` / `EnsureChildPath`) but only so the managed
zipapp can find a Python 3.11+; it does not take part in detection.

### Sidecar (`backend/`)

Two subcommands only: `detect` (NDJSON on stdout) and `fetch` (download and install).
**stdout carries JSON only; logs always go to stderr.**

- Standard library only: it is cross-compiled into the main program for five platforms, so
  auditability matters more than convenience.
- `probe` parses versions; `runtime` decides candidate paths and priority; `fetch` downloads,
  verifies SHA-256, decompresses and replaces atomically; `manifest` only reads the generated table;
  `cli` emits NDJSON.
- gzip artifacts are verified **as the compressed file**, decompressed only after verification.
- Write `.part` first, then rename atomically, so a failure never leaves half an executable.
- On macOS, run `xattr -c` + `codesign --force --sign -` after installing: network-downloaded
  binaries carry `com.apple.quarantine` and Apple silicon kills them (`killed: 9`).
- URLs in error messages have their query string stripped (GitHub's signed JWT is hundreds of chars).

### Detection budgets (one source of truth each, do not duplicate the numbers)

- Total detection budget **80 s**: `rt.DetectTimeout`
- 45 s per dependency; per-candidate budget: 15 s for managed copies and manual paths
  (`probe.CandidateTimeout`)

**Do not shrink these numbers.** The official macOS yt-dlp build (PyInstaller, ~37 MB) needs
8–10 s for `--version` and 12.4 s on the slowest first run, while a zipapp needs 0.2 s — below a
15 s budget a **freshly downloaded copy is reported as "timed out, the file may be corrupt"**.

`cmd.WaitDelay` in `probe.run` **must not be removed**: on timeout only the direct child is killed,
and a candidate may be a shell script or a PyInstaller launcher whose grandchild still holds the
stdout pipe, so `cmd.Run()` waits for I/O forever.

### Mirror fallback for downloads

Artifacts live on `github.com/.../releases/download/...`; when that host is unreachable the app can
install nothing. The chain is `GitHub direct -> gh-proxy.com -> ghproxy.net -> ghfast.top`, stopping at
the first success (`backend/internal/fetch/mirror.go`). Only URLs genuinely hosted on GitHub releases
are rewritten (`isUpstreamGitHub`); self-hosted object storage and test httptest servers must be used
as-is.

### Packaging on the Wails side

- `app/scripts/build.sh` compiles the sidecar into `app/internal/sidecar/bin/<goos>-<goarch>/` and
  embeds it with `-tags withsidecar`; at runtime it is written to `~/.downvid/runtime/bin/downvid-deps`.
- Builds without `-tags withsidecar` (`go test`, plain `go build`, plain `wails build`) use a stub:
  they compile, but the dependency page only reports "detection helper missing". This is deliberate.
- The UI must show `Source` (system / managed / manual / scanned) and `Form` (zipapp / native) honestly:
  `native` may take 9–12 s on first run and that does not mean the file is broken.

### Upgrading the dependency manifest

`pnpm deps:manifest` (or the `Update dependencies manifest` workflow). A stale manifest or hash
mismatch makes downloads fail verification on the user's machine, so CI runs `deps:manifest:check`.

ffmpeg comes from ffmpeg-static rather than BtbN: smaller, one gzip file for easy verification, and it
includes libmp3lame / aac / libx264. The cost: upstream publishes no checksums, so `deps:manifest`
downloads each gzip in full and computes them.

---

## Download architecture (`app/internal/download` and `app/internal/fetch`)

### Parse performance

**The yt-dlp flavour decides parse speed.** Measured on one machine, one bilibili video:

| Form | `--version` | Real parse |
| --- | --- | --- |
| `yt-dlp_macos` (PyInstaller single file) | 9.5–10.5 s | 11.4 s |
| `yt-dlp` (Python zipapp) | 0.41 s | **2.2 s** |

The PyInstaller build unpacks ~72 MB to a temp directory on every start; those 9 s are pure overhead.
Therefore:

- Linux / macOS prefer the **zipapp**, while also recording the self-contained PyInstaller package as a
  fallback; `manifest.HasUsablePython()` decides which one is installed. **Windows does not use the
  zipapp** because python3 is not commonly present.
- **Never run `--version` again on the success path**: `readYtdlpVersion()` is called only on
  **failure**, and cached.

### Two entirely independent download paths

- **`direct.go`**: when `directUrl` exists (Douyin/Kuaishou only — the parser returns a CDN URL), a
  plain HTTP chunked download. When Range is supported, chunks are scheduled through a queue: 8
  workers by default, up to 16; 429/503 reduces concurrency; failed chunks resume from what was
  already written. `.part.json` stores per-chunk progress and stays compatible with the older
  four-chunk layout.
- **`run.go` + `ytdlp_args.go`**: `spawn(yt-dlp)`. For 20 minutes the parse result is reused via
  `--load-info-json`. Progress comes from `[dvp]` / `[dvpp]` lines emitted by
  `--progress-template`; the final path comes from `--print after_move`. Format selectors,
  audio-only, subtitle-only and YouTube multi-audio are all assembled in `buildYtdlpArgs`.

`buildYtdlpArgs` is a **pure function**: dependency paths and the JS runtime are resolved by the caller
and passed in, so argument lists can be asserted without spawning anything.

Optional aria2c (>=1.36) is one of the `DepKind` values, and **detection is owned by the sidecar** — do
not add another candidate table in `download`. It only takes over yt-dlp's HTTP downloads; HLS/DASH
stays native.

**Version parsing must understand localised output**: the first line of `aria2c --version` changes with
`LANG` (`aria2 version 1.37.0` / `aria2 版本 1.37.0`). Matching English only meant **aria2 was never
detected on Chinese / Japanese / German systems**. Runs are pinned to `LC_ALL=C`.

### Pause means killing the whole process tree

`child.kill()` signals only the direct child, while with aria2 enabled the chain is three levels deep
(DownVid -> yt-dlp -> aria2c). Killing only yt-dlp orphans aria2c, which keeps writing `.part`: the file
grows and bandwidth is consumed after pausing, and a corrupted `.aria2` control file makes resume
**restart from zero**. Therefore `spawn` must use `detached: true` (process group leader) and pause
signals `-pid`; on Windows `taskkill /T /F` runs before killing the parent. On POSIX, `SIGTERM` first so
aria2c can flush its control file, then `SIGKILL` after a grace period.

### Two memory traps

- **The parse cache needs an entry cap**: TTL alone is not enough. Each entry holds a full info JSON
  (a long video can be several MB), so "paste a batch of links and peek at each" reaches hundreds of MB
  within 30 minutes.
- **Temp info JSON files must be cleaned up on exit**: they exist for `--load-info-json`.

### Format de-duplication (`app/internal/parse/formats.go`)

Four easy-to-miss points (all covered by tests): keep formats without `vcodec` (X/Twitter mp4 has no
such field), keep m3u8 only when that quality has no direct link, provide a `bv*+ba/b` "best" fallback
when nothing reports a resolution, and **keep only one entry per quality**.

The last one really broke: bilibili offers three codecs per quality, and fps is a float, so 29.969 and
29.97 are the same 30 fps tier — with raw fps in the de-duplication key they were unequal and the UI
showed **two 1080p entries**. `normalizeFps()` now snaps to common tiers, the key is
`height + normalised fps`, and within a tier the most compatible codec wins (AVC > HEVC > AV1).

### yt-dlp environment details

- `--ffmpeg-location` takes a **directory**, not a file: yt-dlp looks for both ffmpeg and ffprobe there.
- YouTube needs a real Node / Deno install (`app/internal/jsruntime`, Node >=22 / Deno >=2.3, 6 s
  budget). Without a runtime it reports runtime-unavailable and never spawns yt-dlp. The bindings layer
  caches only **found** results (60 s): caching "not found" would keep failing after the user installs
  Node.
- **Subtitle mode does not need ffmpeg**, so it is not resolved and no `--ffmpeg-location` is passed.
- Cookies go through `app/internal/cookie`: manual file -> none; in auto mode each installed browser is
  tried in turn -> snapshot at `userData/ytdlp-cookies/browser-cookies.txt` -> none. The source is switched only
  on cookie **read** errors.
- **Never create files or directories under `userData` whose names collide case-insensitively with
  Chromium's** (`Cookies`, `Network`, `Preferences`, `Local Storage`): macOS/Windows filesystems are
  case-insensitive (issue #31).

---

## State management

| State | Location |
|------|----------|
| App state (parse result / task queue / dialogs) | `app/frontend/src/lib/store.svelte.ts` (Svelte 5 runes singleton) |
| User settings | `userData/settings.json`, entry point `app/internal/settings/settings.go`; frontend mapping in `app/frontend/src/lib/settings.ts` |
| Download history | `app/internal/history` -> `~/.downvid/download-history.json` (atomic write) |
| Runtime dependencies | `app/internal/deps` (60 s detection cache) |
| Updates | `app/internal/update` (wmlUpdate discovery/download + native install) |

**All backend calls go through `app/frontend/src/lib/backend.ts`**: importing `wailsjs` directly in a
browser blanks the page, and it is the only place to change when swapping transports.

### Update sources (wmlUpdate + static manifest)

Update discovery and download are delegated to **wmlUpdate** (`app/internal/update/wml.go`);
installation stays in `install_*.go` because wmlUpdate's install strategies need a fixed install
path and its deferred helper only works for its own CLI.

- `auto` = GitHub direct -> GitHub API through gh-proxy -> website/jsDelivr manifest (GitHub
  assets) -> Gitee manifest (Gitee assets). Per-source pinning still works through the existing
  `updateSource` setting.
- The website and jsDelivr mirrors read `website/updates/manifest.json` (`scripts/gen-update-manifest.mjs`,
  regenerated by `release.yml` on every release and committed to main together with the website
  version). It carries the SHA-256 of every artifact.
- The Gitee source is a **full mirror**: release assets are uploaded to Gitee and
  `website/updates/manifest.gitee.json` points at them, so check and download can both stay on
  Gitee.
- `asset_mirrors` retries the same version through gh-proxy.com / ghproxy.net / ghfast.top plus
  the Gitee release URL; a mirror may provide availability, never different bytes.
- wmlUpdate's chain does **not** fall through when a release has no matching asset; `CheckUpdate`
  falls back to the legacy `lookupLatest` only to display the version and attempt trace.
- A new source must update `wmlSource` + `wmlManifestURLs`, `UPDATE_SOURCE_IDS`, both language
  tables and the settings UI.

---

## UI conventions

- **All UI copy goes through `t('key')`**; no hardcoded Chinese. New keys must exist in both languages.
- **Tailwind v4** (CSS-first, **no** `tailwind.config.js`): Material-3 style semantic colour tokens are
  declared in the `@theme` block of `app/frontend/src/app.css`. **Use semantic tokens, never raw hex.**
- `app/frontend/src/design-system.test.ts` pins the primary colour, motion properties and durations.
- Icons: generic icons use `app/frontend/src/components/Icon.svelte` (Material Symbols names); **brand
  icons use dedicated SVG components** (e.g. `GitHubIcon.svelte`), never a generic Material glyph
  (a `code` bracket was once used as the GitHub icon).
- No router: `App.svelte` switches views with conditional rendering.

---

## Build and release

```bash
bash app/scripts/build.sh                            # current platform
bash app/scripts/build.sh -platform darwin/arm64
bash app/scripts/build.sh -platform darwin/universal  # sidecar is built for arm64 and amd64
```

Release process is in `docs/release.md`. Key points:

1. Bump `package.json`, add a `## [x.y.z]` section to `CHANGELOG.md`, push a `v*` tag (or run
   `release.yml` manually with a version matching `package.json`).
2. `release.yml` runs a release gate (Go tests + static checks + unit tests + sidecar cross-compilation),
   builds on macos-latest / windows-latest / ubuntu-22.04, creates the Release, verifies artifact
   completeness, refreshes the website version and explicitly triggers the Vercel deployment.
3. The Release body is generated by `scripts/gen-release-notes.mjs`: a download badge section at the top
   whose links are scanned from the real artifacts, so no dead links appear.

### Unreleased changes go under `[Unreleased]`

When there is no release plan, keep `package.json` at the last released version and accumulate changes
under `## [Unreleased]` in `CHANGELOG.md`. At release time, convert it to `## [x.y.z] - date` and bump
the version once.

---

## Cross-platform build traps (all hit for real)

Building on macOS does not mean Windows will pass. The CI windows job has caught three classes:

1. **`process.platform` is not `GOOS`**. Node says `win32`, Go says `windows`. Passing it through gives
   `unsupported GOOS/GOARCH pair win32/amd64`. The mapping lives in `app/scripts/build.sh`.
2. **Different default shells**. The Windows runner uses PowerShell: `/tmp` resolves to `D:\tmp` and
   POSIX assertions such as `test -s` do not hold. Steps needing POSIX semantics must declare
   `shell: bash`.
3. **Line endings**. Windows defaults to `core.autocrlf=true`, so checkouts are CRLF, which is not what
   `gofmt` emits and `gofmt -l` flags **every** Go file. The repo root `.gitattributes`
   (`* text=auto eol=lf`) normalises to LF; **do not delete it**.
4. **Path assertions**. Never hardcode `/tmp/out/...` in tests; build expectations with `path.join`.
5. **Wails' `universal` is not a Go `GOARCH`**. `wails build -platform darwin/universal` is lipo-merged by
   Wails, but the sidecar is ours: `app/scripts/build.sh` must build it for both arm64 and amd64,
   otherwise the universal download cannot find the sidecar binary.
6. **Linux Wails builds need webkit2gtk-4.0**. Wails v2.16's cgo directives look for the
   `webkit2gtk-4.0` development package by default; installing only 4.1 fails the build.
7. **Wails frontends cannot use absolute asset paths**. Keep `base: './'` in
   `app/frontend/vite.config.ts`; switching to `/` works in dev but 404s once embedded in `embed.FS`
   (icons turn into text and the build does not complain).

**Hard rule**: any new build/check step in CI must first be reproduced locally under
"non-host-platform semantics" (cross-compile to `win32`, check out with `core.autocrlf=true`); reviewing
YAML syntax is not enough.

---

## Notes

- `wails generate module` compiles the Go packages first, and `app/main.go` has
  `//go:embed all:frontend/dist`. The order must be: prepare the embed directory
  (`app/scripts/prepare-embed-dir.sh`) -> build the frontend -> generate bindings. Running generate
  first fails with `pattern all:frontend/dist: no matching files found`.
- `app/frontend` is an **independent package** (outside the root pnpm workspace): install with
  `pnpm --dir app/frontend install` and type-check with `pnpm --dir app/frontend check`.
- Settings live in `userData/settings.json`; removing or renaming a field is a MAJOR change.
- `build.sh` must inject `-X main.arch=wails`: `app/internal/update` uses it to tell artifact kinds
  apart.
- All UI copy, comments and commit bodies are **in Chinese**, matching the existing style.
- Branch names `feat/...` `fix/...` `docs/...` `chore/...`, Conventional Commits.
- Never disclose local privacy, sensitive data or network environment in PRs, issues, code, comments or
  commits.
- `AGENTS.md` (Chinese) and `CLAUDE.md` (this file) are two language versions of the same knowledge;
  **changing one requires updating the other**.

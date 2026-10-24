# CLAUDE.md

Guidance when working in this repository. Mirror of `AGENTS.md` (Chinese) — **keep the two in sync**.

This project has more coupling than its file count suggests: several things are **hand-maintained in
multiple places**, and missing one fails silently (no error, feature just doesn't work). Read
"Change-impact checklist" before touching anything.

---

## Commands

**The Wails build in `app/` is the main line.** The Electron build (`electron/` + `src/`) still
ships, but only maintains the existing auto-update channel and feature parity. The two command
sets are different — don't mix them:

```bash
# New architecture (main line)
pnpm install
pnpm --dir app/frontend install  # app/frontend is an independent package, not in the root workspace
bash app/scripts/build.sh        # single-file build: frontend + sidecar embedded
(cd app && wails dev)            # UI-only dev; no dependency sidecar (see below)
pnpm --dir app/frontend check    # svelte-check (tsc cannot see .svelte)
(cd app && go test ./...)        # Go core tests

# Old architecture (Electron, maintenance)
pnpm dev                         # vite dev server + electron, hot reload
pnpm build                       # vue-tsc + vite + electron-builder (current platform)
```

Requirements: **Node ≥ 22, pnpm ≥ 8, Go ≥ 1.25**, Wails CLI v2.16
(`go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`). yt-dlp / ffmpeg need *not* be preinstalled.

A direct `cd app && wails dev` build has **no dependency sidecar**, so the dependencies page only
shows "probe binary missing", with no build-time warning. `build.sh` compiles the sidecar into
`app/internal/sidecar/bin/` and embeds it with `-tags withsidecar`; to exercise dependency/download
paths in dev, use the `build.sh` artifact, or run `build.sh` once and then `wails dev -tags withsidecar`.
The Electron side uses `extraResources` in `electron-builder.json5` (pointing at
`backend/build/${platform}-${arch}`), so `pnpm dev` / `pnpm build` also compile the sidecar first.
Both paths fail loudly when Go is missing.

```bash
# New architecture (Wails)
(cd app && gofmt -l . && go vet ./... && go test -shuffle=on ./...)   # Go core
pnpm --dir app/frontend check                   # svelte-check (.svelte types only)
pnpm lint:i18n:app                              # app/frontend i18n pairs + t() keys
pnpm lint:boundaries                            # G1: no imports between app/internal packages
pnpm crosscheck:port                            # TS ↔ Go byte-for-byte comparison
pnpm test:e2e:real                              # real yt-dlp / ffmpeg E2E (skips explicitly)

# Old architecture (Electron)
pnpm vue-tsc --noEmit                           # renderer/main type check (strict + noUnusedLocals)
pnpm test                                       # pure-logic unit tests (Vitest, tests/*.test.ts)
pnpm test:runtime:windows                       # native Windows exe integration regression
pnpm test:download:integration                  # local HTTP/file/store integration regression
pnpm test:parse:integration                     # parser chain: fallbacks, round cap, cookie lifecycle
pnpm test:acceleration                          # acceleration benchmark; see docs/download-acceleration.md
pnpm test:updater                               # updater state machine, cache, fallback, install modes
pnpm test:settings:migration                    # settings defaults/merge + "no bypass" static scan
pnpm test:package                               # unpacked-artifact contents (needs a prior --dir build)
pnpm lint:ipc                                   # static check of the hand-maintained IPC wiring
pnpm lint:docker                                # container image definition
pnpm test:web                                   # WebUI server regression (bundled server)
pnpm build                                      # vue-tsc + vite build + electron-builder

# Required for both
pnpm lint:icons                                # icon names must be valid
pnpm lint:website                              # landing page assets / i18n / theme colors
pnpm lint:docs                                 # AGENTS.md ↔ CLAUDE.md parity + paths/numbers
pnpm audit:provenance                          # code-provenance audit (docs/provenance/audit.md)
pnpm lint:attribution                          # upstream notices must stay while code remains
pnpm lint:workflows                            # "uses tool X" ↔ "installs tool X"
pnpm sync:repo && pnpm sync:doc-numbers && pnpm sync:toolchain && pnpm sync:changelog
pnpm deps:manifest:check                       # is the dependency manifest behind upstream?
cd backend && gofmt -l . && go vet ./... && go test -shuffle=on ./...   # Go sidecar
```

CI runs most of this set, but the `app/` Go tests and `crosscheck:port` are **not** wired in yet —
run them locally whenever you touch `app/internal/*` or port logic across languages.

No ESLint/Prettier — **do not add them** (formatting churn would swamp the history). TypeScript is
pinned to 5.x: vue-tsc can't run on TypeScript 7 (the Go port drops `typescript/lib/tsc`); Dependabot
ignores its major bumps.

### Tests

Three layers: the **new Go core** (`app/internal/*/**_test.go`), the **Go sidecar**
(`backend/internal/*/**_test.go`) and **frontend pure logic** (`tests/*.test.ts`, Vitest,
`environment: 'node'` — deliberately no jsdom).

- Pure-logic unit tests cover **pure functions only**: format selection, dependency-error parsing,
  yt-dlp arg assembly, parser shared helpers, the updater state machine.
- Do **not** unit-test anything needing the DOM, a real subprocess or the network — send those to
  the integration regressions (`app/e2e_*.go`, `scripts/test-*`), or rely on type checks, `lint:ipc`
  and real-app verification.
- Target **branches that have actually broken before**, not coverage numbers.
- **Mutation-check every new test**: break the implementation, confirm the test fails.
  A test that cannot fail is worthless.
- Any module ported to Go needs a **dual-run comparison** (`pnpm crosscheck:port`); two green
  per-language suites do not prove identical behaviour — the first port turned "default concurrency
  8" into 1 while both suites stayed green.
- `vitest.config.ts` is separate from `vite.config.ts` on purpose — the latter runs `go build`
  in `buildStart`, which tests must not trigger.

### CI workflow split

Tests are split into three per-platform workflows (`.github/workflows/ci-linux.yml`, `ci-macos.yml`,
`ci-windows.yml`), each with its own jobs, so a failure names the platform *and* the layer:

| job | Contents |
| --- | --- |
| `backend` | `backend/` gofmt / vet / `go test -shuffle=on` / cross-compile (all 5 targets on Linux, host only on macOS/Windows) |
| `frontend` | old renderer type check / IPC contract / icon names / landing page / doc parity / provenance / attribution / boundaries / repo coordinates / CHANGELOG copy / doc numbers / toolchain / i18n / workflows / image definition / unit tests; **plus** `wails generate module` → `app/frontend` svelte-check and `lint:i18n:app` |
| `main-process` | Linux only: updater / settings migration / issue triage / manifest check / Web server regression |
| `integration` | download integration / acceleration benchmark / parse integration / real-tool E2E |
| `native-runtime` | Windows only: native exe runtime-deps regression |
| `package` / `packaging` | build / pack to a directory / artifact contents / manifest & release-notes script self-checks |

> **Known gap**: the `app/` Go tests (`cd app && go test ./...`) are **not** wired into the three
> workflows yet. Run them locally when touching `app/internal/*`; a green CI does not prove the Go
> core is verified.

**Every new test script must be wired into all three per-platform workflows** — `test:acceleration`
was once added without CI wiring and the acceleration logic went unverified for a long time. Likewise
**`git add` a new workflow file before committing**: when the single test workflow was split into
`ci-*.yml`, the deletion was staged while the three new files were still untracked, so one
`git commit -a` would have left `main` with no CI at all (`scripts/lint-docs.mjs` checks that every
workflow named in the docs exists).

---

## Cross-platform build traps

All of these have bitten us for real; the CI windows job caught most of them, not local macOS.

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
5. **Wails `universal` is not a Go `GOARCH`.** `wails build -platform darwin/universal` is lipo'd
   by Wails, but the sidecar is ours: `app/scripts/build.sh` must compile **both** arm64 and amd64,
   otherwise a universal build cannot find its sidecar and dependency detection silently degrades.
6. **Linux Wails builds need webkit2gtk-4.0.** Wails v2.16's cgo directives look for the 4.0 dev
   package by default; installing only 4.1 fails to compile (CI already hit this). The matching
   GTK / WebKit runtime libraries are also required at runtime.
7. **Wails frontends cannot use absolute asset paths.** Keep `base: './'` in
   `app/frontend/vite.config.ts`; changing it to `/` works in dev but 404s inside `embed.FS`
   (icons turn into text, and the build does not complain).

**Hard rule**: any new CI build/check step must first be reproduced locally under
non-host-platform semantics (cross-compile to `win32`, check out with `core.autocrlf=true`).
Validating YAML syntax is not enough.

---

## Architecture

The new architecture is a Go core (`app/internal/*`), a Wails desktop shell, a Svelte 5
frontend, and the shared Go sidecar. The old architecture is a Vue 3 renderer, a Node main
process, and the same sidecar. They talk over Wails bindings / IPC / NDJSON.

> **Two architectures coexist during the transition, but Wails is the main line.** The new one
> lives in `app/`; the old one (Electron) in `electron/` + `src/` only keeps the existing
> auto-update channel and feature parity. New features go to Wails first. See "Architecture
> transition" below.

### New architecture (`app/`, Go + Wails + Svelte 5) — main line

| Path | Contents | Output |
|------|----------|--------|
| `app/internal/*` | **Go core, 16 packages, zero cross-imports** (see below) | — |
| `app/main.go` / `app/app.go` / `app/bindings_*.go` | Wails shell: plumbing only, no business rules | `app/build/bin/` |
| `app/frontend/` | Svelte 5 + Vite renderer; the Go server can serve it too (the image has not switched yet) | embedded into the binary (`go:embed`) |
| `app/scripts/build.sh` | **build entry point**: compiles the sidecar, then builds with `-tags withsidecar` (use `wails dev` for hot reload; it has no sidecar) | single file ~18 MB |
| `app/cmd/downvid-server` | container / headless entry point (HTTP + WebSocket RPC; the image still runs the old TS server) | standalone binary |

The 16 packages under `app/internal/*`:

| Package | Responsibility |
|---|---|
| `changelog` | parses the copy of `CHANGELOG.md` (`//go:embed` cannot cross directories; `pnpm sync:changelog` syncs it) |
| `clipboard` | reads the system clipboard (`navigator.clipboard` triggers a permission dialog in the WebView) |
| `cookie` | cookie strategy, browser cookie extraction and snapshots (port of `electron/utils/cookies.ts`) |
| `deps` | dependency detection/download: runs the sidecar and converts NDJSON events; no candidate table here |
| `download` | yt-dlp arguments, progress lines, process-tree termination, aria2 progress |
| `fetch` | direct-URL chunked download and resume checkpoints |
| `history` | download history (atomic write + corruption recovery + win32 path normalisation) |
| `image` | Referer-aware thumbnail fetch into a data URL (hotlink protection) |
| `jsruntime` | Node / Deno probing (YouTube needs a real JS runtime) |
| `netx` | HTTP client with proxy support and proxy liveness probing |
| `parse` | site parsers, format dedupe, error classification, bounded YouTube fallback |
| `server` | container HTTP + WebSocket RPC (protocol matches `docker/web/bridge.ts`) |
| `settings` | `userData/settings.json` (13 fields, byte-for-byte identical to the TS version) |
| `shell` | open path / reveal in folder / free disk space |
| `sidecar` | embeds the dependency sidecar into the main binary and extracts it at runtime |
| `update` | update checks, self-update download/install, Wails artifact recognition and migration |

Packages under `app/internal/*` **must not import each other** (enforced by
`pnpm lint:boundaries`, rule G1). It is the property most worth protecting: every package
stays independently testable and replaceable, so swapping the transport
(Wails bindings → container WebSocket) stays cheap.

### Old architecture (Electron, maintenance only)

| Path | Contents | Output |
|------|----------|--------|
| `electron/` | main process | `dist-electron/` |
| `src/` | Vue 3 renderer | `dist/` |

Both Electron processes are built by `vite-plugin-electron/simple` from one `vite.config.ts`.
`vitest.config.ts` is **separate** from `vite.config.ts` because the latter runs `go build`
at buildStart and tests must not trigger that.

### Shared and peripheral

| Path | Contents | Output |
|------|----------|--------|
| `backend/` | Go dependency sidecar (detects and installs yt-dlp / ffmpeg); shared by both desktop architectures | Electron: `backend/build/<platform>-<arch>/`; Wails: compiled into `app/internal/sidecar/bin/` then embedded |
| `shared/app.ts` | **single source** of repo coordinates and external links | imported by all three |
| `tests/` | Vitest pure-logic tests | — |
| `docker/` | container image (entrypoint, virtual display and VNC orchestration; see `docs/docker.md`) | OCI image |
| `website/` | landing page (no build; published by Vercel's Git integration) | — |
| `scripts/` | manifest generation, all lints, release notes | — |

### Architecture transition (Electron → Wails)

Three stages, **no skipping**:

| Stage | Status | Notes |
|---|---|---|
| 1. Parallel release | **done** | Electron and Wails ship together. The Wails build uses a separate name (`DownVid-Wails-*`); Electron keeps its original channel |
| 2. Wails self-update | **done** | `app/internal/update/selfupdate.go`: download, verify and install for macOS zip / Windows NSIS / Linux AppImage. Migration is impossible without it |
| 3. Migrator | **in progress** | No separate NSIS/dmg wrapper: `release.yml`'s `migrate_to_wails` repoints the selected platform's `latest*.yml` at the Wails artifacts. Default **macOS**; Windows still needs NSIS `--updated` / `--force-run`, Linux needs confirmed AppImage artifacts |

**Why we cannot switch everything at once**: existing users rely on `electron-updater`, which reads
`latest*.yml` plus NSIS/dmg. Wails produces bare `.app`/`.exe`, which does not fit. Replacing
the artifacts directly leaves users seeing "update available" but unable to install —
worse than "no update detected", and that channel **can never be repaired once broken**.
Switch one platform at a time, after confirming that platform's Wails build can update itself.

Three constraints that must hold (all have tests):

1. **A non-migrated platform's `latest*.yml` may list Electron artifacts only.** The migration
   switch replaces the selected platform's manifest **entirely** with Wails entries (an explicit,
   one-way switch — never a mix). `gen-update-manifests.mjs` itself defaults to no migration;
   `release.yml` currently defaults to `macos`. Never mix Electron and Wails entries for the same
   platform (`scripts/test-updater.mjs` guards this).
2. **`arch` defaults to `electron`.** If it defaulted to `wails`, the transitional build would
   mistake itself for the new architecture and skip the electron-updater channel
   (`bindings_test.go` guards this). The Wails build injects `-X main.arch=wails` via `build.sh`.
3. **Migration is a one-way door.** There is no path back to Electron once the new architecture is
   installed; `app/internal/update/migration.go` only recognises artifacts and informs the user —
   "detected" must never be treated as "migrated".

### Change-impact checklist

> The two architectures have **different touch points**. Decide which line you are changing first;
> the only shared pieces are the `backend/` sidecar, repo coordinates in `shared/app.ts`, and
> release artifact naming.

**0. New architecture (Wails) touch points**

**Adding a renderer-callable backend capability**

1. Add an exported method in `app/bindings_*.go` (download/deps) or `app/app.go` (window/update/
   history/etc.). Wails generates `wailsjs` from the signature — no hand-written preload or IPC
   registration.
2. The frontend **must** go through `app/frontend/src/lib/backend.ts`; never `import wailsjs/...`
   from a component. In a browser that throws `Failed to resolve module` and blanks the page, and
   swapping transports would touch every call site.
3. Field names are a **byte-for-byte contract** between `app/frontend/src/lib/types.ts` and the Go
   struct JSON tags. A mismatch on an array field produces no type error — just blank UI.
4. Verify with `pnpm --dir app/frontend check` + `cd app && go test ./...`; if download/parse logic
   changed, run `pnpm crosscheck:port`.

**Adding a broadcast event (Go → frontend)**

1. `a.emit("event", data)` on the Go side (the `emit` helper in `app/app.go`).
2. Subscribe in `backend.ts` and **return an unsubscribe**; components must call it on unmount.
3. Record the event name and payload shape in `app/frontend/src/lib/types.ts`.

**Changing the settings shape**

- Wails stores `<dataDir>/settings.json`; the only entry point is
  `app/internal/settings/settings.go`, with the frontend mapping in `app/frontend/src/lib/settings.ts`.
  Field names / JSON keys / defaults must match the TS version **exactly**; only add fields (reads
  fill defaults). Removing or renaming is a MAJOR change.
- Electron still uses `localStorage['settings']` (see item 3 below). **Both stores coexist on
  purpose** during the migration; deleting one loses existing users' settings once.
- `app/frontend/scripts/check-settings-write.mjs` scans for writes that bypass the entry point.

**Changing frontend copy**

- The Wails copy table is `app/frontend/src/lib/i18n.svelte.ts` (**separate** from the old one).
- New keys must be paired zh/en; `pnpm lint:i18n:app` checks both directions and that every `t()`
  key exists.
- `t()` is reactive — never evaluate it at module top level; use `computed` / a getter.

**Changing dependencies / updates / containers**

- Dependency probing still belongs to the `backend/` sidecar; `app/internal/deps` only spawns it
  and converts NDJSON events. **Do not add a second candidate table** — that is exactly how the
  dependencies page and acceleration page came to disagree.
- The `DownVid-Wails-` prefix appears in `release.yml`, `app/internal/update/migration.go` and
  `scripts/verify-release.mjs`. Change all three together.
- The new container entry point is `app/cmd/downvid-server` (`app/internal/server`); the image
  still runs the old TS server. Do not migrate only half of it.

**Changing the Go core**

- Packages under `app/internal/*` must not import each other or `cmd` (`pnpm lint:boundaries`,
  rules G1 / G2).
- Run `gofmt -l .`, `go vet ./...`, `go test -shuffle=on ./...`; mutation-check new tests.
- Cross-language ports need a dual-run comparison (`pnpm crosscheck:port`); green suites on each
  side do not prove equal behaviour.

**1. New renderer-callable main capability → three files must change together (old Electron architecture):**

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

Existing: `deps:progress`, `download:progress`, `history:updated`, `update:status`, `menu:openSettings`, `menu:showAbout`.
A broadcast event must **not** double as an `ipcMain.handle` channel (`lint:ipc` enforces this).

**3. Changing user settings shape → silently breaks existing users (old Electron architecture; Wails in §0).**

The old architecture stores settings in `localStorage['settings']` (**not** Pinia).
The new architecture stores `<dataDir>/settings.json` (`app/internal/settings/settings.go`).
**Both must keep identical field names and defaults.** Fields: `downloadDir`,
`filenameTemplate`, `preferredQuality`, `cookieMode`, `cookiesFile`, `proxy`, `depPaths`,
`acceleration` (enabled/concurrency/optional aria2c path), `autoCheckUpdate` (default on),
`depMirror` (dependency download source: `'auto'` walks the mirror chain, or pin one; default
`'auto'`), `autoDownloadUpdate` (default off), `updateSource` (update source: `'auto'` falls back through the
chain, or pin one; see "Update sources" above; default `'auto'`), `language` (UI language: `'auto'`
follows the system, `'zh-CN'` or `'en-US'`; default `'auto'`).

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

**4. Runtime dependencies (yt-dlp / ffmpeg / ffprobe / aria2):**

- Both architectures share the sidecar and the manifest: the Wails side (`app/internal/deps`) only
  spawns the sidecar and converts NDJSON events; the Electron side uses `electron/utils/runtime.ts`.
  **The candidate table lives only in `backend/internal/runtime`** — never duplicate it on either
  side (that is exactly how the dependencies page and the acceleration page came to disagree).
- New dep kind → `backend/internal/runtime` (`Kinds`/`Optional`/candidates) + `DepKind` in `src/types/deps.ts`
- Source or version change → only edit the asset table in `scripts/gen-deps-manifest.mjs`, then
  `pnpm deps:manifest`. **Never hand-edit** `assets.gen.go` (generated)
- New platform → manifest asset table + `electron-builder.json5` + `release.yml` matrix
- Dependency downloads have a **mirror fallback** (`backend/internal/fetch/mirror.go`): assets live
  under `github.com/.../releases/download/...`, so an unreachable GitHub means **no dependencies and
  therefore an unusable app**. Chain: direct → gh-proxy.com → ghproxy.net → ghfast.top, first success
  wins. Switching emits a `mirror` event so the UI can say "switching source" — keep it distinct from
  `retry` (one changes route, the other repeats it). Only URLs actually hosted on a GitHub release are
  rewritten (`isUpstreamGitHub`): prepending a mirror to anything else yields 403 and breaks downloads
  that used to work (the httptest fixtures caught exactly that). A mirror may only be added after
  verifying it serves **release assets** (jsDelivr and Gitee cannot, hence they are not in this chain).
  `mirror.go` holds the chain, `mirror_test.go` verifies the flow, and `tests/deps-mirror.test.ts`
  cross-checks the mirror ids on both sides.
- **Non-network errors are not retried** (`retryable`): retrying a 4xx or a checksum mismatch replays
  the same outcome, and a 37MB file that can never connect would otherwise burn three attempts
  (plus 2s/4s backoff) before showing the same error.
- The `[[deps-missing:<kind>]]` marker is a contract between `electron/utils/binary.ts` (produces)
  and `readMissingKinds` in `src/stores/deps.ts` (parses) — covered by `tests/deps-error.test.ts`

**5. Changing release artifacts → cuts off auto-update for existing users.**

Names are referenced by older clients' `latest*.yml`. Renaming `DownVid-Setup-*`,
`DownVid-Portable-*`, `DownVid-<arch>-Mac-*`, `DownVid-x86_64-Linux-*` breaks every installed copy.
`lint:ipc` checks the `artifactName` entries. Linux uses `amd64`/`x86_64`, not `x64`.

Wails artifacts use the `DownVid-Wails-` prefix and sit in the same Release next to the Electron
ones. **Never rename them to the Electron pattern**: by default `latest*.yml` describes Electron
artifacts only, and a migrated platform's manifest is intentionally replaced with Wails entries —
mixing both for one platform makes existing users download something they cannot install. To move a
platform's auto-update, use `release.yml`'s `migrate_to_wails` input instead of editing names.

**6. Repo coordinates / links** live only in `shared/app.ts` (main re-exports via
`electron/constants.ts`). `electron-builder.json5`'s `publish` is build-time config that runtime
can't read — `lint:ipc` cross-checks it. Moving repos means editing `shared/app.ts` + `publish` +
workflow references, all three.

### 6.5 New or rewritten modules change the upstream ratio — provenance audit

`docs/provenance/` holds the deliverables of [issue #74](https://github.com/yxxbc/downvid/issues/74)
(provenance audit, target architecture, migration plan, release quality). Its numbers are recomputed
on the spot by `pnpm audit:provenance`:

- a new file with ≥15% (and ≥8 lines) verbatim from upstream Videdown **must be registered** in
  `scripts/data/provenance/registry.json`, otherwise CI fails
- a registered number that no longer matches reality fails too (run
  `node scripts/audit-provenance.mjs --write` first)
- numbers in `docs/provenance/audit.md` must match the measurement

The upstream snapshot lives in `scripts/data/provenance/upstream/` — **do not modify it**.
`docs/provenance/architecture.md` is the **historical** `core/` plan from issue #74; do not create
directories from it. The live boundaries are in `scripts/lint-boundaries.mjs`: Go rules G1
(packages under `app/internal` must not import each other) and G2 (internal must not import `cmd`),
plus TS rules 3–7 (kept until Electron is retired).

### 7. Landing page (`website/`)

Three local files — `website/index.html`, `styles.css`, `app.js` — **no build step**, published
straight from `main` by the Git integration of the Vercel project `downvid` (`vercel.json` sets `outputDirectory: "website"`,
site at <https://downvid-coral.vercel.app>). GitHub Pages is **no longer used**: the repo never
had Pages enabled in Settings, so `actions/configure-pages` only ever failed with
`Get Pages site failed` — that workflow is gone, and `pnpm lint:website` (frontend job of all three
`ci-*.yml`) does the checks instead.

Silent-failure traps, all covered by `lint:website`:

- **Referenced repo assets** (og:image, favicon, logo) use absolute
  `raw.githubusercontent.com/<owner>/<repo>/main/...` URLs — rename or delete a file and the
  live page shows a broken image with no local signal
- **i18n keys must pair both ways**: `data-i18n` placeholders ↔ `I18N.en` entries; a missing
  English entry silently keeps showing Chinese, and text the script composes (`t('...')` in the
  download area) also needs a Chinese entry in `I18N.zh` or the UI prints the raw key
- **Colors are copied by hand**: `--primary` etc. in the page's `:root` must match the
  `@theme` block in `src/style.css`
- **Zero dependencies**: only local `styles.css` / `app.js`; nothing but Google Fonts may be linked
  (`.vercelignore` excludes source dirs only — it validates nothing; `lint:website` rejects
  third-party scripts/stylesheets)
- **The download count and stars use shields.io badges**: the hero shows the same badges as the
  README, so the numbers are live and nothing has to be refreshed after a release. A badge is an
  `<img>`, so the zero-dependency rule still holds; `lint:website` compares the repo coordinates
  in the badge URL against `shared/app.ts` (a typo silently renders `no data`). The old
  `scripts/gen-website-stats.mjs` (`pnpm website:stats`) is gone.
- **Layout follows deepseek.com/harness**: centered hero + big preview, two-column card grid, code
  blocks with a copy button, a centered community CTA and a minimal footer. Colors still have to come
  from `src/style.css`'s `@theme`, and the details live in `website/README.md`.
- **The header has two shapes, switched by `is-stuck`**: flush with the top of the page it is a
  full-width bar; once you scroll past 12px it shrinks into a solid rounded capsule pinned to the
  top (the new UI no longer uses glass/blur) and returns to the bar when you scroll back up. It has
  **no nav links** — the page is meant to be scrolled straight through, brand on the left, language
  toggle on the right. Do not re-add a "Features / Download / FAQ" row.
- **The "What it does" cards are clickable demos**: platform / quality / browser are single-select
  groups (`data-pick-set`, with `data-pick-out` showing the matching size), the acceleration card
  is a four-level effort selector, dependency detection ticks the rows one by one, and the update
  card answers with the **real latest version**. All of it is front-end only; labels go through
  `t()` and `syncDemos()` re-renders them on a language switch — hook any new demo control into it.
- **The hero preview is an interactive replica of the app UI**, not a screenshot: structure, copy
  and colors are copied from the download-view components under `src/components/`, with the real
  parsing/download swapped for local animation. The canvas is designed at the app window's 1100px CSS
  width and scaled to fit with `transform: scale()`. It **starts on the new tool-first home**
  (command bar + effort slider + 44-week heatmap + recent downloads); parse opens the result view,
  download opens the queue. The thumbnail comes from
  `src/assets/demo-thumb.jpg` (the original preview image cropped out of the app screenshot, duration
  badge included) with the built-in SVG as a fallback. Keep it in sync when the app UI changes;
  `lint:website` compares the extra `@theme` color tokens it copies, and `syncAppDemo()` re-renders
  its labels on a language switch (hook any new control into it).
- **Platform icons live only in `#osIcons`**: the script clones them by `data-os` for the main button
  and the download menu, and `lint:website` cross-checks them against the script's `PLATFORMS`
  (a wrong key just means a missing icon, with no error).
- **The download button links straight to an artifact per OS**: the hero button detects the
  visitor's platform and chip in the browser, matches the `ARTIFACTS` name templates in
  `app.js` against the `releases/latest` asset list and points `href` at the artifact —
  one click downloads, no navigation. The response is cached in `sessionStorage` for 30 minutes;
  offline / rate-limited / missing asset / unknown OS all fall back to the Releases page (no dead
  link, no error dialog). `tests/website-download.test.ts` pins "which OS gets which package"
  against a real asset list (including distractors such as `.blockmap` and `latest*.yml`)
- **Artifact name templates fail silently**: the names in `ARTIFACTS` must match
  `electron-builder.json5`'s `artifactName` (`${arch}` varies by target: `x86_64` for
  AppImage / rpm, `amd64` for deb, `x64` for tar.gz). When they drift nothing errors — every
  platform just stops matching. `lint:website` checks the config and the test checks real asset
  names, so the two cover each other
- **Repo coordinates inside the page script**: the download button builds `github.com` /
  `api.github.com` URLs at runtime, so `REPO` must match `shared/app.ts` — the raw-link check
  above cannot see it

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

### Wails side (new architecture)

- `app/scripts/build.sh` compiles the sidecar into `app/internal/sidecar/bin/<goos>-<goarch>/`,
  then `//go:embed`s it into the main binary with `-tags withsidecar`; at runtime it lands in
  `<userData>/runtime/bin/downvid-deps` (same location as Electron, so upgrades don't leave two copies).
- `app/internal/deps` only spawns the sidecar, streams NDJSON events and caches detection for 60 s.
  **Candidate table, mirror chain, SHA-256, extraction, atomic replacement and macOS `xattr` /
  `codesign` all live in `backend/`** — do not duplicate any of it here.
- A build without `-tags withsidecar` (`go test`, plain `go build`, direct `wails build`) uses the
  stub: it compiles, but the dependencies page only shows "probe binary missing". That is deliberate;
  do not remove the warning.
- Show `Source` (system / managed / manual / scanned) and `Form` (zipapp / native) honestly in the UI:
  a `native` copy may take 9–12 s on first execution, which does not mean the file is corrupt.

### Parse performance (read before changing this)

**The yt-dlp build choice dominates parse time.** Measured on one machine, same bilibili video:

| Form | `--version` | Real parse |
| --- | --- | --- |
| `yt-dlp_macos` (PyInstaller onefile) | 9.5–10.5s | 11.4s |
| `yt-dlp` (Python zipapp) | 0.41s | **2.2s** |

The PyInstaller onefile unpacks ~72MB to a temp dir on every launch — 9 seconds of pure overhead that does
not vary with network or site, and users read it as "this app is slow". Therefore:

- Linux / macOS prefer **zipapp** (`YTDLP_ASSETS`) and also record the self-contained PyInstaller build as a
  fallback (`YTDLP_BUNDLED_ASSETS`); `manifest.HasUsablePython()` picks. **Windows does not use zipapp** —
  python3 is not commonly present there and the official `.exe` bundles its interpreter.
- The container **must** use the self-contained build (the image deliberately has no python3), which is why
  `scripts/deps-asset.mjs` selects `Bundled`.
- **Never spawn `--version` on the success path.** `readYtdlpVersion()` in `electron/parsers/ytdlp.ts` is
  failure-path only and caches 5 minutes; a second launch doubles parse time for a string that only matters
  in error diagnostics.
- Dependency probing runs **in parallel** (`FindAllContext`): every candidate is really executed, so serial
  probing costs the sum. With zipapp the whole probe is 0.47s, but the parallelism still matters on machines
  that fell back to PyInstaller (12s vs 22s).

### Parse dispatch (old architecture: `ytdlp:parse`)

Douyin and Kuaishou have bespoke parsers: platform API first, headless `puppeteer-core` (launched via
`electron/utils/browser.ts`) driving a *system-installed* Chrome/Edge as fallback. Every failure is
swallowed by an empty `catch` and falls through to `parseWithYtdlp`. When debugging a parse bug, check
which branch actually ran — the errors are invisible.

### Download has two entirely separate paths (old Electron architecture)

> The two architectures are compared function by function: the new one uses
> `app/internal/parse` (parsing + formats), `app/internal/download` (yt-dlp args / progress /
> process tree / aria2), `app/internal/fetch` (direct chunks) and `app/internal/netx` (proxy);
> the old one uses `electron/parsers` and `electron/download`. Before changing behaviour on one
> side, run `pnpm crosscheck:port` and update the other — one side's green tests are not "done".

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

Optional aria2c (>=1.36) is now a `DepKind` (`DEP_KINDS` in `shared/acceleration.ts`) and is probed by
the Go sidecar — **do not add a second candidate table to `electron/download/aria2.ts`**, that duplication is
exactly what made the dependencies page and the acceleration page disagree. `aria2.ts` keeps only version
parsing and "pull the aria2 entry out of the probe result". **Its detect/download UI lives on the Runtime
dependencies page**; the acceleration page keeps only the toggle and concurrency. **All five platforms can
one-click download**, but from **three different sources**: Linux/Windows from `abcfy2/aria2-static-build`
(zip, musl/mingw static), macOS arm64 from `ricode-labs/aria2` (tar.gz), macOS x64 from `static-build/aria2`
(raw Mach-O). `aria2Assets` therefore stores a **full URL per platform** instead of a shared base + tag — the
three sources use incompatible tag shapes (`1.37.0` / `aria2-1.37.0` / `latest`), and sharing one would build
404s. Do not switch to the Homebrew bottle: its binary links against `HOMEBREW_PREFIX/opt/openssl@4/...` and
cannot be copied out (dyld fails immediately) — that bottle is the origin of the **wrong conclusion** that
"macOS is system-package only".
Only HTTP transfers use it; HLS/DASH stay native. Temporary pieces live under `.downvid-aria2`
and a paused task keeps its selected engine, preventing sparse pieces from being treated as sequential data.
The `acceleration` settings field contains enabled/maxConnections/aria2Path.

**Version parsing must accept localised output.** The first line of `aria2c --version` follows
`LANG`: `aria2 version 1.37.0`, `aria2 版本 1.37.0`, Japanese likewise. The original regex only
matched the English form, so on Chinese/Japanese/German systems aria2 was **never detected** — the
acceleration toggle was on, transfers silently stayed single-threaded, and "detect" just said
"aria2c not found" with no error. `parseAria2Version()` now handles all forms (the Go side has the same rule in `probe.parseAria2Version`)
and execution pins `LC_ALL=C`; `tests/acceleration.test.ts` keeps a case per language.

Formats are built by the pure `electron/parsers/formats.ts`. Four regressions it guards (all tested):
keep formats without `vcodec` (X/Twitter mp4 has none), keep m3u8 only for heights with no direct link,
offer a `bv*+ba/b` fallback when nothing reports a height, and **keep exactly one entry per resolution**.

That last one was a real bug: bilibili serves three codecs per resolution (HEVC / AV1 / AVC) and fps is a
float where 29.969 and 29.97 are the same 30fps tier — a dedupe key using raw fps keeps both, so the UI showed
**two 1080P entries**. `normalizeFps()` now buckets fps, the key is `height + normalised fps`, and ties are
broken by **codec compatibility** (AVC > HEVC > AV1). Breaking ties by bitrate is wrong: AVC happens to have
the highest bitrate on bilibili so it "worked by luck", but on another site it would hand users the least
compatible codec.

Pause = **kill the whole process tree** (`killProcessTree` in `electron/download/process-tree.ts`), task
dropped from the main process's `electron/store.ts` `activeDownloads`. Resume re-spawns and continues from the
`.part` file. **No cross-restart resume.**

`child.kill()` only signals the direct child, and with aria2 the tree is three deep
(Electron → yt-dlp → aria2c). Killing just yt-dlp orphans aria2c, which keeps writing `.part`: the size grows
after "pause", bandwidth stays saturated, and the corrupted `.aria2` control file makes resume **restart the
whole file** (16MB sample re-transferred 16.8MB). Hence `detached: true` at spawn (new process group),
`-pid` signalling on pause, `taskkill /T /F` *before* killing the parent on Windows, and `SIGTERM` first with
a grace period so aria2c can flush its control file. `tests/process-tree.test.ts` pins all of this — **dropping
`detached` silently reintroduces the bug**.

### Task-level concurrency gate (old architecture: `src/stores/download-rules.ts`)

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
  so a GUI process with an old PATH can still find the runtime. After those it falls back to install dirs a GUI
  process never has on PATH (Finder/Dock apps get `/usr/bin:/bin:/usr/sbin:/sbin`, and nothing reads `.zshrc`):
  nvm / fnm / mise / asdf version dirs (supported versions only, newest first), Volta, n, keg-only Homebrew
  `node@NN`, MacPorts / Snap / Linuxbrew / Nix, plus nvm-windows / fnm / Volta / mise on Windows. Version dirs are
  matched by name only (`opt/node@22` and Windows junctions are links, so `isDirectory()` is false), and alias
  links such as mise's `22` / `latest` are skipped because their full-version target is listed anyway.
  Without these fallbacks a Node installed only through a version manager was invisible — `node -v` printed v22
  in a terminal while YouTube parsing said "needs Node.js 22+" (reported again and again, latest #80).
  The fallbacks come **after** every original candidate, so a runtime that was found before is still the one
  selected. The sidecar does not install JS runtimes.
  The Wails build uses the Go port in `app/internal/jsruntime` (same candidate table, version rule and budgets;
  `pnpm crosscheck:port --module=js-runtime` compares the two on a shared fake directory tree, including Node's
  `path.win32.join` edge cases). Its parse passes `--js-runtimes` and returns runtime-unavailable for YouTube
  without spawning yt-dlp, like the Electron one; without `--js-runtimes` yt-dlp only looks for deno on PATH.
  The binding caches only a *found* runtime (60 s): a "not found" must not be cached, or installing Node and
  retrying would keep failing.
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

#### New architecture (Wails)

| State | Where |
|-------|-------|
| App state (parse result / task queue / dialogs) | `app/frontend/src/lib/store.svelte.ts` (Svelte 5 runes singleton) |
| User settings | `userData/settings.json`, entry `app/internal/settings/settings.go`; frontend mapping in `app/frontend/src/lib/settings.ts` |
| Download history | `app/internal/history` → `userData/download-history.json` (atomic write) |
| Runtime dependencies | `app/internal/deps` (detection cached 60 s) |
| Updates | `app/internal/update` (check / self-update / migration recognition) |

**Every backend call must go through `app/frontend/src/lib/backend.ts`**: importing `wailsjs`
directly blanks the page in a browser, and swapping transports would otherwise touch every call site.

#### Old architecture (Electron)

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

- **The two copy tables are independent**: Wails uses `app/frontend/src/lib/i18n.svelte.ts`
  (`pnpm lint:i18n:app`); Electron uses `src/i18n/` (`pnpm lint:i18n`). Run only the check for the
  side you changed, and **do not copy keys between them**.
- Old architecture: **all UI strings go through `t('key')`** (`src/i18n/`); never write a literal. `pnpm lint:i18n`
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
- The Wails equivalent is `app/frontend/src/app.css`'s `@theme`; its colors must match the old
  version. `app/frontend/src/design-system.test.ts` pins the primary color, animated properties and
  durations.
- `@custom-variant dark` is declared but nothing ever toggles the class — there is **no dark mode
  toggle**; don't claim otherwise in docs.
- Icons: generic ones via `src/components/icons/MaterialIcon.vue` (Material Symbols). **Brand icons need
  a dedicated SVG component** (e.g. `GitHubIcon.vue`) — don't substitute a generic Material glyph (a
  `code` chevron was previously standing in for the GitHub mark).
- Most `window.electronAPI` call sites use optional chaining (`?.`) because module-level calls can run
  before preload finishes. Keep that habit.

---

## Release

```bash
# New architecture (Wails)
bash app/scripts/build.sh                              # current platform → app/build/bin/
bash app/scripts/build.sh -platform darwin/arm64
bash app/scripts/build.sh -platform darwin/universal   # sidecar built for arm64 + amd64

# Old architecture (Electron)
pnpm build:mac:arm64   # also :mac:x64 :win :linux:x64 :linux:arm64
```

Bump `package.json` → add a `## [x.y.z]` section to `CHANGELOG.md` → push tag `v*` (or run
`release.yml` manually with a `version` equal to `package.json`'s; the workflow creates the tag).

`release.yml` builds the 5 Electron arch targets plus the separate Wails artifacts, then regenerates
every `latest*.yml` from the **final artifacts** via `scripts/gen-update-manifests.mjs` (per-job
manifests would overwrite each other). `migrate_to_wails` decides which platforms' `latest*.yml`
point at Wails artifacts (default `macos`).

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

> **Transitional state**: the new architecture already has a Go server
> (`app/cmd/downvid-server` + `app/internal/server`), but the current image is still served by the
> old TS server (`docker/server/index.ts`). Both speak the same RPC protocol; migrating is a
> separate step — do not change half of the Dockerfile and assume the container moved.

DownVid in container runs as a **native WebUI**: a lightweight Node service (`docker/server/index.ts`) hosts
the static frontend and download engines; access it directly from any browser. The user guide is `docs/docker.md`.

**Zero frontend rewrite.** `src/` has no Electron-specific imports; all capabilities go through `window.electronAPI`.
In browser environments, `docker/web/bridge.ts` dynamically provides the identical API surface over WebSocket RPC.
Vue 3 components and Pinia stores remain 100% isomorphic.

**Shared core logic and architecture isolation.** The download engine (`electron/download/`), parsers, and dependency manager are
reused headlessly via `docker/server/electron-shim.ts`, leaving desktop codebase (`electron/` and `src/`) completely untouched.
Progress and events broadcast over WebSocket in container mode.

**Runtime dependencies preinstalled, versions from the manifest.** yt-dlp / ffmpeg / ffprobe static binaries go
into `/usr/local/bin` (inside the Go sidecar's system candidate paths, so they resolve as "system"). All three
**versions and SHA-256 come from `backend/internal/manifest/assets.gen.go`** via `scripts/deps-asset.mjs`, and are
verified at build time:

- the ffmpeg in the image is the **same byte stream** a desktop user gets by clicking "download", so encoders and
  merge behaviour match;
- `pnpm deps:manifest` bumps the image too, with no Dockerfile edit;
- **never** hard-code a version or hash in the Dockerfile (`pnpm lint:docker` rejects it).

Two choices look odd but were measured: yt-dlp is the `yt-dlp_linux` PyInstaller build (**no python3 needed**),
not the `yt-dlp` zipapp which needs an interpreter; ffmpeg is ffmpeg-static's static binary, not `apt install ffmpeg`
(apt drags in libllvm15 109MB, libgl1-mesa-dri 23MB, libicu72 36MB — 290MB of image for one binary).

**The server is bundled at build time.** `docker/server/vite.config.ts` compiles `docker/server/index.ts` plus the
`electron/` business code into `docker/dist-server/index.js`; runtime is just `node` — **no tsx, no node_modules**
(37MB saved, and startup no longer transpiles hundreds of modules). Vite's SSR build externalises every dependency
by default, hence the explicit `ssr.noExternal`; without it the image builds fine and the container dies with
`Cannot find package`.

**Container update check (`docker/server/update.ts`).** Inside a container the process runs on a read-only image
layer, so **any self-update disappears on the next `docker run`**. `app:checkForUpdates` therefore only reports
"is there a newer version" and returns the `docker compose pull` commands, with `manual` always `true`; the UI shows
those commands instead of "Download / Restart and install". Pulling the image is the only upgrade path. **Do not**
turn it back into a `{ hasUpdate: false }` constant: self-hosters keep an install for months, and a stale yt-dlp
degrades as sites change — silently, so users conclude "the downloader is broken".

**Images are published to GHCR (`ghcr.io/<owner>/downvid`).** Push to main tags `:latest`; a `v1.2.3` tag yields
`:1.2.3` and `:1.2`. GHCR packages default to **private** — flip it to public after the first publish, otherwise
pulls fail with a confusing denied / not-found mix. The workflow inspects the pushed manifest for both platforms and
actually runs `yt-dlp --version`: "push succeeded" is not the same as "users can pull it".

**Update sources (`shared/update-sources.ts`).** Update checks no longer ask only the GitHub API; they walk an
ordered chain `github → jsdelivr → ghproxy → gitee → website` and stop at the first success. Behind restrictive
networks `api.github.com` often fails, and **a failed check looks exactly like "you're up to date"** — the one class
of bug that cannot be fixed by shipping a new version, because the delivery channel itself is broken.
`shared/update-sources.ts` is pure data + pure functions (URLs, response normalisation, version comparison);
`shared/update-check.ts` only adds the request loop, with `fetch` injected (main process passes electron-updater's
session so the user's proxy applies; the container passes Node's fetch; tests pass a fake). The `updateSource`
setting accepts `'auto'` or a pinned source, and illegal values fall back to `'auto'` — a value that matches no
source would silently disable updates forever. Switching sources clears the check cache. `compareVersions` exists
exactly once, in `shared/update-sources.ts`: two copies would make the settings page and the update modal disagree
about whether an update exists. Adding a source means touching `UPDATE_SOURCE_IDS`, both i18n locales
(`updateSettings.source.<id>` plus the literal-key table in `SettingsView.vue`), and
`tests/update-sources.test.ts`. Gitee and jsDelivr additionally need the maintainer to mirror the repo there;
until then that source 404s, the chain skips it silently, and the other sources still work.

### Docker tests

`scripts/deps-asset.mjs` has its own unit tests inside `tests/update-sources.test.ts` (asset names, gzip-vs-raw,
TARGETARCH mapping). `scripts/test-web-server.mjs` always rebuilds `docker/dist-server` before running — an earlier
"reuse the existing bundle" shortcut meant local edits were tested against a stale build, which is a green that is
worse than a red.

**Data persistence.** Paths are driven by environment variables: `DOWNVID_DATA_DIR` points to `/data/userdata`,
`DOWNVID_DOWNLOADS` points to `/data/downloads`. Download records and media files persist via mounted volumes.

**Build conventions.** POSIX paths and LF endings (`.gitattributes`) are required; `docker/entrypoint.sh` must
stay LF. Build artifacts and local data directories are isolated via `.dockerignore`.

The `backend/build` entry in `.dockerignore` **must stay**: sidecar binaries built on the host belong to the host
platform (`darwin-*` on macOS) and would otherwise be copied into the Linux image (34MB measured). The Dockerfile
copies only `/out/<target-arch>`.

`/data` is a host bind mount whose owner is decided by the NAS / router. **Do not switch the image to a fixed uid** —
that makes "download directory not writable" the default outcome, and the error is yt-dlp's EACCES, which users will
not trace back to their mount's ownership. Deployments wanting least privilege set `user:` in compose.

After touching the Dockerfile / compose / entrypoint, run `pnpm lint:docker` and `pnpm test:web` locally. The latter
runs the **bundled** server (the same file the image runs): source that works is not the same as a bundle that works.

---

## Gotchas

- `app/frontend/vite.config.ts` must keep `base: './'`: Wails loads assets from `embed.FS`; absolute
  `/assets/...` paths 404 under `file://` or a reverse-proxied subpath (icons render as text while
  the build stays green).
- `wails generate module` compiles the Go package first, and `app/main.go` has
  `//go:embed all:frontend/dist`: the order is "prepare the embed dir
  (`app/scripts/prepare-embed-dir.sh`) → build the frontend → generate bindings". Generating first
  fails with `pattern all:frontend/dist: no matching files found`.
- `app/frontend` is an **independent package** (not in the root pnpm workspace): install with
  `pnpm --dir app/frontend install`, type-check with `pnpm --dir app/frontend check` — `pnpm vue-tsc`
  cannot see `.svelte` files.
- Wails settings live in `<dataDir>/settings.json`, Electron settings in `localStorage['settings']`.
  Field names/defaults must match, but **neither store may overwrite the other** during the migration.
- Wails updates live in `app/internal/update`: `selfupdate.go` downloads/verifies/installs,
  `migration.go` only recognises Wails artifacts and informs the user. `build.sh` must inject
  `-X main.arch=wails`, otherwise the new build reads Electron's `latest*.yml`.
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

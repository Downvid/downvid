# CLAUDE.md — DownVid developer quick reference

For anyone (or any AI) changing code in this repo. **This is an index, not a manual**:
details live in `docs/`, and only what would make you change the wrong thing is here.

How these docs are written: [`docs/doc-standards.md`](docs/doc-standards.md).

## Scope

Stay inside this repository: read the code, make the change, run the checks.
Do not expand a task into open-ended research.

When external information is genuinely required, say what you need and why first,
then consult the smallest source that answers the question.

## Before you call it done (the most important section)

**Passing the checks is not the same as getting it right.** Answer these three
questions first, then run the commands:

1. **What did I add?** Elements, buttons, decoration that were not there before?
2. **What did I miss?** Did I compare item by item against the original, or just
   glance at a screenshot?
3. **Where did I cut corners?** A generic widget standing in for a hand-built one,
   emoji standing in for icons, a hard-coded value standing in for something
   responsive?

For interface work the acceptance bar is **every element of the original, one by one** —
not "the screenshot looks about right".

## Quick start

Architecture: Go core + Wails desktop shell + Svelte 5 frontend, one file output.

```bash
pnpm install
pnpm --dir app/frontend install   # a separate package, not in the root workspace
bash app/scripts/build.sh         # end-to-end build
(cd app && wails dev)             # UI work only
```

Requires Node ≥ 22, pnpm ≥ 8, Go ≥ 1.25, Wails CLI v2.16.
yt-dlp / ffmpeg need **no** pre-install; see [`docs/dev/runtime-deps.md`](docs/dev/runtime-deps.md).

An app built by `wails dev` has **no dependency sidecar**, so the dependencies page
shows only "detection program missing" and the build does not warn. To verify the
dependency/download path you must use a product built by `build.sh`.

Install the Wails CLI with `go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`.

## Verification commands

```bash
(cd app && gofmt -l . && go vet ./... && go test -shuffle=on ./...)
(cd backend && gofmt -l . && go vet ./... && go test -shuffle=on ./...)
pnpm --dir app/frontend check        # svelte-check
pnpm --dir app/frontend test         # frontend pure-logic tests
pnpm test                            # root tests
pnpm lint:i18n:app
pnpm lint:boundaries                 # G1: app/internal packages must not import each other
pnpm lint:docs                       # this file <-> AGENTS.md <-> code
```

Three test layers: Go core, Go sidecar, frontend pure logic. Details in
[`docs/dev/testing.md`](docs/dev/testing.md).

**Mutate the code after writing a test**: break the logic under test and confirm the
test fails. A test that only checks one point often survives mutation — every branch
needs an input that can fail.

## Project layout

| Path | Contents |
| --- | --- |
| `app/internal/*` | Go core, 17 packages, **zero dependencies on each other** |
| `app/*.go` | Wails shell: moves data only, no business rules |
| `app/frontend/` | Svelte 5 frontend, embedded into the binary |
| `backend/` | Dependency sidecar (detects + downloads yt-dlp/ffmpeg/aria2) |
| `shared/` | Contracts shared by the frontend and the scripts |
| `website/` | Product landing page |
| `scripts/` | Validation / generation / release scripts |

`app/internal/*` packages must not import each other (`pnpm lint:boundaries` checks it).
That is the property worth protecting: every package tests and replaces on its own.

## Change checklist

The parts that fail silently. Each points at the detail doc.

### Adding a backend capability / broadcast event

The frontend may call backend code **only** through `app/frontend/src/lib/backend.ts`;
do not import `wailsjs` inside components. Field names are a literal contract:
`types.ts` and the Go JSON tags must match.
See [`docs/dev/frontend.md`](docs/dev/frontend.md).

### Changing settings / UI copy

- Settings have one entry point, `app/internal/settings/settings.go`, persisted to
  `userData/settings.json`: **add only**; removing or changing a field is MAJOR
- Copy lives in `app/frontend/src/lib/i18n.svelte.ts`; Chinese and English must pair
- `t()` is reactive: **do not evaluate it at module top level**

### Changing runtime dependencies

Detection belongs to `backend/`; **do not write a second candidate-path table** in
`app/internal/deps`. To change a download source or version, edit only
`scripts/gen-deps-manifest.mjs`, then run `pnpm deps:manifest`.
See [`docs/dev/runtime-deps.md`](docs/dev/runtime-deps.md).

### Changing release artifacts

Artifact names start with `DownVid-Wails-` and appear in **five places**; changing one
means changing all five. `pnpm lint:website` compares the website side.

### Changing repo coordinates

Single source of truth is `shared/app.ts`; `pnpm sync:repo` checks it.

### New or rewritten modules

A file with ≥15% (and ≥8 lines) taken verbatim from upstream Videdown must be listed in
`scripts/data/provenance/registry.json`, or `pnpm audit:provenance` fails.

## UI conventions

- `app/frontend` is a **separate package** (not in the root pnpm workspace): install with
  `pnpm --dir app/frontend install`, type-check with `pnpm --dir app/frontend check`
- All interface copy goes through `t('key')`; no literal Chinese in components
- **Tailwind v4** (CSS-first, no `tailwind.config.js`), semantic colour tokens in the
  `@theme` block of `app.css`
- **Use semantic tokens, never raw hex**
- Icons: general icons use `Icon.svelte` (Material Symbols font names);
  **brand icons get their own SVG component**, never a generic stand-in
- No router: `App.svelte` switches views by conditional rendering

## Download architecture essentials

- **Parse speed depends on the yt-dlp form**: zipapp 0.4s vs PyInstaller 10s;
  Linux/macOS use the zipapp
- **Two independent download paths**: `direct.go` (Douyin/Kuaishou direct URLs) and
  `run.go` (spawn yt-dlp)
- **Pause must kill the whole process tree**: `detached: true`, then signal `-pid`
- **The parse cache needs a record cap**: each entry holds a whole info JSON

See [`docs/dev/download.md`](docs/dev/download.md).

## Cross-platform build traps

The three most common:

1. **`process.platform` is not `GOOS`** (`win32` vs `windows`)
2. **The Windows runner defaults to PowerShell**, so `/tmp` resolves to `D:\tmp`
3. **Line endings**: `.gitattributes` normalises to LF — **do not delete that file**

See [`docs/dev/cross-platform.md`](docs/dev/cross-platform.md).

## Notes

- `wails generate module` compiles the Go packages first, and `app/main.go` has
  `//go:embed all:frontend/dist`. The order must be "prepare the embed directory
  (`app/scripts/prepare-embed-dir.sh`) -> build the frontend -> generate bindings";
  running generate first reports `pattern all:frontend/dist: no matching files found`
- `build.sh` must inject `-X main.arch=wails`; `internal/update` relies on it
- **All UI copy, comments and commit bodies are in Chinese**
- Branches `feat/…` `fix/…` `docs/…` `chore/…`, Conventional Commits
- **Never reveal local privacy, sensitive information or network environment**
- With no release planned, keep `package.json` at the last released version and record
  changes under `[Unreleased]`

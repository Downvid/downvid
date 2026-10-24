<div align="center">

<table>
  <tr>
    <td width="30%" align="center" valign="middle">
      <img src="src/assets/logo.png" alt="DownVid Logo" width="116" />
      <h1>DownVid</h1>
      <p><strong>Save the videos you like, locally.</strong></p>
      <p>Open source · Cross-platform · Simple</p>
    </td>
    <td width="70%" align="center" valign="middle">
      <img src="src/assets/screen.png" alt="DownVid desktop app preview" width="100%" />
    </td>
  </tr>
</table>

<p>
  <a href="https://github.com/Downvid/downvid/releases"><img src="https://img.shields.io/github/downloads/Downvid/downvid/total?style=flat&label=Downloads&logo=github&logoColor=white&color=2563eb" alt="Downloads" /></a>
  <a href="https://github.com/Downvid/downvid/releases/latest"><img src="https://img.shields.io/github/v/release/Downvid/downvid?style=flat&label=Release&logo=github&logoColor=white&color=0284c7" alt="Latest Release" /></a>
  <a href="https://github.com/Downvid/downvid/stargazers"><img src="https://img.shields.io/github/stars/Downvid/downvid?style=flat&label=Stars&logo=github&logoColor=white&color=eab308" alt="GitHub Stars" /></a>
  <a href="https://alternativeto.net/software/downvid/"><img src="https://img.shields.io/badge/AlternativeTo-DownVid-0289d5?style=flat&logo=alternativeto&logoColor=white" alt="AlternativeTo" /></a>
  <a href="https://github.com/Downvid/downvid/actions/workflows/ci-linux.yml"><img src="https://img.shields.io/github/actions/workflow/status/Downvid/downvid/ci-linux.yml?branch=main&label=CI%20Linux&logo=github-actions&logoColor=white&color=16a34a" alt="CI Linux" /></a>
  <a href="https://github.com/Downvid/downvid/actions/workflows/ci-macos.yml"><img src="https://img.shields.io/github/actions/workflow/status/Downvid/downvid/ci-macos.yml?branch=main&label=CI%20macOS&logo=github-actions&logoColor=white&color=16a34a" alt="CI macOS" /></a>
  <a href="https://github.com/Downvid/downvid/actions/workflows/ci-windows.yml"><img src="https://img.shields.io/github/actions/workflow/status/Downvid/downvid/ci-windows.yml?branch=main&label=CI%20Windows&logo=github-actions&logoColor=white&color=16a34a" alt="CI Windows" /></a>
  <a href="https://github.com/Downvid/downvid/actions/workflows/codeql.yml"><img src="https://img.shields.io/github/actions/workflow/status/Downvid/downvid/codeql.yml?branch=main&label=CodeQL&logo=github-actions&logoColor=white&color=16a34a" alt="CodeQL" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-7c3aed?style=flat&logo=open-source-initiative&logoColor=white" alt="MIT License" /></a>
</p>

<p>
  <a href="https://downvid-coral.vercel.app">Website</a>
  ·
  <a href="https://github.com/Downvid/downvid/releases">Download</a>
  ·
  <a href="./docs/benchmark.html">Benchmark</a>
  ·
  <a href="https://github.com/Downvid/downvid/issues">Report an issue</a>
  ·
  <a href="mailto:xynrin@icloud.com?subject=%5BDownVid%5D%20Business">Sponsorship / business</a>
  ·
  <a href="./docs/installation.md">Installation guide</a>
</p>

<p>
  <a href="./README.zh-CN.md">简体中文</a> | <strong>English</strong>
</p>

<p>
  <a href="https://www.producthunt.com/products/github-460eee39-2e5c-447d-b207-531e944feebd?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-downvid" target="_blank" rel="noopener noreferrer"><img alt="Downvid - Downvid | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1280091&amp;theme=light&amp;t=1792127974682"></a>
  <a href="https://trendshift.io/repositories/180707?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-180707" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/180707/daily?language=TypeScript" alt="Downvid/downvid | Trendshift" width="250" height="55" /></a>
</p>
</div>

---

## Sponsorship and business

Sponsorship, or business enquiries such as advertising placements — email **xynrin@icloud.com**:

| Enquiry | Contact |
| --- | --- |
| Sponsorship | <a href="mailto:xynrin@icloud.com?subject=%5BDownVid%5D%20Sponsorship">xynrin@icloud.com</a> |
| Business / advertising | <a href="mailto:xynrin@icloud.com?subject=%5BDownVid%5D%20Business">xynrin@icloud.com</a> |

Please use the [issue tracker](https://github.com/Downvid/downvid/issues) for bug reports and feature
requests instead, so that other users can find the answers too.

**The app itself contains no ads and never will.** These enquiries are about the project — for example
a placement in this README or on the [website](https://downvid-coral.vercel.app) — not about anything
shipped inside the installer.

---

> [!IMPORTANT]
> This project is a graphical front end for [yt-dlp](https://github.com/yt-dlp/yt-dlp). It contains no code for
> cracking or circumventing technical protection measures. Please follow your local laws, platform terms and
> copyright requirements; you are responsible for how you use it.

## Contents

- [Sponsorship and business](#sponsorship-and-business)
- [About](#about)
- [Features](#features)
- [Supported sites](#supported-sites)
- [Install](#install)
- [Build from source](#build-from-source)
- [Documentation](#documentation)
- [Tech stack and architecture](#tech-stack-and-architecture)
- [Project layout](#project-layout)
- [FAQ](#faq)
- [Contributing](#contributing)
- [Star history](#star-history)
- [License and credits](#license-and-credits)

## About

**DownVid** is a modern, high-performance, open-source desktop video downloader for **macOS**, **Windows**, and **Linux**.

Built as a graphical frontend for [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org/), it removes the complexity of command-line tools and provides a clean, native, and ad-free experience.

### Why DownVid?

- 🌐 **1000+ Platforms Supported**: Seamlessly extracts high-quality video and audio across YouTube, Bilibili, Douyin, TikTok, Xiaohongshu, Kuaishou, Twitter/X, Instagram, and more.
- ⚡ **Built-in Acceleration**: Optimized multi-part chunk worker queues (up to 16 threads) and optional aria2 integration ensure lightning-fast downloads.
- 🔒 **Zero Ads & Privacy-first**: No bundled third-party junk, no background telemetry, no forced watermarks. 100% open-source under the MIT license.
- 📦 **Zero-Config Sidecar**: Automatically detects existing system tools, or downloads and manages standalone yt-dlp & FFmpeg binaries in isolated user storage.
- 🎨 **Modern Design**: Designed with Material 3 design tokens, clean typography, responsive layout, and full cross-platform dark mode compatibility.

The project is under active development. If you hit a problem or have a suggestion, please
[open an issue](https://github.com/Downvid/downvid/issues).

## Features

| Feature | Description |
| --- | --- |
| Wide site support | 1000+ video and audio sites via yt-dlp; Douyin and Kuaishou have dedicated parsers |
| Quality and formats | 360P through 4K, audio-only (MP3), subtitles-only (SRT), YouTube multi-audio-track selection |
| Download management | Queue, pause, resume, retry, live progress with speed, ETA and file size |
| Download acceleration | Direct links use a small-chunk worker queue (8 by default, up to 16); optional aria2 multi-connection; concurrent HLS/DASH fragments |
| Logged-in content | Reads cookies from installed browsers, or import a `cookies.txt` manually |
| Runtime dependencies | Detects yt-dlp / FFmpeg already on your machine; downloads them in-app if missing |
| Download history | Keeps the last 100 downloads |
| Auto update | Updates through GitHub Releases; macOS verifies and swaps the app bundle in place |

## Supported sites

DownVid supports **1000+** video and audio sites through yt-dlp. A few common ones:

| China | International |
| --- | --- |
| Douyin, Xiaohongshu, Kuaishou, Xigua, Bilibili | YouTube, TikTok, Instagram, X (Twitter), Facebook |

For everything else see the [yt-dlp supported sites list](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).
Availability can change as sites change.

## Install

Download the latest build from [**GitHub Releases**](https://github.com/Downvid/downvid/releases) and pick the
package for your OS.

| Platform | Package | Architecture |
| --- | --- | --- |
| macOS | `DownVid-Wails-macOS-universal.zip` / `.dmg` | **Mainline (Wails)**: Universal standalone package (~18 MB, 1/7 size of legacy); or legacy DMG |
| Windows | `DownVid-Wails-windows-amd64.exe` / `.exe` | **Mainline (Wails)**: Single-binary portable executable; or legacy NSIS installer |
| Linux | `DownVid-Wails-linux-amd64` / `.AppImage` | **Mainline (Wails)**: Native standalone binary; or legacy AppImage / deb |

> [!TIP]
> **New Architecture (Wails)**: The mainline version is rewritten in Go 1.25 + Wails v2 + Svelte 5, shrinking the bundle size to ~18 MB (-81%), reducing idle memory to 60~80 MB (-60%), and launching instantly via native webviews. Legacy Electron packages continue to be published in parallel to preserve the auto-update channels.

Step-by-step instructions and common issues are in the [installation guide](./docs/installation.md).

### Run it in Docker

The container image runs a native WebUI (no X11, no VNC) — open a browser and you have the
full app, on desktop, tablet or phone:

```bash
# pull the official multi-arch image (amd64 + arm64)
docker run -d --name downvid -p 6080:6080 \
  -v "$PWD/data/downloads:/data/downloads" \
  -v "$PWD/data/userdata:/data/userdata" \
  ghcr.io/Downvid/downvid:latest
# then open http://127.0.0.1:6080/
```

Or, with compose (recommended — upgrades become one command):

```bash
curl -O https://raw.githubusercontent.com/Downvid/downvid/main/docker-compose.yml
docker compose up -d
# upgrade later: docker compose pull && docker compose up -d
```

yt-dlp / FFmpeg / ffprobe are preinstalled with **the same versions and hashes the desktop app
downloads**. Downloads land in `./data/downloads` on the host. Full details — configuration,
reverse proxy, upgrading, troubleshooting — are in the [Docker guide](./docs/docker.md).

## Build from source

### Requirements

- Node.js ≥ 22
- pnpm ≥ 8
- Go ≥ 1.25
- Wails CLI v2.16 (optional, for new architecture development)

yt-dlp and FFmpeg do **not** need to be installed beforehand. At runtime DownVid detects and reuses whatever
is already on your machine, and can download them in-app when missing.

### Steps

```bash
git clone https://github.com/Downvid/downvid.git
cd downvid
pnpm install

# New architecture (Wails mainline)
bash app/scripts/build.sh         # End-to-end single binary build (with embedded sidecar)
(cd app && wails dev)             # Quick UI development with hot reload

# Legacy architecture (Electron)
pnpm dev                          # Development mode
pnpm build                        # Package installer for current platform
```

Per-platform build commands, dependency notes and troubleshooting are in the
[build from source guide](./docs/build-from-source.md).

## Documentation

| Document | Contents |
| --- | --- |
| [Installation](./docs/installation.md) | Install instructions for macOS, Windows and Linux |
| [Docker](./docs/docker.md) | Run DownVid in a container, reach it from a browser |
| [Build from source](./docs/build-from-source.md) | Development environment, dependencies and build flow |
| [Troubleshooting](./docs/troubleshooting.md) | Common errors and how to diagnose them |
| [FAQ](./docs/faq.md) | Usage questions and answers |
| [Architecture](./docs/architecture.html) | Process structure, IPC and download flow |
| [Developer guide](./docs/development.md) | Code map, request lifecycle, IPC contract, debugging |
| [Project structure](./docs/project-structure.md) | Directory guide and where to make changes |
| [Repository standards](./docs/standards.md) | Branch, commit, issue and PR conventions |
| [Server mode](./docs/server-mode.md) | Docker / WebUI design rationale and boundaries |
| [Architecture governance](./docs/provenance/README.md) | Upstream provenance audit, target architecture, phased migration |
| [Release process](./docs/release.md) | Versioning and release artifact maintenance |
| [Contributing](./CONTRIBUTING.md) | How to contribute |
| [Security policy](./SECURITY.md) | How to report security issues |
| [Code of conduct](./CODE_OF_CONDUCT.md) | Community expectations |

> The in-depth docs are currently written in Chinese. Contributions that translate them are very welcome.

## Tech stack and architecture

### Tech stack

| Technology | Purpose |
| --- | --- |
| [Wails](https://wails.io/) | New architecture (mainline): lightweight desktop shell leveraging native system webviews |
| [Go](https://go.dev/) | Core backend (16 decoupled internal packages) and dependency sidecar |
| [Svelte 5](https://svelte.dev/) | New architecture frontend (Runes reactivity system) |
| [Electron](https://www.electronjs.org/) | Legacy architecture: cross-platform desktop shell |
| [Vue 3](https://vuejs.org/) | Legacy frontend |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Video and audio extraction engine |
| [FFmpeg](https://ffmpeg.org/) | Merging and transcoding |
| [Vitest](https://vitest.dev/) | Pure-logic unit tests |

### Architecture overview

```mermaid
flowchart LR
    subgraph WailsApp["Mainline Architecture (Wails)"]
        SvelteUI["Renderer<br/>Svelte 5"] <-->|"Go Bindings"| GoCore["Go Core<br/>16 Internal Packages"]
        GoCore <-->|"Embedded"| Sidecar["Sidecar<br/>yt-dlp / FFmpeg"]
    end
    subgraph LegacyApp["Legacy Architecture (Electron)"]
        VueUI["Renderer<br/>Vue 3"] <-->|"IPC"| Main["Main process<br/>Electron / Node.js"]
    end
```

An interactive diagram with more detail is in the [architecture doc](./docs/architecture.html).

## Project layout

| Directory | Purpose |
| --- | --- |
| `app/` | New architecture (mainline): Go + Wails + Svelte 5 desktop app (16 decoupled internal Go packages) |
| `backend/` | Go dependency sidecar: detects and installs runtime dependencies |
| `electron/` | Main process, IPC, download implementations, site parsers, updater |
| `src/` | Vue 3 renderer and UI |
| `shared/` | Repository coordinates and shared external links |
| `tests/` | Automated unit tests |
| `scripts/` | Build, manifest generation and validation scripts |
| `docs/` | Installation, build, architecture, maintenance and release docs |

See the [project structure doc](./docs/project-structure.md) for the full tree.

## FAQ

<details>
<summary><strong>It says yt-dlp or FFmpeg is missing. What now?</strong></summary>

The installer does not bundle them. DownVid looks for a usable copy already on your system at startup; if it
cannot find one, you can download it from the prompt, or manage it later under Settings → Runtime dependencies.
</details>

<details>
<summary><strong>macOS says the developer cannot be verified. What now?</strong></summary>

The first time you open it, right-click the app in Finder and choose **Open**, or allow it under
System Settings → Privacy & Security. If it still fails, see the [troubleshooting guide](./docs/troubleshooting.md).
</details>

<details>
<summary><strong>Some videos fail to download. What now?</strong></summary>

Many sites require you to be signed in. Make sure you are allowed to access the content, then let DownVid read
your browser session or import a `cookies.txt`. Site changes can also affect extraction success.
</details>

More in the [FAQ](./docs/faq.md) and [troubleshooting guide](./docs/troubleshooting.md).

## Contributing

Issues, documentation improvements and pull requests are all welcome.

Before submitting, please run:

```bash
pnpm vue-tsc --noEmit
pnpm test
pnpm lint:ipc
```

See the [contributing guide](./CONTRIBUTING.md) and [repository standards](./docs/standards.md) for the rest.

### Contributors

Thanks to everyone who has contributed to DownVid:

<a href="https://github.com/Downvid/downvid/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Downvid/downvid" alt="Contributors" />
</a>

## Star history

<a href="https://www.star-history.com/?repos=yxxbc%2Fdownvid&type=date&legend=bottom-right">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Downvid/downvid&type=date&theme=dark&legend=bottom-right" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Downvid/downvid&type=date&legend=bottom-right" />
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Downvid/downvid&type=date&legend=bottom-right" />
  </picture>
</a>

## License and credits

DownVid is released under the [MIT License](./LICENSE).

For the project name, logo, and third-party service attribution, see the [Brand and Trademark Usage Policy](./TRADEMARKS.md).

DownVid is developed and maintained by the [Downvid](https://github.com/Downvid) organization.
Copyright and license notices for all code in this repository are recorded in [LICENSE](./LICENSE).

Thanks also to the community contributors and to the maintainers of the projects we depend on:

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — extraction engine
- [FFmpeg](https://ffmpeg.org/) — audio and video processing
- [Electron](https://www.electronjs.org/) · [Vue.js](https://vuejs.org/) · [Tailwind CSS](https://tailwindcss.com/) — app stack
- [Claude Code](https://www.anthropic.com/claude) — AI coding assistant

### Supporting the project

If DownVid is useful to you, you can buy the author a coffee. WeChat tip code:

<details>
<summary>Show tip code</summary>

<img src="src/assets/donate.jpg" alt="WeChat tip code" width="240" />
</details>

For sponsorship and business enquiries, see [Sponsorship and business](#sponsorship-and-business) above.

---

<div align="center">

<a href="https://github.com/Downvid/downvid">DownVid</a> · Made with care by yxxbc

</div>

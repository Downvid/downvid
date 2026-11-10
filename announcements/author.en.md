---
title: Plugins Are Coming
date: 2026-11-11
signature: Black Cat
---

## Next release: installable plugins

Site parsing won't be limited to what ships in the app. The next version opens a **plugin system**: anyone can write a plugin so DownVid understands a new site. Install it and it works — no release from us required.

A plugin runs in its own runtime and does exactly one thing: **tell DownVid what a link is** — title, uploader, the available qualities, and a direct URL. Downloading stays inside DownVid, so resume, concurrent chunks and progress reporting behave the same as always.

## Why write one

- A site you care about isn't supported officially? Write it yourself, in a few dozen lines of JavaScript
- No Go, no patching the main app
- Every plugin makes the supported list a little longer

## How

The protocol, permissions, examples and submission steps live here:

[Plugin development guide](https://github.com/Downvid/downvid/blob/main/docs/dev/plugins.md)

Two things get a plugin listed: declare `"playback": "downvid-parser"` in its `plugin.json`, and tag the repository with `downvid-plugin`. The index picks it up automatically and it shows up in the in-app plugin list.

## A word on trust

Plugins are written and published by **third parties** and are not part of this project. We check that they install and don't obviously misbehave, but we can't promise they keep working, and we can't judge whether using one is acceptable for you.

Open the repository link in the plugin list and read the source — that's the part you can verify yourself. Plugins that misbehave are removed from the index, and removals are recorded publicly.

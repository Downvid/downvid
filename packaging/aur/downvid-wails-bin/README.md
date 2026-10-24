# AUR：`downvid-wails-bin`

新架构（Go + Wails）的 Linux 预编译包，供 `yay -S downvid-wails-bin` 使用。

## 为什么需要单独的 `-webkit41` 产物

官方 release 里的 `DownVid-Wails-linux-x64-*.tar.gz` 是在 Ubuntu 22.04 上链接
**webkit2gtk-4.0** 构建的。Arch 仓库现在只有 `webkit2gtk-4.1`，4.0 已不再提供，
直接装那个二进制会缺少 `libwebkit2gtk-4.0.so.37`。

所以 1.6.3 额外构建并上传了一份链接 4.1 的产物：

```
DownVid-Wails-linux-x64-webkit41-1.6.3.tar.gz
```

构建方式（`webkit2_41` 是 Wails 的构建标签）：

```bash
cd app
wails build -tags "withsidecar webkit2_41" \
  -ldflags "-s -w -X main.version=<版本> -X main.arch=wails"
```

AUR 包只依赖 `gtk3`、`webkit2gtk-4.1`、`libsoup3`，不依赖 4.0。

## 发新版本时

1. 用上面的命令构建 4.1 版本，打成只含 `downvid` 的 tar.gz，上传到对应 Release：
   `gh release upload v<版本> DownVid-Wails-linux-x64-webkit41-<版本>.tar.gz`
2. 更新 `PKGBUILD` 的 `pkgver` 与第一条 `sha256sums`（`sha256sum` 那个 tar.gz）。
3. 重新生成元数据：`makepkg --printsrcinfo > .SRCINFO`
4. 提交到 AUR（见下）。

`.SRCINFO` 里的 `source` 指向 GitHub Release、raw 图标与 LICENSE；本地只需要
`PKGBUILD`、`.SRCINFO`、`downvid.desktop`。

## 提交到 AUR

网页（不需要 SSH，适合网络受限的环境）：<https://aur.archlinux.org/submit/>，
上传只含 `PKGBUILD`、`.SRCINFO`、`downvid.desktop` 的 tar.gz。

或者用 git：

```bash
git clone ssh://aur@aur.archlinux.org/downvid-wails-bin.git
cd downvid-wails-bin
# 复制 PKGBUILD / .SRCINFO / downvid.desktop
git add -A && git commit -m "1.6.3-1"
git push
```

## 已知问题

- 1.6.3 的 4.1 产物是手工构建并补传到 Release 的；`release.yml` 目前仍只产出
  4.0 版本。后续应在 CI 里加一个 Ubuntu 24.04 / `webkit2_41` 的构建 job，
  否则每次发版都要手工补一次。

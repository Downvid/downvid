package jsruntime

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"
)

// 本文件是 tests/js-runtime.test.ts 的逐条移植：子测试名与 TS 侧的用例名逐字相同，
// 任何一条失败都能直接对上 TS 侧的同名用例。末尾两条是 Go 侧独有的真实进程用例。
//
// 背景（真实事故）：TS 版的 checkJsRuntime() 曾返回 Electron 二进制本身，并被当成
// deno 传给 yt-dlp，yt-dlp 照常执行它，**拉起了一整个 DownVid**。所以「哪些路径可以
// 当 node/deno 运行时」这条判定固定下来；直接调用实际实现，不在测试里复制一份逻辑。

// fakeTree 按目录返回假的目录项；表里没有的目录按「不存在」报错，和真实的 ReadDir 一样。
func fakeTree(tree map[string][]string) func(string) ([]Entry, error) {
	return func(dir string) ([]Entry, error) {
		names, ok := tree[dir]
		if !ok {
			return nil, fmt.Errorf("ENOENT: %s", dir)
		}
		entries := make([]Entry, 0, len(names))
		for _, n := range names {
			entries = append(entries, Entry{Name: n, IsDir: true})
		}
		return entries, nil
	}
}

func mapEnv(env map[string]string) func(string) string {
	return func(k string) string { return env[k] }
}

func pathsOf(list []Candidate) []string {
	out := make([]string, 0, len(list))
	for _, c := range list {
		out = append(out, c.Path)
	}
	return out
}

func TestLooksLikeNode(t *testing.T) {
	t.Run("排除 macOS 打包应用内的 Electron 二进制（正是事故现场）", func(t *testing.T) {
		for _, p := range []string{
			"/Applications/DownVid.app/Contents/MacOS/DownVid",
			"/Users/mac/Projects/downvid/release/1.3.0/mac-arm64/DownVid.app/Contents/MacOS/DownVid",
		} {
			if LooksLikeNode(p) {
				t.Errorf("%s 不该被当成 node", p)
			}
		}
	})
	t.Run("排除其它 Electron 应用（路径可能不含 .app，如开发态）", func(t *testing.T) {
		for _, p := range []string{
			"/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
			"/Users/x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
			"/usr/local/bin/electron",
		} {
			if LooksLikeNode(p) {
				t.Errorf("%s 不该被当成 node", p)
			}
		}
	})
	t.Run("接受真正的 node / deno", func(t *testing.T) {
		for _, p := range []string{
			"/usr/bin/node", "/usr/local/bin/node", "/opt/homebrew/bin/node", "/opt/homebrew/bin/deno",
			`C:\Program Files\nodejs\node.exe`,
		} {
			if !LooksLikeNode(p) {
				t.Errorf("%s 应被接受", p)
			}
		}
	})
	t.Run("大小写不敏感（Windows 路径常见）", func(t *testing.T) {
		if !LooksLikeNode(`C:\PROGRAM FILES\NODEJS\node.exe`) {
			t.Error("大写的 Windows 路径应被接受")
		}
		if LooksLikeNode(`C:\X\DownVid.APP\Contents\MacOS\DownVid`) {
			t.Error("大写的 .APP 也要排除")
		}
	})
}

func TestWindowsInstallDirFallbacks(t *testing.T) {
	t.Run("使用实际安装根目录并展开 WinGet 的 Deno 包", func(t *testing.T) {
		// 与 TS 侧的 mock 一致：每个目录都列出同一个 WinGet 包目录
		list := Candidates(Env{
			GOOS: "windows",
			Getenv: mapEnv(map[string]string{
				"PATH": "", "LOCALAPPDATA": `F:\Local`, "ProgramFiles": `D:\Programs`,
				"SCOOP": `E:\scoop`, "SCOOP_GLOBAL": `G:\scoop`,
			}),
			Home: `C:\Users\tester`,
			ReadDir: func(string) ([]Entry, error) {
				return []Entry{{Name: "DenoLand.Deno_test", IsDir: true}}, nil
			},
		})
		for _, want := range []Candidate{
			{Kind: KindDeno, Path: `F:\Local\Microsoft\WinGet\Packages\DenoLand.Deno_test\deno.exe`},
			{Kind: KindDeno, Path: `D:\Programs\WinGet\Links\deno.exe`},
			{Kind: KindDeno, Path: `E:\scoop\apps\deno\current\deno.exe`},
			{Kind: KindDeno, Path: `G:\scoop\shims\deno.exe`},
		} {
			if !slices.Contains(list, want) {
				t.Errorf("缺少候选 %+v", want)
			}
		}
	})

	// 下面三条与 TS 侧一样，用宿主平台的真实候选表 + 替身的文件检查与执行
	hostEnv := Env{
		Getenv: func(k string) string {
			if k == "PATH" {
				return ""
			}
			return os.Getenv(k)
		},
		ReadDir: func(string) ([]Entry, error) { return nil, errors.New("ENOENT") },
	}

	t.Run("旧 PATH 下仍能实际选择可运行的 Deno", func(t *testing.T) {
		suffix := "/.deno/bin/deno"
		if runtime.GOOS == "windows" {
			suffix += ".exe"
		}
		isFile := func(p string) bool { return strings.HasSuffix(strings.ReplaceAll(p, `\`, "/"), suffix) }
		run := func(context.Context, string) (string, error) { return "deno 2.3.0\nv8 test", nil }
		got := probe(context.Background(), Candidates(hostEnv), isFile, run)
		if !got.Available || got.Kind != KindDeno || got.Name != "Deno" || got.Version != "2.3.0" {
			t.Fatalf("应选中 ~/.deno/bin 里的 Deno，实际 %+v", got)
		}
	})

	t.Run("文件存在但不能运行时不报告可用", func(t *testing.T) {
		isFile := func(string) bool { return true }
		run := func(context.Context, string) (string, error) { return "", errors.New("不能执行") }
		if got := probe(context.Background(), Candidates(hostEnv), isFile, run); got.Available {
			t.Fatalf("执行失败时不能报告可用：%+v", got)
		}
	})

	t.Run("跳过过旧的 Node，继续选择受支持的 Deno", func(t *testing.T) {
		isFile := func(string) bool { return true }
		denoPath := regexp.MustCompile(`deno(?:\.exe)?$`)
		run := func(_ context.Context, p string) (string, error) {
			if denoPath.MatchString(p) {
				return "deno 2.3.0", nil
			}
			return "v21.9.0", nil
		}
		got := probe(context.Background(), Candidates(hostEnv), isFile, run)
		if !got.Available || got.Kind != KindDeno || got.Version != "2.3.0" {
			t.Fatalf("应跳过 v21 的 Node 选中 Deno，实际 %+v", got)
		}
	})
}

// 背景（反复出现的报告：#62、#64、#65、#66、#67、#71、#75、#80）：从 Finder / 程序坞 / 桌面启动的
// 应用只有精简 PATH，也不读 `.zshrc` / `.bashrc`。只装在 nvm、fnm、mise、asdf、Volta 或
// Homebrew `node@22` 里的 Node 一个都找不到，YouTube 解析直接报「需要可运行的 Node.js 22+」——
// 而用户在终端里 `node -v` 明明是 v22。
func TestVersionManagerFallbacks(t *testing.T) {
	const guiPath = "/usr/bin:/bin:/usr/sbin:/sbin"
	const home = "/Users/tester"
	mac := func(env map[string]string, tree map[string][]string) []Candidate {
		return Candidates(Env{GOOS: "darwin", Getenv: mapEnv(env), Home: home, ReadDir: fakeTree(tree)})
	}

	t.Run("nvm 的版本按数值从新到旧排列，跳过过旧版本与非版本目录", func(t *testing.T) {
		list := mac(map[string]string{"PATH": guiPath}, map[string][]string{
			"/Users/tester/.nvm/versions/node": {"v20.11.0", "v22.2.0", "v24.1.0", "v22.11.0", "lts", ".DS_Store"},
		})
		var nvm []string
		for _, p := range pathsOf(list) {
			if strings.Contains(p, "/.nvm/") {
				nvm = append(nvm, p)
			}
		}
		want := []string{
			"/Users/tester/.nvm/versions/node/v24.1.0/bin/node",
			"/Users/tester/.nvm/versions/node/v22.11.0/bin/node",
			"/Users/tester/.nvm/versions/node/v22.2.0/bin/node",
		}
		if !slices.Equal(nvm, want) {
			t.Fatalf("got %q\nwant %q", nvm, want)
		}
	})

	t.Run("覆盖 fnm、mise、asdf、Volta、n、Homebrew keg-only 与 MacPorts 的实际布局", func(t *testing.T) {
		list := mac(map[string]string{"PATH": guiPath}, map[string][]string{
			"/Users/tester/.config/nvm/versions/node":                     {"v22.11.0"},
			"/Users/tester/Library/Application Support/fnm/node-versions": {"v22.11.0"},
			"/Users/tester/.local/share/mise/installs/node":               {"22.11.0", "22", "latest"},
			"/Users/tester/.local/share/mise/installs/deno":               {"2.2.9", "2.3.1"},
			"/Users/tester/.asdf/installs/nodejs":                         {"22.11.0"},
			"/Users/tester/.volta/tools/image/node":                       {"22.11.0"},
			"/opt/homebrew/opt":                                           {"node@20", "node@22", "node@24", "node", "deno", "openssl@3"},
		})
		for _, want := range []Candidate{
			{Kind: KindNode, Path: "/Users/tester/.config/nvm/versions/node/v22.11.0/bin/node"},
			{Kind: KindNode, Path: "/Users/tester/Library/Application Support/fnm/node-versions/v22.11.0/installation/bin/node"},
			{Kind: KindNode, Path: "/Users/tester/.local/share/mise/installs/node/22.11.0/bin/node"},
			{Kind: KindDeno, Path: "/Users/tester/.local/share/mise/installs/deno/2.3.1/bin/deno"},
			{Kind: KindNode, Path: "/Users/tester/.asdf/installs/nodejs/22.11.0/bin/node"},
			{Kind: KindNode, Path: "/Users/tester/.volta/bin/node"},
			{Kind: KindNode, Path: "/Users/tester/.volta/tools/image/node/22.11.0/bin/node"},
			{Kind: KindNode, Path: "/Users/tester/n/bin/node"},
			{Kind: KindNode, Path: "/opt/local/bin/node"},
		} {
			if !slices.Contains(list, want) {
				t.Errorf("缺少候选 %+v", want)
			}
		}
		paths := pathsOf(list)
		var brew []string
		for _, p := range paths {
			if strings.HasPrefix(p, "/opt/homebrew/opt/") {
				brew = append(brew, p)
			}
		}
		if want := []string{"/opt/homebrew/opt/node@24/bin/node", "/opt/homebrew/opt/node@22/bin/node"}; !slices.Equal(brew, want) {
			t.Errorf("Homebrew keg-only：got %q want %q", brew, want)
		}
		// mise 的 `22` / `latest` 只是指向完整版本目录的别名；Deno 2.2 低于最低版本
		for _, bad := range []string{
			"/Users/tester/.local/share/mise/installs/node/22/bin/node",
			"/Users/tester/.local/share/mise/installs/deno/2.2.9/bin/deno",
		} {
			if slices.Contains(paths, bad) {
				t.Errorf("不该出现 %s", bad)
			}
		}
	})

	t.Run("尊重用户改过的根目录（NVM_DIR、FNM_DIR、MISE_DATA_DIR、ASDF_DATA_DIR、VOLTA_HOME、N_PREFIX）", func(t *testing.T) {
		paths := pathsOf(mac(map[string]string{
			"PATH": guiPath, "NVM_DIR": "/data/nvm", "FNM_DIR": "/data/fnm", "MISE_DATA_DIR": "/data/mise",
			"ASDF_DATA_DIR": "/data/asdf", "VOLTA_HOME": "/data/volta", "N_PREFIX": "/data/n",
		}, map[string][]string{
			"/data/nvm/versions/node":    {"v22.11.0"},
			"/data/fnm/node-versions":    {"v22.11.0"},
			"/data/mise/installs/node":   {"22.11.0"},
			"/data/asdf/installs/nodejs": {"22.11.0"},
		}))
		for _, want := range []string{
			"/data/nvm/versions/node/v22.11.0/bin/node",
			"/data/fnm/node-versions/v22.11.0/installation/bin/node",
			"/data/mise/installs/node/22.11.0/bin/node",
			"/data/asdf/installs/nodejs/22.11.0/bin/node",
			"/data/volta/bin/node",
			"/data/n/bin/node",
		} {
			if !slices.Contains(paths, want) {
				t.Errorf("缺少候选 %s", want)
			}
		}
	})

	t.Run("兜底候选排在原有候选之后：原来能找到的运行时，选中的仍是同一个", func(t *testing.T) {
		paths := pathsOf(mac(map[string]string{"PATH": "/custom/bin"}, map[string][]string{
			"/Users/tester/.nvm/versions/node": {"v22.11.0"},
		}))
		nvm := slices.Index(paths, "/Users/tester/.nvm/versions/node/v22.11.0/bin/node")
		for _, original := range []string{"/custom/bin/node", "/usr/local/bin/node", "/opt/homebrew/bin/node", "/Users/tester/.deno/bin/deno"} {
			i := slices.Index(paths, original)
			if i < 0 || i >= nvm {
				t.Errorf("%s（位置 %d）应排在 nvm 候选（位置 %d）之前", original, i, nvm)
			}
		}
	})

	t.Run("Windows：nvm-windows、fnm、Volta、mise 的版本目录（GUI 进程的 PATH 里没有它们）", func(t *testing.T) {
		const winHome = `C:\Users\tester`
		tree := fakeTree(map[string][]string{
			`D:\nvm`:                            {"v20.11.0", "v22.11.0", "elevate.cmd", "settings.txt"},
			`C:\Users\tester\AppData\Local\nvm`: {"v24.1.0"},
			`C:\Users\tester\AppData\Roaming\fnm\node-versions`:    {"v24.1.0"},
			`C:\Users\tester\AppData\Local\Volta\tools\image\node`: {"22.11.0"},
			`C:\Users\tester\AppData\Local\mise\installs\node`:     {"22.11.0", "22", "latest"},
			`C:\Users\tester\AppData\Local\mise\installs\deno`:     {"2.3.1"},
		})
		list := Candidates(Env{
			GOOS:    "windows",
			Getenv:  mapEnv(map[string]string{"PATH": "", "NVM_HOME": `D:\nvm`, "NVM_SYMLINK": `E:\node-current`}),
			Home:    winHome,
			ReadDir: tree,
		})
		for _, want := range []Candidate{
			{Kind: KindNode, Path: `E:\node-current\node.exe`},
			{Kind: KindNode, Path: `D:\nvm\v22.11.0\node.exe`},
			{Kind: KindNode, Path: `C:\Users\tester\AppData\Local\nvm\v24.1.0\node.exe`},
			{Kind: KindNode, Path: `C:\Users\tester\AppData\Roaming\fnm\node-versions\v24.1.0\installation\node.exe`},
			{Kind: KindNode, Path: `C:\Users\tester\AppData\Local\Volta\tools\image\node\22.11.0\node.exe`},
			{Kind: KindNode, Path: `C:\Users\tester\AppData\Local\mise\installs\node\22.11.0\node.exe`},
			{Kind: KindDeno, Path: `C:\Users\tester\AppData\Local\mise\installs\deno\2.3.1\bin\deno.exe`},
		} {
			if !slices.Contains(list, want) {
				t.Errorf("缺少候选 %+v", want)
			}
		}
		paths := pathsOf(list)
		for _, bad := range []string{`D:\nvm\v20.11.0\node.exe`, `C:\Users\tester\AppData\Local\mise\installs\node\22\node.exe`} {
			if slices.Contains(paths, bad) {
				t.Errorf("不该出现 %s", bad)
			}
		}
		// 没有 NVM_SYMLINK 时（应用早于 nvm-windows 启动、继承的是旧环境）用安装程序的默认位置
		defaults := Candidates(Env{GOOS: "windows", Getenv: mapEnv(map[string]string{"PATH": ""}), Home: winHome, ReadDir: tree})
		if want := (Candidate{Kind: KindNode, Path: `C:\nvm4w\nodejs\node.exe`}); !slices.Contains(defaults, want) {
			t.Errorf("缺少候选 %+v", want)
		}
	})
}

func TestMinimumVersions(t *testing.T) {
	t.Run("只接受 Node 22+ 的真实版本输出", func(t *testing.T) {
		for output, want := range map[string]string{"v21.9.0": "", "v22.0.0": "22.0.0", "deno 2.3.0": ""} {
			if got := SupportedVersion(KindNode, output); got != want {
				t.Errorf("SupportedVersion(node, %q) = %q, want %q", output, got, want)
			}
		}
	})
	t.Run("只接受 Deno 2.3+，拒绝不匹配的程序输出", func(t *testing.T) {
		for output, want := range map[string]string{
			"deno 2.2.9": "", "deno 2.3.0 (stable)\nv8 test": "2.3.0", "deno 3.0.0": "3.0.0", "v22.0.0": "",
		} {
			if got := SupportedVersion(KindDeno, output); got != want {
				t.Errorf("SupportedVersion(deno, %q) = %q, want %q", output, got, want)
			}
		}
	})
}

// ===== Go 侧独有 =====

// WinGet 的 Packages 目录里只有**目录**才是包；同名前缀的普通文件不能当成 Deno 的安装位置。
// （TS 侧的 mock 把每一项都报告成目录，这一条在那边测不到。）
func TestWinGetPackagesMustBeDirectories(t *testing.T) {
	list := Candidates(Env{
		GOOS:   "windows",
		Getenv: mapEnv(map[string]string{"PATH": "", "LOCALAPPDATA": `F:\Local`}),
		Home:   `C:\Users\tester`,
		ReadDir: func(dir string) ([]Entry, error) {
			if dir != `F:\Local\Microsoft\WinGet\Packages` {
				return nil, errors.New("ENOENT")
			}
			return []Entry{{Name: "DenoLand.Deno_dir", IsDir: true}, {Name: "DenoLand.Deno_file", IsDir: false}}, nil
		},
	})
	paths := pathsOf(list)
	if !slices.Contains(paths, `F:\Local\Microsoft\WinGet\Packages\DenoLand.Deno_dir\deno.exe`) {
		t.Error("目录形式的 WinGet 包应成为候选")
	}
	if slices.Contains(paths, `F:\Local\Microsoft\WinGet\Packages\DenoLand.Deno_file\deno.exe`) {
		t.Error("普通文件不是 WinGet 包，不该成为候选")
	}
}

// ===== Go 侧独有：真实进程 =====

// writeScript 写一个假的运行时（shell 脚本），Windows 上跳过。
func writeScript(t *testing.T, path, body string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("用 shell 脚本做夹具，Windows 上跳过")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body), 0o755); err != nil {
		t.Fatal(err)
	}
}

// checkUnder 用真实的候选表与真实执行，但只承认 home 下的文件。
//
// 宿主机自己的 /usr/local/bin/node 之类排在版本管理器之前（这是刻意的顺序），
// 不过滤的话用例会选中宿主的 node，测的就不是这里要测的东西了。
func checkUnder(home string, env map[string]string) Info {
	inHome := func(p string) bool { return strings.HasPrefix(p, home+string(filepath.Separator)) && isRegularFile(p) }
	return probe(context.Background(), Candidates(Env{Getenv: mapEnv(env), Home: home}), inHome, runVersion)
}

// 精简 PATH 下实际选中 nvm 里的 Node 22（正是事故现场）：真的执行、真的读版本。
func TestCheckFindsNvmNodeWithGuiPath(t *testing.T) {
	home := t.TempDir()
	writeScript(t, filepath.Join(home, ".nvm/versions/node/v20.11.0/bin/node"), "echo v20.11.0\n")
	writeScript(t, filepath.Join(home, ".nvm/versions/node/v22.11.0/bin/node"), "echo v22.11.0\n")
	got := checkUnder(home, map[string]string{"PATH": "/usr/bin:/bin:/usr/sbin:/sbin"})
	want := filepath.Join(home, ".nvm/versions/node/v22.11.0/bin/node")
	if !got.Available || got.Path != want || got.Version != "22.11.0" || got.Name != "Node.js" {
		t.Fatalf("应选中 nvm 的 v22，实际 %+v", got)
	}
}

// 卡住的候选不能把后面的正常副本饿死。
//
// 第一个候选是 shell 脚本，它的孙进程一直占着 stdout：超时只杀得掉脚本本身，
// 没有 WaitDelay 时 Wait 要等孙进程退出（10 秒），6 秒的总预算会被它一口吃光。
// 输出过长的候选也必须被拒（TS 版 maxBuffer 的语义）：它先打出一个合法版本号、后面跟一大堆空白，
// 截断后的前 16KB 照样能匹配，所以只有「超长即失败」这条规则能把它拦下。
func TestCheckSkipsHungAndNoisyCandidates(t *testing.T) {
	home := t.TempDir()
	hung := filepath.Join(home, "hung", "node")
	noisy := filepath.Join(home, "noisy", "node")
	writeScript(t, hung, "sleep 10 &\nsleep 10\n")
	writeScript(t, noisy, "echo v22.11.0\ni=0\nwhile [ $i -lt 2000 ]; do echo \"          \"; i=$((i+1)); done\n")
	writeScript(t, filepath.Join(home, ".nvm/versions/node/v22.11.0/bin/node"), "echo v22.11.0\n")

	start := time.Now()
	got := checkUnder(home, map[string]string{"PATH": filepath.Dir(hung) + ":" + filepath.Dir(noisy)})
	elapsed := time.Since(start)
	want := filepath.Join(home, ".nvm/versions/node/v22.11.0/bin/node")
	if !got.Available || got.Path != want {
		t.Fatalf("应跳过卡住与输出过长的候选、选中 nvm 的 v22，实际 %+v（用时 %v）", got, elapsed)
	}
	if elapsed > 4*time.Second {
		t.Fatalf("卡住的候选拖了 %v（应约为 1 秒预算 + WaitDelay）", elapsed)
	}
}

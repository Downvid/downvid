package main

import (
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/Downvid/downvid/app/internal/download"
	"github.com/Downvid/downvid/app/internal/parse"
)

// pickVideo 选一个视频格式：显式 format ID 优先，否则按最高分辨率上限挑。
func pickVideo(info *parse.VideoInfo, quality, format string) (parse.Format, error) {
	if format != "" {
		for _, f := range info.Formats {
			if f.FormatID == format {
				return f, nil
			}
		}
		// 允许直接传 yt-dlp 选择器（如 137+140 / bestvideo[height<=1080]）。
		// 带 + 的视为已经包含音轨，否则下载时由 BuildArgs 补 bestaudio。
		return parse.Format{
			FormatID: format,
			Quality:  format,
			Ext:      "mp4",
			HasAudio: strings.Contains(format, "+"),
		}, nil
	}

	if len(info.Formats) == 0 {
		// 站点没给可用分辨率时交给 yt-dlp 自己选。
		return parse.Format{FormatID: "bv*+ba/b", Quality: "最佳画质", Ext: "mp4", HasAudio: true}, nil
	}

	q := strings.ToLower(strings.TrimSpace(quality))
	if q == "" || q == "best" {
		return info.Formats[0], nil
	}
	h, err := strconv.Atoi(strings.TrimSuffix(q, "p"))
	if err != nil || h <= 0 {
		return parse.Format{}, fmt.Errorf("无效的清晰度 %q：用 best 或 2160/1440/1080/720/480/360", quality)
	}
	for _, f := range info.Formats {
		if f.Height > 0 && f.Height <= h {
			return f, nil
		}
	}
	return parse.Format{}, fmt.Errorf("没有不高于 %dp 的格式（最高 %dp）", h, info.Formats[0].Height)
}

// pickAudio 选最高码率的纯音频格式；没有音频格式列表时交给 yt-dlp。
func pickAudio(info *parse.VideoInfo) parse.AudioFormat {
	if len(info.AudioFormats) > 0 {
		return info.AudioFormats[0]
	}
	return parse.AudioFormat{FormatID: "bestaudio", Quality: "最佳音质", Ext: "mp3"}
}

// printFormats 打印可供 --format 使用的格式 ID。
func printFormats(w io.Writer, info *parse.VideoInfo) {
	fmt.Fprintf(w, "%s\n\n", info.Title)
	if len(info.Formats) == 0 && len(info.AudioFormats) == 0 {
		fmt.Fprintln(w, "这个链接没有返回可列出的格式；直接用 -q best 下载即可。")
		return
	}
	if len(info.Formats) > 0 {
		fmt.Fprintln(w, "视频:")
		fmt.Fprintln(w, "  ID         EXT   分辨率        FPS  音频  大小         说明")
		for _, f := range info.Formats {
			res := "-"
			if f.Width > 0 && f.Height > 0 {
				res = fmt.Sprintf("%dx%d", f.Width, f.Height)
			} else if f.Height > 0 {
				res = fmt.Sprintf("%dp", f.Height)
			}
			audio := "无"
			if f.HasAudio {
				audio = "有"
			}
			size := download.FormatBytesInt(f.Filesize)
			if size == "" {
				size = "-"
			}
			fmt.Fprintf(w, "  %-9s  %-4s  %-12s  %-4d  %-4s  %-11s  %s\n",
				f.FormatID, f.Ext, res, f.FPS, audio, size, f.Quality)
		}
	}
	if len(info.AudioFormats) > 0 {
		fmt.Fprintln(w, "\n音频:")
		fmt.Fprintln(w, "  ID         EXT   码率/说明     大小")
		for _, f := range info.AudioFormats {
			size := download.FormatBytesInt(f.Filesize)
			if size == "" {
				size = "-"
			}
			fmt.Fprintf(w, "  %-9s  %-4s  %-12s  %s\n", f.FormatID, f.Ext, f.Quality, size)
		}
	}
}

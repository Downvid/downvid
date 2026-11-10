package parse

import (
	"testing"
)

// 纯音频站点（SoundCloud / 音乐平台）必须被识别成歌曲并给出音质列表。
//
// 变异点（修之前真实存在的问题，已用真实 yt-dlp 输出验证）：
//
//	formats=1 audioFormats=0 tracks=0
//	video fmt bv*+ba/b "最佳画质" hasAudio=true
//
// 即：一首歌被说成「最佳画质」的视频，音质列表却是空的——用户既选不到音质，
// 又被引导去下「视频」。
func TestAudioOnlySiteIsRecognized(t *testing.T) {
	raw := &rawInfo{
		ID: "1", Title: "Flickermood", Duration: 200,
		Track: "Flickermood", Artist: "Forss",
		Formats: []rawFormat{
			{FormatID: "hls_aac_96k", Vcodec: "none", Acodec: "mp4a.40.2", Ext: "m4a", ABR: 96},
			{FormatID: "hls_aac_160k", Vcodec: "none", Acodec: "mp4a.40.2", Ext: "m4a", ABR: 160},
		},
	}
	p := NewParser()
	info := p.buildInfo(raw, false, false, ParseOptions{URL: "https://soundcloud.com/x/y"})

	if len(info.AudioFormats) == 0 {
		t.Fatal("纯音频站点必须有音质列表（audioFormats 为空 = 用户选不到音频）")
	}
	// 按码率降序：最高音质在最前
	if info.AudioFormats[0].ABR != 160 {
		t.Errorf("音质应按码率降序，got 首项 %v kbps", info.AudioFormats[0].ABR)
	}
	// 不许再造一条假的「最佳画质」视频格式
	if len(info.Formats) != 0 {
		t.Errorf("纯音频链接不该有视频格式，got %+v", info.Formats)
	}
	if info.Music == nil || !info.Music.IsMusic {
		t.Fatal("应识别为歌曲")
	}
	if info.Music.Artist != "Forss" || info.Music.Track != "Flickermood" {
		t.Errorf("曲目信息 = %+v", info.Music)
	}
}

// 有视频流的链接不能被误判成歌曲。
//
// 变异点：只按「存在 audio-only 格式」判断时，YouTube 视频（它同时提供
// 视频轨和纯音频轨）会全部被当成歌曲，标题变成「歌手 - 曲名」。
func TestVideoIsNotMusic(t *testing.T) {
	raw := &rawInfo{
		ID: "2", Title: "A video",
		Formats: []rawFormat{
			{FormatID: "137", Vcodec: "avc1.640028", Acodec: "none", Height: 1080},
			{FormatID: "140", Vcodec: "none", Acodec: "mp4a.40.2", ABR: 128},
		},
	}
	p := NewParser()
	info := p.buildInfo(raw, true, false, ParseOptions{URL: "https://youtube.com/watch?v=x"})

	if info.Music != nil {
		t.Errorf("带视频流的链接不该被识别成歌曲，got %+v", info.Music)
	}
	if len(info.Formats) == 0 {
		t.Error("视频格式不该被过滤掉")
	}
}

// 直播不能被识别成歌曲：音频电台直播没有成品文件。
func TestLiveIsNotMusic(t *testing.T) {
	raw := &rawInfo{
		ID: "3", Title: "Live radio", LiveStatus: "is_live",
		Formats: []rawFormat{
			{FormatID: "a", Vcodec: "none", Acodec: "mp4a.40.2", ABR: 128},
		},
	}
	p := NewParser()
	info := p.buildInfo(raw, false, false, ParseOptions{URL: "https://example.com/live"})
	if info.Music != nil {
		t.Errorf("直播不该识别成歌曲，got %+v", info.Music)
	}
}

// 站点没给 track/artist 但格式全是纯音频时，仍识别为歌曲并退回标题当曲名。
func TestAudioOnlyWithoutMetadataFallsBackToTitle(t *testing.T) {
	raw := &rawInfo{
		ID: "4", Title: "Some Song",
		Formats: []rawFormat{
			{FormatID: "a", Vcodec: "", Acodec: "mp4a.40.2", ABR: 128},
		},
	}
	p := NewParser()
	info := p.buildInfo(raw, false, false, ParseOptions{URL: "https://example.com/t"})
	if info.Music == nil || !info.Music.IsMusic {
		t.Fatal("全音频格式应识别为歌曲")
	}
	if info.Music.Track != "Some Song" {
		t.Errorf("曲名应退回标题，got %q", info.Music.Track)
	}
}

// 自动字幕要单独列出，且不影响人工字幕。
func TestAutomaticCaptionsListedSeparately(t *testing.T) {
	raw := &rawInfo{
		ID: "5", Title: "t",
		Subtitles: map[string]any{
			"en": []any{map[string]any{"name": "English", "url": "https://x/en.vtt"}},
			// 直播聊天回放不是字幕，不该出现在列表里
			"live_chat": []any{map[string]any{"name": "Live chat", "url": "https://x/chat.json"}},
		},
		AutomaticCaptions: map[string]any{
			"ja": []any{map[string]any{"name": "日本語 (自動)", "url": "https://x/ja.vtt"}},
			"ab": []any{map[string]any{"name": "Abkhazian", "url": "https://x/ab.vtt"}},
		},
	}
	p := NewParser()
	info := p.buildInfo(raw, true, false, ParseOptions{URL: "https://youtube.com/watch?v=y"})

	if len(info.Subtitles) != 1 || info.Subtitles[0].Language != "en" {
		t.Errorf("人工字幕应只有 en（live_chat 要剔除），got %+v", info.Subtitles)
	}
	if len(info.AutomaticCaptions) != 2 {
		t.Fatalf("自动字幕应有 2 条，got %+v", info.AutomaticCaptions)
	}
	// 排序稳定：map 迭代顺序随机，不排序会让界面每次刷新都换顺序
	if info.AutomaticCaptions[0].Language != "ab" {
		t.Errorf("自动字幕应按语言码排序，got 首项 %q", info.AutomaticCaptions[0].Language)
	}
}

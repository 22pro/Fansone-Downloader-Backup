# HLS repair notes / HLS 修复说明

Version: `1.0.10-local.1`, based on upstream `v1.0.10`.

This is an unofficial source update. Upstream authorship, history, and the existing ISC license declaration are retained. No upstream release assets are changed. Repair packages and SHA-256 checksums are available in the [unofficial prerelease](https://github.com/22pro/Fansone-Downloader-Backup/releases/tag/v1.0.10-local.1).

## 修复内容

- 解析 HLS 主清单，选择清晰度及其匹配的独立音轨。
- 正确拼接 fMP4 初始化段和媒体分片，合并成带音轨的 MP4。
- 内置 FFmpeg 不适合当前平台时，尝试系统 FFmpeg，包括 macOS Homebrew 路径。
- 只有完整解码及所需轨道检查通过后才标记完成；有可用 ffprobe 时进一步核对音视频时长。
- 保留原有 TS、无效 MP4 和旧缓存；修复文件使用独立文件名，避免覆盖已有内容。
- 允许重新选择旧版误标完成的视频，改善暂停、取消、清空记录、并发进度和 HTTP 续传范围校验。
- 遇到加密/DRM 或 401/403 访问拒绝时停止，不解密或绕过权限。

## Tests

Use Node.js 22 or newer. Install FFmpeg with ffprobe and make both available on `PATH`. Alternatively, set `FFMPEG_PATH` to an FFmpeg executable with ffprobe in the same directory.

```bash
npm ci
npm test
```

The test suite generates short test-pattern video and sine-wave audio locally. It uses only synthetic media and a local HTTP server, with no FansOne login, account data, private downloads, or real media fixtures.

Coverage includes playlist parsing, separate audio and initialization segments, cache identity, full decode and duration checks, existing-file preservation, failed permissions, pause/resume, clearing records, and HTTP range responses.

完整测试会在临时目录生成测试画面与正弦波音频，不访问 FansOne 账号或下载真实内容。测试结束后清理自身临时文件。发布前已在 macOS 通过语法检查及 21 项回归测试。另已构建 Mac Apple Silicon ZIP、Windows x64 安装版和便携版，核对包内源码及文件哈希。Mac 实际捆绑的媒体工具通过合并/解码与错误拒绝测试；Windows 包仅通过静态和压缩完整性检查，未实机运行。详见 Release 内构建说明。

## Limitations

- Encrypted/DRM HLS, live streams, BYTERANGE, DISCONTINUITY, and mid-stream initialization changes are not supported.
- FFmpeg is required for completed video output. Duration validation is additional and requires ffprobe; full decoding and required-track checks still run without it.
- This update does not change account access requirements. Only back up content that your own account may access, respecting service rules and content-owner rights.
- Final output uses an exclusive hard link to avoid overwriting an existing file. The download filesystem must support hard links; exFAT and some network destinations are not supported by this publication step.
- Installing an upstream release may replace the repair. Prebuilt packages are an unofficial prerelease: the Mac app is ad-hoc signed but not notarized, and the Windows apps are unsigned.

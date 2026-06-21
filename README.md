# Fansone Downloader Backup

Fansone Downloader Backup 是一个基于 Electron 的 FansOne 内容备份工具，用于把自己账号已订阅、已授权访问的 FansOne 视频和图片保存到本地。

官网：https://cangify.com

> 本项目仅用于个人数据备份。请只下载你有权限访问的内容，并遵守目标平台条款与当地法律法规。

## 功能特点

- 登录 FansOne 账号后读取订阅作者与帖子列表
- 支持备份视频和图片内容
- 支持按作者、帖子批量选择需要备份的内容
- 支持视频分片下载、断点续传、下载进度、实时速度和失败日志显示
- 视频下载完成后会自动合并，并尽可能封装为 MP4
- 支持自定义下载目录，默认保存到系统下载目录下的 `FansOne` 文件夹
- 支持 Windows 与 macOS 桌面端

## 下载

请到 GitHub Releases 下载最新版：

- Windows 安装版：`FansOneDownloader-*-x64-installer.exe`
- Windows 便携版：`FansOneDownloader-*-x64-portable.exe`
- macOS Intel：`FansOneDownloader-*-mac.zip`
- macOS Apple Silicon：`FansOneDownloader-*-arm64-mac.zip`

macOS 包为交叉构建版本，未签名/未公证；首次打开时可能需要在系统设置中允许打开。

## 使用流程

1. 打开软件，点击「登录 / 重新登录」。
2. 在弹出的 FansOne 登录窗口中手动登录账号。
3. 回到主窗口点击「刷新订阅」。
4. 选择作者并加载帖子。
5. 勾选需要备份的视频或图片，点击「下载选中」。
6. 下载完成后，在设置的下载目录中查看备份文件。

## 本地开发

```bash
npm install
npm start
```

语法检查：

```bash
npm test
```

## 打包

Windows：

```bash
npm run dist:win
```

macOS zip：

```bash
npx electron-builder --mac zip --x64 --arm64 --publish never
```

构建产物默认输出到 `dist/`。

## 技术栈

- Electron
- Node.js
- got / axios
- p-queue
- ffmpeg-static
- electron-builder

## 合规说明

- 软件不会绕过 DRM 或加密保护。
- 软件只使用当前登录账号可访问的内容。
- 请勿将本工具用于未授权下载、传播或商业侵权用途。

## License

ISC

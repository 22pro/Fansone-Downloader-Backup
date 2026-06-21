# Windows 打包说明

目标：生成可双击运行的 Windows 软件包。最终用户运行打包后的 `.exe` 时，不需要安装 Python、ffmpeg、Node.js。

## 一、打包电脑需要准备

只在“打包用的 Windows 电脑”上需要安装：

- Node.js LTS：<https://nodejs.org/>

不需要安装 Python，不需要安装 ffmpeg。

## 二、一键打包

在 Windows 里打开本项目文件夹，双击：

```bat
build-windows.bat
```

脚本会自动执行：

1. `npm install` 安装打包依赖
2. `npm test` 检查语法
3. 清理旧 `dist/`
4. `npm run dist:win` 生成 Windows 软件

## 三、打包结果

打包完成后看这里：

```text
dist/
```

会生成两类文件：

- 安装版：`FansOneDownloader-1.0.0-x64-installer.exe`
- 绿色版/便携版：`FansOneDownloader-1.0.0-x64-portable.exe`

这两个都是双击运行的软件。安装版会创建桌面/开始菜单快捷方式；绿色版不安装，直接双击运行。

## 四、运行环境

打包后的 Windows 软件已包含：

- Electron 运行环境
- 程序依赖
- `ffmpeg-static` 提供的 Windows ffmpeg

所以使用软件的电脑不需要另外安装：

- Python
- ffmpeg
- Node.js
- npm

## 五、注意

登录仍然建议使用真实浏览器完成 FansOne / Cloudflare 登录，然后在软件里导入/使用登录状态。软件不会绕过 DRM、加密或 Cloudflare，只下载你已经有权访问的内容。

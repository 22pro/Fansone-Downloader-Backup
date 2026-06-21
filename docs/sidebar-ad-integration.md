# 250×250 侧边栏广告接入说明

本文档说明如何在桌面软件中接入一个由线上 JSON 控制的 250×250 侧边栏广告位，支持：

- 线上 JSON 控制广告开关、图片、跳转链接
- 多张广告轮播
- 点击当前广告后用系统浏览器打开对应链接
- 软件运行期间定时刷新 JSON
- 图片缓存刷新，服务器换图后客户端可自动更新
- JSON 失败时保留占位，不影响软件正常运行

下面以 FO-BACKUP / Electron 桌面软件的实现为参考。其他软件可按同样结构接入。

---

## 1. 线上 JSON 地址

FO-BACKUP 当前读取的广告 JSON 地址：

```text
https://cangify.com/globle/ads/fo-backup/fo-backup.json
```

对应服务器文件路径：

```text
/www/wwwroot/cangify.com/globle/ads/fo-backup/fo-backup.json
```

广告图片可以放在同目录，例如：

```text
/www/wwwroot/cangify.com/globle/ads/fo-backup/1689190343.webp
/www/wwwroot/cangify.com/globle/ads/fo-backup/1689193338.webp
```

---

## 2. JSON 格式

推荐格式如下：

```json
{
  "enabled": true,
  "intervalSeconds": 5,
  "refreshSeconds": 60,
  "updatedAt": "2026-06-20T00:00:00-05:00",
  "ads": [
    {
      "title": "FO-BACKUP 广告 1",
      "alt": "FO-BACKUP 广告 1",
      "imageUrl": "https://cangify.com/globle/ads/fo-backup/1689190343.webp",
      "linkUrl": "https://cangify.com"
    },
    {
      "title": "FO-BACKUP 广告 2",
      "alt": "FO-BACKUP 广告 2",
      "imageUrl": "https://cangify.com/globle/ads/fo-backup/1689193338.webp",
      "linkUrl": "https://cangify.com"
    }
  ]
}
```

字段说明：

- `enabled`: 是否启用广告。`false` 时软件显示默认占位。
- `intervalSeconds`: 多张广告轮播间隔，单位秒。FO-BACKUP 限制范围为 2–60 秒，默认 5 秒。
- `refreshSeconds`: 软件重新读取线上 JSON 的间隔，单位秒。FO-BACKUP 限制范围为 10–3600 秒，默认 60 秒。
- `updatedAt`: 缓存版本号。换图后建议更新这个值，软件会把它作为图片缓存刷新参数。
- `ads`: 广告数组。
- `title`: 广告标题，可用于管理和辅助显示。
- `alt`: 图片替代文字。
- `imageUrl`: 250×250 广告图片 URL。
- `linkUrl`: 点击图片后打开的 URL。

兼容字段：客户端也可以兼容 `image_url/image/src` 和 `link_url/link/url/href`，方便不同系统生成 JSON。

---

## 3. Electron 主进程：读取线上 JSON

在 Electron 主进程中读取线上 JSON，推荐由主进程读取而不是渲染进程直接 fetch，原因是：

- 避免 `file://` 页面跨域/CORS 问题
- 统一处理网络错误和超时
- 渲染进程只拿干净的广告数据

示例：

```js
const SIDEBAR_AD_FEED_URL = 'https://cangify.com/globle/ads/fo-backup/fo-backup.json';

function normalizeSidebarAdItem(item = {}) {
  const imageUrl = item.imageUrl || item.image_url || item.image || item.src || '';
  const linkUrl = item.linkUrl || item.link_url || item.link || item.url || item.href || '';
  return {
    enabled: item.enabled !== false && Boolean(imageUrl && linkUrl),
    imageUrl,
    linkUrl,
    alt: item.alt || item.title || '广告',
    title: item.title || ''
  };
}

async function getSidebarAd(url = SIDEBAR_AD_FEED_URL) {
  const response = await got.get(url, {
    responseType: 'json',
    timeout: { request: 12000 },
    retry: { limit: 1 },
    headers: { 'Cache-Control': 'no-cache' }
  });

  const body = response.body || {};
  const rawAds = Array.isArray(body.ads) ? body.ads : [body];
  const ads = rawAds.map(normalizeSidebarAdItem).filter(item => item.enabled);
  const first = ads[0] || normalizeSidebarAdItem({ enabled: false });

  const intervalSeconds = Math.max(2, Math.min(60, Number(body.intervalSeconds || body.interval_seconds || 5) || 5));
  const refreshSeconds = Math.max(10, Math.min(3600, Number(body.refreshSeconds || body.refresh_seconds || 60) || 60));

  return {
    ok: true,
    enabled: body.enabled !== false && ads.length > 0,
    imageUrl: first.imageUrl,
    linkUrl: first.linkUrl,
    alt: first.alt,
    title: first.title,
    ads,
    intervalSeconds,
    refreshSeconds,
    cacheKey: String(body.updatedAt || body.updated_at || body.version || Date.now()),
    feedUrl: url,
    raw: body
  };
}
```

注册 IPC：

```js
ipcMain.handle('ad:get-sidebar', () => getSidebarAd());
ipcMain.handle('shell:open-external', (_e, target) => shell.openExternal(String(target || '')));
```

---

## 4. Preload：暴露安全 API

```js
contextBridge.exposeInMainWorld('appApi', {
  getSidebarAd: () => ipcRenderer.invoke('ad:get-sidebar'),
  openExternal: (target) => ipcRenderer.invoke('shell:open-external', target)
});
```

FO-BACKUP 中实际挂载名是 `window.fansoneApp`：

```js
getSidebarAd: () => ipcRenderer.invoke('ad:get-sidebar'),
openExternal: (target) => ipcRenderer.invoke('shell:open-external', target)
```

---

## 5. HTML：添加广告容器

广告位建议放在左侧菜单下方、底部状态区域上方：

```html
<section id="sidebarAd" class="sidebar-ad" role="link" tabindex="0" aria-label="广告位">
  <div class="sidebar-ad-inner">
    <span>AD</span>
    <strong>250 × 250</strong>
    <small>广告位</small>
  </div>
</section>
```

说明：

- `role="link"` 表示它是可点击区域。
- `tabindex="0"` 允许键盘聚焦。
- JSON 未加载成功时显示默认占位。

---

## 6. CSS：固定 250×250 尺寸

```css
.sidebar-ad {
  width: 250px;
  height: 250px;
  flex: 0 0 250px;
  margin: auto auto 8px;
  border-radius: 22px;
  border: 1px dashed rgba(148,163,184,.46);
  background: linear-gradient(135deg, rgba(255,255,255,.10), rgba(255,255,255,.045));
  display: grid;
  place-items: center;
  overflow: hidden;
  cursor: default;
}

.sidebar-ad.is-clickable {
  cursor: pointer;
  border-style: solid;
}

.sidebar-ad img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  animation: ad-fade-in .28s ease;
}

@keyframes ad-fade-in {
  from { opacity: .35; transform: scale(1.015); }
  to { opacity: 1; transform: scale(1); }
}
```

FO-BACKUP 的布局中，广告位、`EN/中文` 按钮、`FO-BACKUP` 状态块要贴在底部且间距固定，所以把自动空白放在广告位上方：

```css
.sidebar-ad { margin: auto auto 8px; }
.sidebar-bottom-toggle { margin: 0 0 8px; }
.sidebar-status { margin-top: 0; }
```

这样窗口放大时：

- 菜单区和底部广告组之间的空白变大
- 广告 → EN/中文 间距不变
- EN/中文 → FO-BACKUP 间距不变

---

## 7. 渲染进程：显示、轮播、点击、刷新

核心逻辑：

```js
let sidebarAdLink = '';
let sidebarAds = [];
let sidebarAdIndex = 0;
let sidebarAdTimer = null;
let sidebarAdRefreshTimer = null;
let sidebarAdCacheKey = '';

function adImageUrlWithCacheKey(url) {
  if (!sidebarAdCacheKey) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('_fo_ad_v', sidebarAdCacheKey);
    return parsed.toString();
  } catch {
    const separator = String(url).includes('?') ? '&' : '?';
    return `${url}${separator}_fo_ad_v=${encodeURIComponent(sidebarAdCacheKey)}`;
  }
}

function showSidebarAdPlaceholder() {
  const root = document.getElementById('sidebarAd');
  if (!root) return;
  sidebarAdLink = '';
  sidebarAds = [];
  sidebarAdIndex = 0;
  sidebarAdCacheKey = '';
  root.classList.remove('is-clickable');
  root.setAttribute('aria-label', '广告位');
  root.innerHTML = '<div class="sidebar-ad-inner"><span>AD</span><strong>250 × 250</strong><small>广告位</small></div>';
}

function renderSidebarAdItem(item) {
  const root = document.getElementById('sidebarAd');
  if (!root) return;

  const enabled = Boolean(item?.imageUrl && item.linkUrl);
  sidebarAdLink = enabled ? String(item.linkUrl) : '';
  root.classList.toggle('is-clickable', enabled);
  root.setAttribute('aria-label', enabled ? (item.alt || item.title || '广告') : '广告位');

  if (!enabled) {
    showSidebarAdPlaceholder();
    return;
  }

  const alt = escapeHtml(item.alt || item.title || '广告');
  const imageUrl = adImageUrlWithCacheKey(item.imageUrl);
  root.innerHTML = `<img src="${escapeHtml(imageUrl)}" alt="${alt}" loading="lazy" />`;
}

function renderSidebarAd(ad) {
  if (sidebarAdTimer) {
    clearInterval(sidebarAdTimer);
    sidebarAdTimer = null;
  }

  const ads = Array.isArray(ad?.ads) && ad.ads.length
    ? ad.ads
    : (ad?.enabled && ad.imageUrl && ad.linkUrl ? [ad] : []);

  sidebarAds = ads.filter(item => item?.imageUrl && item?.linkUrl);
  sidebarAdIndex = 0;
  sidebarAdCacheKey = String(ad?.cacheKey || Date.now());

  if (!ad?.enabled || !sidebarAds.length) {
    showSidebarAdPlaceholder();
    return;
  }

  renderSidebarAdItem(sidebarAds[sidebarAdIndex]);

  if (sidebarAds.length > 1) {
    const intervalMs = Math.max(2000, Math.min(60000, Number(ad.intervalSeconds || 5) * 1000));
    sidebarAdTimer = setInterval(() => {
      sidebarAdIndex = (sidebarAdIndex + 1) % sidebarAds.length;
      renderSidebarAdItem(sidebarAds[sidebarAdIndex]);
    }, intervalMs);
  }
}

async function loadSidebarAd({ scheduleRefresh = false } = {}) {
  try {
    const ad = await window.appApi.getSidebarAd();
    renderSidebarAd(ad);
    if (scheduleRefresh) scheduleSidebarAdRefresh(ad?.refreshSeconds);
  } catch (err) {
    console.warn(`加载广告 JSON 失败：${err?.message || err}`);
    if (scheduleRefresh) scheduleSidebarAdRefresh(60);
  }
}

function scheduleSidebarAdRefresh(seconds = 60) {
  if (sidebarAdRefreshTimer) clearInterval(sidebarAdRefreshTimer);
  const intervalMs = Math.max(10000, Math.min(3600000, Number(seconds || 60) * 1000));
  sidebarAdRefreshTimer = setInterval(() => loadSidebarAd(), intervalMs);
}

function initSidebarAdClick() {
  const root = document.getElementById('sidebarAd');
  if (!root) return;

  const openAd = () => {
    if (sidebarAdLink) window.appApi.openExternal(sidebarAdLink);
  };

  root.addEventListener('click', openAd);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAd();
    }
  });
}
```

初始化时调用：

```js
initSidebarAdClick();
loadSidebarAd({ scheduleRefresh: true });
```

---

## 8. 缓存刷新机制

如果服务器替换了同名图片，客户端可能因为浏览器缓存继续显示旧图。

FO-BACKUP 的做法：

1. 主进程读取 JSON 时生成 `cacheKey`：

```js
cacheKey: String(body.updatedAt || body.updated_at || body.version || Date.now())
```

2. 渲染进程显示图片时给 URL 加参数：

```text
?_fo_ad_v=<cacheKey>
```

例如：

```text
https://cangify.com/globle/ads/fo-backup/1689190343.webp?_fo_ad_v=2026-06-20T00%3A00%3A00-05%3A00
```

建议：每次换图时，也更新 JSON 的 `updatedAt` 或 `version` 字段。

---

## 9. 常见问题

### 9.1 软件不显示广告

按顺序检查：

1. JSON 地址是否 200：

```bash
curl -i https://cangify.com/globle/ads/fo-backup/fo-backup.json
```

2. 图片地址是否 200：

```bash
curl -I https://cangify.com/globle/ads/fo-backup/1689190343.webp
```

3. JSON 目录是否拼写正确：

正确：

```text
/globle/ads/fo-backup/fo-backup.json
```

错误示例：

```text
/globle/ads/fo-bakcup/fo-backup.json
```

4. JSON 是否是合法 JSON：

```bash
python3 -m json.tool fo-backup.json
```

5. `enabled` 是否为 `true`，且每个广告都有 `imageUrl` 和 `linkUrl`。

### 9.2 服务器换图后软件还是旧图

解决：

- 等待 `refreshSeconds` 周期到达
- 修改 JSON 里的 `updatedAt` 或 `version`
- 确认图片 URL 可以公网访问

### 9.3 点击广告没反应

检查：

- 当前广告是否有 `linkUrl`
- Electron 主进程是否注册 `shell:open-external`
- preload 是否暴露 `openExternal`
- 渲染进程是否调用 `initSidebarAdClick()`

---

## 10. FO-BACKUP 当前相关文件

FO-BACKUP 实现位置：

```text
src/main.js
src/preload.cjs
src/renderer/index.html
src/renderer/styles.css
src/renderer/app.js
```

关键点：

- `src/main.js`
  - `SIDEBAR_AD_FEED_URL`
  - `normalizeSidebarAdItem()`
  - `getSidebarAd()`
  - `ipcMain.handle('ad:get-sidebar', ...)`
- `src/preload.cjs`
  - `getSidebarAd()`
  - `openExternal()`
- `src/renderer/index.html`
  - `#sidebarAd`
- `src/renderer/styles.css`
  - `.sidebar-ad`
  - `.sidebar-ad.is-clickable`
  - `.sidebar-ad img`
- `src/renderer/app.js`
  - `loadSidebarAd()`
  - `renderSidebarAd()`
  - `renderSidebarAdItem()`
  - `scheduleSidebarAdRefresh()`
  - `initSidebarAdClick()`

---

## 11. 最小接入流程

给其他 AI 或开发者的最短指令：

1. 在服务器放一个 JSON：`/globle/ads/fo-backup/fo-backup.json`。
2. JSON 内写 `enabled / intervalSeconds / refreshSeconds / updatedAt / ads[]`。
3. 软件主进程读取该 JSON，返回规范化后的 `ads` 数组。
4. preload 暴露 `getSidebarAd()` 和 `openExternal()`。
5. 渲染层放一个 250×250 容器 `#sidebarAd`。
6. 渲染层启动时读取 JSON，显示第一张广告。
7. 多张广告按 `intervalSeconds` 轮播。
8. 点击当前广告打开当前广告的 `linkUrl`。
9. 按 `refreshSeconds` 重新拉 JSON。
10. 图片 URL 加 `_fo_ad_v` 参数避免缓存旧图。

这样以后只需要改服务器 JSON 和上传图片，软件不用重新打包即可更新广告。

const $ = (id) => document.getElementById(id);
const api = window.fansoneApp;

let config = null;
let subscriptions = [];
let activeSubscriptions = [];
let cancelledSubscriptions = [];
let rawSubscriptions = [];
let posts = [];
let activeUsername = null;
const selectedSubscriptionUsernames = new Set();
const jobs = new Map();
const completedPostIds = new Set();
const downloadingPostIds = new Set();
const visiblePostIds = new Set();
let downloadsPaused = false;
let persistTimer = null;
let jobsRenderTimer = null;
let postsRenderTimer = null;
const JOB_RENDER_INTERVAL_MS = 250;
const POST_RENDER_INTERVAL_MS = 600;
const MAX_RENDERED_JOBS = 180;


const originalTextNodes = new WeakMap();
let languageMode = localStorage.getItem('fansone-language') || 'zh';
let translating = false;

const i18nMap = {
  'FansOne 下载器': 'FansOne Downloader',
  '专业订阅内容备份工具': 'Professional subscription content backup tool',
  '登录中心': 'Login Center',
  '账号状态与授权': 'Account status and authorization',
  '订阅详情': 'Subscriptions',
  '作者、帖子与下载任务': 'Creators, posts and download tasks',
  '下载状态': 'Download Status',
  '进度、速度与任务明细': 'Progress, speed and task details',
  '下载设置': 'Download Settings',
  '目录、并发与软件更新': 'Folder, concurrency and updates',
  '关于软件': 'About',
  '版本、官网与功能说明': 'Version, website and features',
  'EN/中文': '中文 / EN',
  '点击自动翻译界面': 'Click to translate UI',
  '连接 FansOne 账号后，即可读取订阅作者、加载帖子并开始备份。登录信息仅保存在本机。': 'Connect your FansOne account to load creators, posts, and start backups. Login data is stored locally only.',
  '检查登录状态中…': 'Checking login status…',
  '登录 / 重新登录': 'Login / Relogin',
  '清除登录': 'Clear Login',
  '订阅管理': 'Subscription Management',
  '按付费/免费/取消状态筛选作者': 'Filter creators by paid/free/cancelled status',
  '批量备份': 'Batch Backup',
  '支持视频、图片和多作者批量下载': 'Download videos, photos, and multiple creators in batches',
  '状态监控': 'Status Monitor',
  '独立下载状态页展示速度和任务明细': 'Dedicated status page for speed and task details',
  '永久免费': 'Free Forever',
  '下载不限速，分片并发可自由设置': 'No speed limit; segment concurrency is customizable',
  '管理订阅作者、筛选帖子；下载进度请到“下载状态”查看。': 'Manage subscribed creators and filter posts. Check download progress in Download Status.',
  '全部订阅项目': 'All subscriptions',
  '订阅中 - 付费': 'Active - Paid',
  '订阅中 - 免费': 'Active - Free',
  '已取消 - 付费': 'Cancelled - Paid',
  '已取消 - 免费': 'Cancelled - Free',
  '刷新订阅': 'Refresh Subscriptions',
  '订阅作者': 'Subscribed Creators',
  '全选': 'Select All',
  '清空': 'Clear',
  '加载选中作者帖子': 'Load Selected Creators',
  '暂无数据': 'No data',
  '当前分类没有订阅项目。': 'No subscriptions in this category.',
  '暂无订阅，或还未刷新。': 'No subscriptions yet, or not refreshed.',
  '没有加载到帖子。': 'No posts loaded.',
  '请选择一个作者，或勾选多个作者后点击“加载选中作者帖子”。': 'Select a creator, or choose multiple creators and click “Load Selected Creators”.',
  '帖子': 'Posts',
  '全部': 'All',
  '视频': 'Videos',
  '图片': 'Photos',
  '下载选中': 'Download Selected',
  '请选择一个作者': 'Please select a creator',
  '集中查看下载进度、速度、剩余数量、当前文件与失败信息。': 'View download progress, speed, remaining tasks, current file, and failures.',
  '暂停': 'Pause',
  '继续': 'Resume',
  '重试失败': 'Retry Failed',
  '清空记录': 'Clear Records',
  '打开保存目录': 'Open Save Folder',
  '总任务': 'Total Tasks',
  '已加入队列': 'Queued',
  '进行中': 'Active',
  '下载/等待/暂停': 'Downloading / Waiting / Paused',
  '已完成': 'Completed',
  '成功备份': 'Backed up',
  '失败': 'Failed',
  '需要检查': 'Needs attention',
  '当前速度': 'Current Speed',
  '预计 --': 'ETA --',
  '暂无下载任务': 'No download tasks',
  '选择帖子后点击下载，任务会显示在这里。': 'Select posts and click download; tasks will appear here.',
  '暂无正在下载的内容': 'Nothing downloading',
  '任务明细': 'Task Details',
  '显示当前队列、已完成和失败任务': 'Shows queued, completed, and failed tasks',
  '暂无任务': 'No tasks',
  '保存设置': 'Save Settings',
  '检查软件更新': 'Check for Updates',
  '保存目录': 'Save Folder',
  '选择目录': 'Choose Folder',
  '下载并发': 'Download Concurrency',
  '订阅类型': 'Subscription Type',
  '软件版本': 'Software Version',
  '官网': 'Official Website',
  '复制': 'Copy',
  '关闭': 'Close',
  '稍后再说': 'Later',
  '下载更新': 'Download Update',
  '当前没有正在下载的内容': 'Nothing is currently downloading',
  '下载失败，可点击重试失败': 'Download failed. Click Retry Failed.',
  '下载已暂停': 'Downloads paused',
  '正在下载': 'Downloading',
  '下载完成': 'Downloads completed',
  '当前没有正在运行的任务': 'No running tasks',
  '等待中': 'Queued',
  '下载中': 'Downloading',
  '已暂停': 'Paused',
  '已完成': 'Completed',
  '已取消': 'Cancelled',
  '未知': 'Unknown',
  '未登录': 'Not logged in',
  '已过期': 'Expired',
  '无限期': 'Unlimited',
  '设置保存目录、下载并发，并检查软件更新。': 'Set the save folder, download concurrency, and check for software updates.',
  '所有备份文件会保存到这里。': 'All backup files will be saved here.',
  '选择保存目录': 'Choose Save Folder',
  '下载参数': 'Download Parameters',
  '软件已永久免费开放，可按电脑和网络情况设置并发。': 'FO-BACKUP is now free; tune concurrency for your computer and network.',
  '分片并发': 'Segment Concurrency',
  'FO-BACKUP 是一款面向 FansOne 内容备份与整理的桌面工具，帮助你把订阅作者、视频和图片内容稳定保存到本地。': 'FO-BACKUP is a desktop tool for backing up and organizing FansOne content, helping you reliably save subscribed creators, videos, and photos locally.',
  '订阅内容备份': 'Subscription Content Backup',
  '支持刷新订阅作者，按作者加载帖子，并批量备份视频与图片。': 'Refresh subscribed creators, load posts by creator, and batch-backup videos and photos.',
  '规则化整理': 'Organized File Structure',
  '按作者、内容类型和发布时间整理文件，减少手动分类成本。': 'Organize files by creator, content type, and publish time to reduce manual sorting.',
  '任务更稳定': 'More Stable Tasks',
  '支持暂停恢复、失败提示、进度记录和已下载内容跳过。': 'Supports pause/resume, failure notices, progress tracking, and skipping already downloaded content.',
  'FO-BACKUP 已取消收费功能，下载不限速，并开放分片并发自定义设置。': 'FO-BACKUP has removed paid features: no speed limit and customizable segment concurrency.',
  '官网：cangify.com': 'Website: cangify.com',
  '当前版本：v1.0.10': 'Current version: v1.0.10',
  '软件更新': 'Software Update',
  '正在检查更新…': 'Checking for updates…',
  '复制链接': 'Copy Link',
  '稍后': 'Later',
  '立即下载': 'Download Now',
};

function translateString(value) {
  if (languageMode !== 'en') return value;
  if (i18nMap[value]) return i18nMap[value];
  return value
    .replace(/^预计 /, 'ETA ')
    .replace(/^共 (\d+) 条$/, 'Total $1')
    .replace(/^全部:(\d+)/, 'All:$1')
    .replace(/订阅中-付费/g, 'Active-Paid')
    .replace(/订阅中-免费/g, 'Active-Free')
    .replace(/已取消-付费/g, 'Cancelled-Paid')
    .replace(/已取消-免费/g, 'Cancelled-Free')
    .replace(/^已登录：(.+)$/, 'Logged in: $1')
    .replace(/已选 (\d+)/g, 'selected $1')
    .replace(/^当前版本 (.+) · 最新版本 (.+)$/, 'Current $1 · Latest $2')
    .replace(/^当前版本 (.+) · 最新版本 (.+) · (.+)$/, 'Current $1 · Latest $2 · $3')
    .replace(/^发现新版本 (.+)（重要更新）$/, 'New version found $1 (important)')
    .replace(/^发现新版本 (.+)$/, 'New version found $1')
    .replace(/^当前已是最新版本$/, 'You are on the latest version')
    .replace(/^暂无更新说明。$/, 'No release notes.')
    .replace(/^没有提供下载链接$/, 'No download link provided')
    .replace(/下载不限速/g, 'No speed limit');
}

function t(value) {
  return translateString(String(value ?? ''));
}

function applyLanguage() {
  if (translating) return;
  translating = true;
  document.documentElement.lang = languageMode === 'en' ? 'en' : 'zh-CN';
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const tag = node.parentElement?.tagName;
      if (['SCRIPT', 'STYLE', 'TEXTAREA'].includes(tag)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (!originalTextNodes.has(node)) originalTextNodes.set(node, node.nodeValue);
    let original = originalTextNodes.get(node);
    const originalCore = original.trim();
    const translatedOriginal = `${original.match(/^\s*/)?.[0] || ''}${translateString(originalCore)}${original.match(/\s*$/)?.[0] || ''}`;
    if (languageMode === 'en' && node.nodeValue !== original && node.nodeValue !== translatedOriginal) {
      original = node.nodeValue;
      originalTextNodes.set(node, original);
    }
    const leading = original.match(/^\s*/)?.[0] || '';
    const trailing = original.match(/\s*$/)?.[0] || '';
    const core = original.trim();
    node.nodeValue = `${leading}${translateString(core)}${trailing}`;
  }
  const toggle = $('languageToggleBtn');
  if (toggle) {
    toggle.classList.toggle('is-english', languageMode === 'en');
    const icon = toggle.querySelector('.menu-icon');
    const title = toggle.querySelector('b');
    const sub = toggle.querySelector('small');
    if (icon) icon.textContent = languageMode === 'en' ? 'EN' : '文';
    if (title) title.textContent = languageMode === 'en' ? '中文 / EN' : 'EN/中文';
    if (sub) sub.textContent = languageMode === 'en' ? 'Click to switch Chinese/English' : '点击自动翻译界面';
  }
  translating = false;
}

function setLanguageMode(nextMode) {
  languageMode = nextMode === 'en' ? 'en' : 'zh';
  localStorage.setItem('fansone-language', languageMode);
  switchView(localStorage.getItem('fansone-active-view') || 'loginView');
  renderSubscriptions();
  renderPosts();
  renderJobs();
  applyLanguage();
}

function initLanguageToggle() {
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#languageToggleBtn')) return;
    event.preventDefault();
    event.stopPropagation();
    const brandText = document.querySelector('.brand h1')?.textContent || '';
    const pageLooksEnglish = document.documentElement.lang === 'en' || /Downloader/i.test(brandText);
    setLanguageMode(pageLooksEnglish ? 'zh' : 'en');
  }, true);
  applyLanguage();
}

function refreshLanguageSoon() {
  // Dynamic renderers now output the selected language directly, avoiding Chinese flash before translation.
}

function applyResponsiveDensity() {
  const wide = window.innerWidth >= 1500 && window.innerHeight >= 900;
  const roomy = window.innerWidth >= 1800 && window.innerHeight >= 1000;
  document.documentElement.classList.toggle('is-wide', wide);
  document.documentElement.classList.toggle('is-roomy', roomy);
}

window.addEventListener('resize', applyResponsiveDensity);
applyResponsiveDensity();

function schedulePersistState() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    api.setAppState?.({
      activeSubscriptions,
      cancelledSubscriptions,
      posts,
      activeUsername,
      selectedSubscriptionUsernames: Array.from(selectedSubscriptionUsernames),
      postType: $('postType')?.value || 'all',
      subscriptionType: $('subscriptionType')?.value || 'all',
      logText: $('logBox')?.textContent || ''
    }).catch(() => {});
  }, 350);
}

function scheduleRenderJobs({ immediate = false } = {}) {
  if (jobsRenderTimer) return;
  const delay = immediate ? 0 : JOB_RENDER_INTERVAL_MS;
  jobsRenderTimer = setTimeout(() => {
    jobsRenderTimer = null;
    renderJobs();
  }, delay);
}

function scheduleRenderPosts({ immediate = false } = {}) {
  if (postsRenderTimer) return;
  const delay = immediate ? 0 : POST_RENDER_INTERVAL_MS;
  postsRenderTimer = setTimeout(() => {
    postsRenderTimer = null;
    renderPosts();
  }, delay);
}

async function restoreSavedAppState() {
  const state = await api.getAppState?.();
  if (!state || typeof state !== 'object') return;
  activeSubscriptions = Array.isArray(state.activeSubscriptions) ? state.activeSubscriptions : [];
  cancelledSubscriptions = Array.isArray(state.cancelledSubscriptions) ? state.cancelledSubscriptions : [];
  rawSubscriptions = [...activeSubscriptions, ...cancelledSubscriptions];
  posts = Array.isArray(state.posts) ? state.posts : [];
  activeUsername = state.activeUsername || null;
  for (const username of state.selectedSubscriptionUsernames || []) selectedSubscriptionUsernames.add(username);
  if (state.postType && $('postType')) $('postType').value = state.postType;
  if (state.subscriptionType && $('subscriptionType')) $('subscriptionType').value = state.subscriptionType;
  if (state.logText && $('logBox')) $('logBox').textContent = state.logText.slice(-50000);
  applySubscriptionFilter();
  renderSubscriptions();
  renderPosts();
}

function setBusy(el, busy, text) {
  if (!el) return;
  if (!el.dataset.idleHtml) el.dataset.idleHtml = el.innerHTML;
  el.disabled = busy;
  if (busy && text) {
    el.classList.add('is-busy');
    el.innerHTML = `<span>${escapeHtml(text)}</span><small>请稍候</small>`;
  } else {
    el.classList.remove('is-busy');
    el.innerHTML = el.dataset.idleHtml;
  }
}

const viewMeta = {
  loginView: ['登录中心', '检查账号登录状态，确保后续订阅内容可以正常读取。'],
  subscriptionView: ['订阅详情', '管理订阅作者、筛选帖子。'],
  downloadView: ['下载状态', '集中查看下载进度、速度、剩余数量、当前文件与失败信息。'],
  settingsView: ['下载设置', '设置保存目录、下载并发，并检查软件更新。'],
  aboutView: ['关于软件', '查看软件介绍、版本信息和官网地址。']
};

function switchView(viewId) {
  const target = viewMeta[viewId] ? viewId : 'loginView';
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active-view', view.id === target));
  document.querySelectorAll('.menu-item').forEach(item => item.classList.toggle('active', item.dataset.view === target));
  if ($('viewTitle')) $('viewTitle').textContent = viewMeta[target][0];
  if ($('viewSubtitle')) $('viewSubtitle').textContent = viewMeta[target][1];
  localStorage.setItem('fansone-active-view', target);
}

function installNavigation() {
  document.querySelectorAll('.menu-item[data-view]').forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });
  switchView(localStorage.getItem('fansone-active-view') || 'loginView');
}

function log(message) {
  const box = $('logBox');
  if (!box) {
    console.log(message);
    return;
  }
  const time = new Date().toLocaleTimeString();
  box.textContent += `[${time}] ${message}\n`;
  box.scrollTop = box.scrollHeight;
  schedulePersistState();
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--';
  if (seconds < 60) return languageMode === 'en' ? `${Math.ceil(seconds)} sec` : `${Math.ceil(seconds)} 秒`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return languageMode === 'en' ? `${minutes} min` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return languageMode === 'en' ? `${hours} hr ${rest} min` : `${hours} 小时 ${rest} 分钟`;
}

function formatSpeed(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '--';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let latestUpdateResult = null;
let sidebarAdLink = '';
let sidebarAds = [];
let sidebarAdIndex = 0;
let sidebarAdTimer = null;
let sidebarAdRefreshTimer = null;
let sidebarAdCacheKey = '';

function showSidebarAdPlaceholder() {
  const root = $('sidebarAd');
  if (!root) return;
  sidebarAdLink = '';
  sidebarAds = [];
  sidebarAdIndex = 0;
  sidebarAdCacheKey = '';
  root.classList.remove('is-clickable');
  root.setAttribute('aria-label', '广告位');
  root.innerHTML = '<div class="sidebar-ad-inner"><span>AD</span><strong>250 × 250</strong><small>广告位</small></div>';
}

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

function renderSidebarAdItem(item) {
  const root = $('sidebarAd');
  if (!root) return;
  const enabled = Boolean(item?.imageUrl && item.linkUrl);
  sidebarAdLink = enabled ? String(item.linkUrl) : '';
  root.classList.toggle('is-clickable', enabled);
  root.setAttribute('aria-label', enabled ? (item.alt || item.title || '广告') : '广告位');
  if (!enabled) {
    showSidebarAdPlaceholder();
    return;
  }
  const alt = escapeHtml(item.alt || item.title || 'FO-BACKUP 广告');
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
    if (!api.getSidebarAd) return;
    const ad = await api.getSidebarAd();
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
  const root = $('sidebarAd');
  if (!root) return;
  const openAd = () => {
    if (sidebarAdLink) api.openExternal(sidebarAdLink);
  };
  root.addEventListener('click', openAd);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAd();
    }
  });
}

function hideUpdateDialog() {
  $('updateDialog')?.classList.add('hidden');
}

function showUpdateDialog(result) {
  latestUpdateResult = result;
  const dialog = $('updateDialog');
  if (!dialog) return;
  const title = result.hasUpdate
    ? `发现新版本 ${result.latestVersion}${result.mandatory ? '（重要更新）' : ''}`
    : '当前已是最新版本';
  $('updateTitle').textContent = t(title);
  $('updateSubtitle').textContent = languageMode === 'en'
    ? `Current ${result.currentVersion} · Latest ${result.latestVersion}${result.releaseDate ? ` · ${result.releaseDate}` : ''}`
    : `当前版本 ${result.currentVersion} · 最新版本 ${result.latestVersion}${result.releaseDate ? ` · ${result.releaseDate}` : ''}`;
  $('updateNotes').innerHTML = result.notes?.length
    ? `<ul>${result.notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
    : `<p>${t('暂无更新说明。')}</p>`;
  $('updateLink').textContent = result.downloadUrl || result.homepage || t('没有提供下载链接');
  $('downloadUpdateBtn').disabled = !result.downloadUrl;
  $('copyUpdateLinkBtn').disabled = !(result.downloadUrl || result.homepage);
  dialog.classList.remove('hidden');
}

async function checkSoftwareUpdate({ startup = false } = {}) {
  const button = $('checkUpdateBtn');
  try {
    if (!startup) setBusy(button, true, '检查中…');
    const result = await api.checkUpdate();
    if (result.hasUpdate || !startup) showUpdateDialog(result);
    if (startup && result.hasUpdate) log(`发现新版本 ${result.latestVersion}`);
    return result;
  } catch (err) {
    if (!startup) alert(`检查更新失败：${err.message || err}`);
    else log(`自动检查更新失败：${err.message || err}`);
    return null;
  } finally {
    if (!startup) setBusy(button, false, '检查软件更新');
  }
}

function isFreeAccessUnlocked() {
  return true;
}


function mediaPlaceholder(kind = 'video') {
  const icon = kind === 'image'
    ? '<path d="M22 66l16-18 13 14 8-9 15 13H22z" fill="white" opacity=".9"/><circle cx="62" cy="34" r="7" fill="white" opacity=".9"/>'
    : '<circle cx="48" cy="48" r="26" fill="white" opacity=".16"/><path d="M41 34l26 14-26 14z" fill="white"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#252b4a"/><stop offset="1" stop-color="#111827"/></linearGradient><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7c5cff"/><stop offset="1" stop-color="#00d4ff"/></linearGradient></defs><rect width="96" height="96" rx="22" fill="url(#g)"/><rect x="10" y="10" width="76" height="76" rx="18" fill="url(#a)" opacity=".28"/>${icon}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function mediaPlaceholderPath(kind = 'video') {
  return kind === 'image' ? 'image-placeholder.svg' : 'video-placeholder.svg';
}

function avatarPlaceholder(name) {
  const text = String(name || '?').replace(/^@/, '').slice(0, 2).toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7c5cff"/><stop offset="1" stop-color="#00d4ff"/></linearGradient></defs><rect width="96" height="96" rx="24" fill="url(#g)"/><text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="white">${text}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function installAvatarFallback(root = document) {
  root.querySelectorAll('img.avatar:not(.smart-image)').forEach(img => {
    img.addEventListener('error', () => {
      if (img.dataset.fallbackApplied === '1') return;
      img.dataset.fallbackApplied = '1';
      img.src = avatarPlaceholder(img.dataset.name || '');
      img.title = '头像源站暂时无法加载，已显示占位头像';
    }, { once: true });
  });
}

function isPaidSubscription(sub) {
  return sub.level === 'LEVEL1';
}

function subscriptionKindText(sub) {
  return isPaidSubscription(sub) ? '付费订阅' : '免费订阅';
}

function subscriptionStatusText(sub) {
  return sub.__subscriptionStatus === 'cancelled' ? '已取消' : '订阅中';
}

function markSubscriptions(list, status) {
  return (list || []).map(sub => ({ ...sub, __subscriptionStatus: status }));
}

function subscriptionStats() {
  return {
    total: activeSubscriptions.length + cancelledSubscriptions.length,
    activePaid: activeSubscriptions.filter(isPaidSubscription).length,
    activeFree: activeSubscriptions.filter(sub => !isPaidSubscription(sub)).length,
    cancelledPaid: cancelledSubscriptions.filter(isPaidSubscription).length,
    cancelledFree: cancelledSubscriptions.filter(sub => !isPaidSubscription(sub)).length,
  };
}

function applySubscriptionFilter() {
  const type = $('subscriptionType').value;
  if (type === 'activePaid') subscriptions = activeSubscriptions.filter(isPaidSubscription);
  else if (type === 'activeFree') subscriptions = activeSubscriptions.filter(sub => !isPaidSubscription(sub));
  else if (type === 'cancelledPaid') subscriptions = cancelledSubscriptions.filter(isPaidSubscription);
  else if (type === 'cancelledFree') subscriptions = cancelledSubscriptions.filter(sub => !isPaidSubscription(sub));
  else subscriptions = [...activeSubscriptions, ...cancelledSubscriptions];
  rawSubscriptions = [...activeSubscriptions, ...cancelledSubscriptions];
}

async function refreshConfig() {
  config = await api.getConfig();
  $('downloadDir').textContent = config.downloadDir;
  $('concurrencyInput').value = config.concurrency || 4;
  $('subscriptionType').value = config.subscriptionType || 'all';
  refreshLanguageSoon();
}

async function refreshAuth() {
  const status = await api.authStatus();
  $('authStatus').textContent = status.loggedIn
    ? (languageMode === 'en' ? `Logged in: ${status.user.username || status.user.uid || 'FansOne User'}` : `已登录：${status.user.username || status.user.uid || 'FansOne 用户'}`)
    : t('未登录');
  refreshLanguageSoon();
  return status;
}

function renderSubscriptions() {
  const root = $('subscriptions');
  const stats = subscriptionStats();
  $('subsCount').textContent = languageMode === 'en' ? `${subscriptions.length} / selected ${selectedSubscriptionUsernames.size}` : `${subscriptions.length} / 已选 ${selectedSubscriptionUsernames.size}`;
  $('loadSelectedSubsBtn').textContent = selectedSubscriptionUsernames.size
    ? (languageMode === 'en' ? `Load Selected Creators (${selectedSubscriptionUsernames.size})` : `加载选中作者帖子（${selectedSubscriptionUsernames.size}）`)
    : t('加载选中作者帖子');
  if (!subscriptions.length) {
    root.className = 'list empty';
    root.textContent = rawSubscriptions.length ? t('当前分类没有订阅项目。') : t('暂无订阅，或还未刷新。');
    refreshLanguageSoon();
    return;
  }
  root.className = 'list';
  root.innerHTML = '';
  for (const sub of subscriptions) {
    const item = document.createElement('div');
    item.className = `item ${sub.username === activeUsername ? 'active' : ''}`;
    item.innerHTML = `
      <input class="sub-checkbox" type="checkbox" data-username="${sub.username}" ${selectedSubscriptionUsernames.has(sub.username) ? 'checked' : ''} />
      <img class="avatar smart-image" src="${avatarPlaceholder(sub.username)}" data-src="${sub.avatar || ''}" data-name="${sub.username || '?'}" data-urls='${JSON.stringify(imageCandidatesForSubscription(sub))}' />
      <div class="item-main sub-open" title="点击加载这个作者的帖子">
        <div class="title">@${sub.username}</div>
        <div class="subtitle">${subscriptionStatusText(sub)} · ${subscriptionKindText(sub)} · 到期：${sub.expired_at ? new Date(sub.expired_at).toLocaleString() : '未知'}</div>
        <span class="badge">${sub.level || ''} ${sub.status || ''}</span>
      </div>
    `;
    item.querySelector('.sub-checkbox').addEventListener('change', (event) => {
      if (event.target.checked) selectedSubscriptionUsernames.add(sub.username);
      else selectedSubscriptionUsernames.delete(sub.username);
      renderSubscriptions();
      schedulePersistState();
    });
    item.querySelector('.sub-open').addEventListener('click', () => loadPosts(sub.username));
    root.appendChild(item);
  }
  installAvatarFallback(root);
  installSmartImageFallback(root);
  refreshLanguageSoon();
  log(`当前分类：订阅中付费 ${stats.activePaid}，订阅中免费 ${stats.activeFree}，已取消付费 ${stats.cancelledPaid}，已取消免费 ${stats.cancelledFree}`);
}

function postBadge(post) {
  if (post.type === 'VIDEO') return '视频';
  if (post.images) return `图片 ${post.imageCount || ''}`;
  return post.type || '帖子';
}



function imageCandidatesForPost(post) {
  const urls = [];
  const add = (url) => { if (url && !urls.includes(url)) urls.push(url); };
  if (post.type === 'VIDEO') {
    add(post.preview);
    add(post.thumb);
    add(post.cover);
    add(post.blurImageUrl);
    add(post.avatar);
  } else {
    add(post.thumb);
    add(post.preview);
    add(post.cover);
    add(post.blurImageUrl);
    add(post.avatar);
  }
  return urls;
}

function imageCandidatesForSubscription(sub) {
  return [sub.avatar, sub.cover].filter(Boolean);
}

function installSmartImageFallback(root = document) {
  root.querySelectorAll('img.smart-image').forEach(img => {
    if (img.dataset.smartInstalled === '1') return;
    img.dataset.smartInstalled = '1';

    const primary = img.dataset.src || '';
    const placeholder = avatarPlaceholder(img.dataset.name || '');

    img.addEventListener('error', () => {
      if (img.dataset.fallbackApplied === '1') return;
      img.dataset.fallbackApplied = '1';
      img.src = placeholder;
      img.removeAttribute('title');
    });

    // 先显示首字母占位，再尝试加载真实图片；失败时继续显示首字母。
    img.src = placeholder;
    if (primary) setTimeout(() => { img.src = primary; }, 0);
  });
}

function postImageSrc(post) {
  // 视频帖优先用 video 域名返回的 preview/thumbnail；static2 的 avif 缩略图经常被 Cloudflare 拦截。
  if (post.type === 'VIDEO') {
    return post.preview || post.thumb || post.cover || post.blurImageUrl || post.avatar || avatarPlaceholder(post.username || post.title);
  }
  return post.thumb || post.preview || post.cover || post.blurImageUrl || post.avatar || avatarPlaceholder(post.username || post.title);
}

function renderPosts() {
  const root = $('posts');
  $('postsCount').textContent = languageMode === 'en' ? `Total ${posts.length}` : `共 ${posts.length} 条`;
  if (!posts.length) {
    visiblePostIds.clear();
    root.className = 'list empty';
    root.textContent = activeUsername ? t('没有加载到帖子。') : t('请选择一个作者，或勾选多个作者后点击“加载选中作者帖子”。');
    refreshLanguageSoon();
    return;
  }
  visiblePostIds.clear();
  for (const post of posts) visiblePostIds.add(Number(post.id));
  root.className = 'list';
  root.innerHTML = '';
  for (const post of posts) {
    const item = document.createElement('label');
    item.className = 'item';
    const postId = Number(post.id);
    const downloaded = completedPostIds.has(postId);
    const downloading = downloadingPostIds.has(postId);
    const paused = downloadsPaused && downloading;
    const canDownload = !downloaded && !downloading && post.can_view !== 0 && (post.type === 'VIDEO' || post.images);
    item.innerHTML = `
      <input class="post-checkbox" type="checkbox" data-post-id="${post.id}" ${canDownload ? '' : 'disabled'} />
      <img class="avatar smart-image" src="${avatarPlaceholder(post.username || post.title)}" data-src="${postImageSrc(post)}" data-name="${post.username || post.title || '?'}" data-urls='${JSON.stringify(imageCandidatesForPost(post))}' />
      <div class="item-main">
        <div class="title">${post.title || '(无标题)'}</div>
        <div class="subtitle">@${post.username || ''} · ${post.created_at ? new Date(post.created_at).toLocaleString() : ''}</div>
        <span class="badge">${postBadge(post)}</span>
        ${post.can_view === 0 ? '<span class="badge">无访问权限</span>' : ''}
        ${paused ? '<span class="badge paused-badge">已暂停</span>' : ''}
        ${!paused && downloading ? '<span class="badge downloading-badge">正在下载</span>' : ''}
        ${downloaded ? '<span class="badge done-badge">已下载</span>' : ''}
      </div>
    `;
    root.appendChild(item);
  }
  installAvatarFallback(root);
  installSmartImageFallback(root);
  refreshLanguageSoon();
}

async function refreshSubscriptions() {
  const btn = $('refreshSubsBtn');
  try {
    setBusy(btn, true, '刷新中…');
    await api.setConfig({ subscriptionType: $('subscriptionType').value });
    const [activeData, cancelledData] = await Promise.all([
      api.getSubscriptions({ type: 'subscribing', allPages: true, limit: 100 }),
      api.getSubscriptions({ type: 'cancel', allPages: true, limit: 100 }),
    ]);
    activeSubscriptions = markSubscriptions(activeData.data || [], 'active');
    cancelledSubscriptions = markSubscriptions(cancelledData.data || [], 'cancelled');
    rawSubscriptions = [...activeSubscriptions, ...cancelledSubscriptions];
    selectedSubscriptionUsernames.clear();
    applySubscriptionFilter();
    activeUsername = null;
    posts = [];
    renderSubscriptions();
    renderPosts();
    const stats = subscriptionStats();
    log(`加载订阅项目 ${rawSubscriptions.length} 个：订阅中-付费 ${stats.activePaid}，订阅中-免费 ${stats.activeFree}，已取消-付费 ${stats.cancelledPaid}，已取消-免费 ${stats.cancelledFree}`);
    schedulePersistState();
  } catch (err) {
    log(`刷新订阅失败：${err.message || err}`);
    alert(err.message || String(err));
  } finally {
    setBusy(btn, false, '刷新订阅');
  }
}

async function loadPosts(username) {
  activeUsername = username;
  renderSubscriptions();
  $('postsTitle').textContent = `@${username} 的帖子`;
  const root = $('posts');
  root.className = 'list empty';
  root.textContent = '加载帖子中…';
  try {
    const data = await api.getPosts({ username, type: $('postType').value, allPages: true, limit: 100 });
    posts = (data.data || []).map(post => ({ ...post, username: post.username || username }));
    renderPosts();
    log(`@${username} 加载帖子 ${posts.length} 条`);
    schedulePersistState();
  } catch (err) {
    posts = [];
    renderPosts();
    log(`加载帖子失败：${err.message || err}`);
    alert(err.message || String(err));
  }
}

async function loadSelectedSubscriptionPosts() {
  const chosen = Array.from(selectedSubscriptionUsernames);
  if (!chosen.length) return alert('先在左侧勾选要批量加载的作者。');
  const btn = $('loadSelectedSubsBtn');
  const root = $('posts');
  try {
    setBusy(btn, true, '批量加载中…');
    activeUsername = null;
    $('postsTitle').textContent = `选中作者的帖子（${chosen.length} 个作者）`;
    root.className = 'list empty';
    root.textContent = `正在加载 1 / ${chosen.length} …`;
    const all = [];
    for (let i = 0; i < chosen.length; i += 1) {
      const username = chosen[i];
      root.textContent = `正在加载 ${i + 1} / ${chosen.length}：@${username}`;
      const data = await api.getPosts({ username, type: $('postType').value, allPages: true, limit: 100 });
      all.push(...(data.data || []).map(post => ({ ...post, username: post.username || username })));
      log(`@${username} 加载帖子 ${(data.data || []).length} 条`);
    }
    posts = all;
    renderSubscriptions();
    renderPosts();
    log(`批量加载完成：${chosen.length} 个作者，共 ${posts.length} 条帖子`);
    schedulePersistState();
  } catch (err) {
    log(`批量加载失败：${err.message || err}`);
    alert(err.message || String(err));
    renderPosts();
  } finally {
    setBusy(btn, false, `加载选中作者帖子${selectedSubscriptionUsernames.size ? `（${selectedSubscriptionUsernames.size}）` : ''}`);
  }
}

function selectedPosts() {
  const checked = Array.from(document.querySelectorAll('.post-checkbox:checked'));
  const ids = new Set(checked.map(el => Number(el.dataset.postId)));
  return posts.filter(post => ids.has(Number(post.id)));
}

function upsertJob(job) {
  const previous = jobs.get(job.jobId);
  const previousStatus = previous?.status;
  jobs.set(job.jobId, job);
  const postId = Number(job.postId);
  if (['queued', 'running'].includes(job.status)) {
    downloadingPostIds.add(postId);
  } else {
    downloadingPostIds.delete(postId);
  }
  if (job.status === 'done') completedPostIds.add(postId);

  const statusChanged = previousStatus !== job.status;
  if (statusChanged || ['done', 'error', 'cancelled', 'paused'].includes(job.status)) schedulePersistState();
  scheduleRenderJobs();

  // Re-render the large post grid only when badge state can change. Progress-only updates are ignored.
  if (statusChanged && visiblePostIds.has(postId)) scheduleRenderPosts();
}

function statusText(status) {
  return t(({ queued: '等待中', running: '下载中', paused: '已暂停', done: '已完成', error: '失败', cancelled: '已取消' })[status] || status || '未知');
}

function renderJobRow(job) {
  const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
  const speed = job.status === 'running' ? (job.speedText || formatSpeed(Number(job.speedBytes) || 0)) : '--';
  const transfer = job.transferText || (job.totalItems ? `${job.doneItems || 0}/${job.totalItems}` : '--');
  const downloaded = formatBytes(Number(job.downloadedBytes) || 0);
  const error = job.error ? `<div class="job-error">${escapeHtml(job.error)}</div>` : '';
  return `
    <article class="job-row ${escapeHtml(job.status || '')}">
      <div class="job-row-main">
        <div class="job-title-line">
          <strong>${escapeHtml(job.title || '(无标题)')}</strong>
          <span class="badge ${escapeHtml(job.status || '')}-badge">${statusText(job.status)}</span>
        </div>
        <div class="job-meta">
          <span>@${escapeHtml(job.username || 'unknown')}</span>
          <span>${escapeHtml(job.type || (languageMode === 'en' ? 'Content' : '内容'))}</span>
          <span>${languageMode === 'en' ? 'Segments' : '分片'} ${escapeHtml(transfer)}</span>
          <span>${languageMode === 'en' ? 'Downloaded' : '已下载'} ${downloaded}</span>
          <span>${languageMode === 'en' ? 'Speed' : '速度'} ${escapeHtml(speed)}</span>
        </div>
        <div class="progress job-progress"><div style="width:${progress}%"></div></div>
        ${error}
      </div>
      <b class="job-percent">${progress}%</b>
    </article>
  `;
}

function renderJobs() {
  const root = $('jobs');
  if (!root) return;
  const list = Array.from(jobs.values()).sort((a, b) => {
    const rank = { running: 0, queued: 1, paused: 2, error: 3, done: 4, cancelled: 5 };
    return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || String(b.createdAt || b.jobId).localeCompare(String(a.createdAt || a.jobId));
  });
  const active = list.filter(job => ['queued', 'running', 'paused'].includes(job.status));
  const running = active.filter(job => job.status === 'running');
  const done = list.filter(job => job.status === 'done');
  const errors = list.filter(job => job.status === 'error');

  const total = list.length;
  const progress = total ? Math.round(list.reduce((sum, job) => {
    if (job.status === 'done') return sum + 100;
    if (job.status === 'error' || job.status === 'cancelled') return sum;
    return sum + Math.max(0, Math.min(100, Number(job.progress) || 0));
  }, 0) / total) : 0;
  const speedBytes = running.reduce((sum, job) => sum + (Number(job.speedBytes) || 0), 0);
  const earliestStart = list.length ? Math.min(...list.map(job => job.startedAt || Date.now())) : Date.now();
  const elapsed = Math.max((Date.now() - earliestStart) / 1000, 1);
  const eta = progress > 0 && progress < 100 ? elapsed * ((100 - progress) / progress) : 0;
  const currentJob = running[0] || active[0] || errors[0] || null;
  const hasPaused = active.some(job => job.status === 'paused');
  const title = !list.length ? '暂无下载任务' : (errors.length && !active.length ? '下载失败，可点击重试失败' : ((downloadsPaused || hasPaused) && active.length ? '下载已暂停' : (active.length ? '正在下载' : '下载完成')));
  const subtitle = currentJob ? `${currentJob.title || '(无标题)'} · @${currentJob.username || 'unknown'}` : (list.length ? '当前没有正在运行的任务' : '选择帖子后点击下载，任务会显示在这里。');

  $('pauseDownloadsBtn').disabled = downloadsPaused || hasPaused || !active.length;
  $('resumeDownloadsBtn').disabled = !(downloadsPaused || hasPaused);
  $('resumeDownloadsBtn').textContent = t('继续');
  if ($('retryFailedDownloadsBtn')) $('retryFailedDownloadsBtn').disabled = !errors.length;
  if ($('downloadTotal')) $('downloadTotal').textContent = total;
  if ($('downloadActive')) $('downloadActive').textContent = active.length;
  if ($('downloadDone')) $('downloadDone').textContent = done.length;
  if ($('downloadErrors')) $('downloadErrors').textContent = errors.length;
  if ($('downloadSpeed')) $('downloadSpeed').textContent = formatSpeed(speedBytes);
  if ($('downloadEta')) $('downloadEta').textContent = languageMode === 'en' ? `ETA ${active.length ? formatEta(eta) : '--'}` : `预计 ${active.length ? formatEta(eta) : '--'}`;
  if ($('downloadStateTitle')) $('downloadStateTitle').textContent = t(title);
  if ($('downloadStateSubtitle')) $('downloadStateSubtitle').textContent = currentJob ? subtitle : t(subtitle);
  if ($('downloadPercent')) $('downloadPercent').textContent = `${progress}%`;
  if ($('downloadProgressBar')) $('downloadProgressBar').style.width = `${progress}%`;

  const activeCard = $('activeJobCard');
  if (activeCard) {
    if (currentJob) {
      const currentProgress = Math.max(0, Math.min(100, Number(currentJob.progress) || 0));
      activeCard.className = 'active-job-card';
      activeCard.innerHTML = `
        <div>
          <span class="muted">${languageMode === 'en' ? 'Current Task' : '当前任务'}</span>
          <strong>${escapeHtml(currentJob.title || (languageMode === 'en' ? '(Untitled)' : '(无标题)'))}</strong>
          <p>@${escapeHtml(currentJob.username || 'unknown')} · ${statusText(currentJob.status)}</p>
        </div>
        <div class="active-job-stats">
          <span>${languageMode === 'en' ? 'Progress' : '进度'} <b>${currentProgress}%</b></span>
          <span>${languageMode === 'en' ? 'Segments' : '分片'} <b>${escapeHtml(currentJob.transferText || (currentJob.totalItems ? `${currentJob.doneItems || 0}/${currentJob.totalItems}` : '--'))}</b></span>
          <span>${languageMode === 'en' ? 'Downloaded' : '已下载'} <b>${formatBytes(Number(currentJob.downloadedBytes) || 0)}</b></span>
          <span>${languageMode === 'en' ? 'Speed' : '速度'} <b>${escapeHtml(currentJob.speedText || formatSpeed(Number(currentJob.speedBytes) || 0))}</b></span>
        </div>
      `;
    } else {
      activeCard.className = 'active-job-card empty';
      activeCard.textContent = list.length ? t('当前没有正在下载的内容') : t('暂无正在下载的内容');
    }
  }

  if (!list.length) {
    root.className = 'jobs empty';
    root.innerHTML = t('暂无任务');
    refreshLanguageSoon();
    return;
  }

  root.className = 'jobs job-list';
  const visibleJobs = list.slice(0, MAX_RENDERED_JOBS);
  const hiddenCount = Math.max(0, list.length - visibleJobs.length);
  root.innerHTML = visibleJobs.map(renderJobRow).join('') + (hiddenCount
    ? `<div class="list-truncated-note">${languageMode === 'en' ? `${hiddenCount} older completed tasks hidden to keep the app responsive.` : `已隐藏 ${hiddenCount} 条较早任务，避免大量任务时界面卡顿。`}</div>`
    : '');
  refreshLanguageSoon();
}


async function init() {
  installNavigation();
  initLanguageToggle();
  initSidebarAdClick();
  loadSidebarAd({ scheduleRefresh: true });
  await refreshConfig();
  await restoreSavedAppState();
  await refreshAuth();
  const oldJobs = await api.listJobs();
  downloadsPaused = oldJobs.some(job => job.status === 'paused');
  oldJobs.forEach(upsertJob);
  scheduleRenderJobs({ immediate: true });

  $('loginBtn').addEventListener('click', () => api.openLogin());
  $('logoutBtn').addEventListener('click', async () => { await api.logout(); await refreshAuth(); });
  $('chooseDirBtn').addEventListener('click', async () => { const next = await api.chooseDownloadDir(); if (next) await refreshConfig(); });
  $('saveConfigBtn').addEventListener('click', async () => {
    await api.setConfig({ concurrency: Number($('concurrencyInput').value) || 4, subscriptionType: $('subscriptionType').value });
    await refreshConfig();
    log('设置已保存');
  });
  $('subscriptionType').addEventListener('change', () => {
    api.setConfig({ subscriptionType: $('subscriptionType').value });
    applySubscriptionFilter();
    renderSubscriptions();
    schedulePersistState();
  });
  $('refreshSubsBtn').addEventListener('click', refreshSubscriptions);
  $('selectAllSubsBtn').addEventListener('click', () => {
    subscriptions.forEach(sub => selectedSubscriptionUsernames.add(sub.username));
    renderSubscriptions();
    schedulePersistState();
  });
  $('clearSubsBtn').addEventListener('click', () => {
    selectedSubscriptionUsernames.clear();
    renderSubscriptions();
    schedulePersistState();
  });
  $('loadSelectedSubsBtn').addEventListener('click', loadSelectedSubscriptionPosts);
  $('postType').addEventListener('change', () => activeUsername && loadPosts(activeUsername));
  $('selectAllBtn').addEventListener('click', () => {
    document.querySelectorAll('.post-checkbox:not(:disabled)').forEach(el => { el.checked = true; });
  });
  $('clearSelectedPostsBtn')?.addEventListener('click', () => {
    document.querySelectorAll('.post-checkbox').forEach(el => { el.checked = false; });
  });
  $('downloadSelectedBtn').addEventListener('click', async () => {
    const chosen = selectedPosts();
    if (!chosen.length) return alert('先选择要下载的帖子。');
    const ids = await api.addDownloads(chosen);
    downloadsPaused = false;
    log(`已加入下载队列并开始下载：${ids.length} 个任务`);
    switchView('downloadView');
    renderJobs();
    renderPosts();
  });
  $('pauseDownloadsBtn').addEventListener('click', async () => { downloadsPaused = true; await api.pauseDownloads(); renderJobs(); renderPosts(); });
  $('resumeDownloadsBtn').addEventListener('click', async () => { downloadsPaused = false; await api.resumeDownloads(); renderJobs(); renderPosts(); });
  $('retryFailedDownloadsBtn')?.addEventListener('click', async () => { downloadsPaused = false; await api.retryFailedDownloads(); renderJobs(); renderPosts(); });
  $('openDownloadDirBtn').addEventListener('click', () => api.openPath(config.downloadDir));
  $('officialSiteBtn')?.addEventListener('click', () => api.openExternal('https://cangify.com'));
  $('clearDownloadRecordsBtn')?.addEventListener('click', async () => {
    if (!confirm('确定要清空所有下载记录吗？这不会删除已经下载到硬盘的文件，但会停止当前下载队列。')) return;
    const result = await api.clearDownloadRecords();
    jobs.clear();
    completedPostIds.clear();
    downloadingPostIds.clear();
    downloadsPaused = false;
    renderJobs();
    renderPosts();
    log(`已清空下载记录：${result.count || 0} 条`);
  });
  $('checkUpdateBtn')?.addEventListener('click', () => checkSoftwareUpdate());
  $('closeUpdateDialogBtn')?.addEventListener('click', hideUpdateDialog);
  $('laterUpdateBtn')?.addEventListener('click', hideUpdateDialog);
  $('downloadUpdateBtn')?.addEventListener('click', () => {
    if (latestUpdateResult?.downloadUrl) api.openExternal(latestUpdateResult.downloadUrl);
  });
  $('copyUpdateLinkBtn')?.addEventListener('click', async () => {
    const link = latestUpdateResult?.downloadUrl || latestUpdateResult?.homepage || '';
    if (!link) return;
    await api.writeClipboard(link);
    log('更新链接已复制');
  });
  setTimeout(() => checkSoftwareUpdate({ startup: true }), 2500);
    api.onAuthChanged(refreshAuth);

  api.onDownloadEvent((event) => {
    if (event.type === 'job-updated') upsertJob(event.job);
    if (event.type === 'queue-state') { downloadsPaused = Boolean(event.paused); scheduleRenderJobs({ immediate: true }); scheduleRenderPosts({ immediate: true }); }
    if (event.type === 'records-cleared') {
      jobs.clear();
      completedPostIds.clear();
      downloadingPostIds.clear();
      downloadsPaused = false;
      renderJobs();
      renderPosts();
    }
    if (event.type === 'job-log') log(event.message);
  });
}

init().catch(err => {
  console.error(err);
  alert(err.message || String(err));
});

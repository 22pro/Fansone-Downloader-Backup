import { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, clipboard } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import axios from 'axios';
import dayjs from 'dayjs';
import PQueue from 'p-queue';
import got from 'got';
import { resolveSources, trackCacheId, findFfmpeg, joinFiles, validateMedia, muxTracks } from './hls-media.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DATA_DIR = path.join(app.getPath('userData'), 'fansone-desktop');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const APP_STATE_PATH = path.join(DATA_DIR, 'app-state.json');
const LOGIN_PARTITION = 'persist:fansone';
const BASE_URL = 'https://fansone.co';
const API_BASE = `${BASE_URL}/api`;
const HTTP_TIMEOUT_MS = 45 * 1000;
const UPDATE_FEED_URL = 'https://cangify.com/globle/update/fo-backup.json';
const SIDEBAR_AD_FEED_URL = 'https://cangify.com/globle/ads/fo-backup/fo-backup.json';
const FREE_SPEED_LIMIT_BPS = 100 * 1024;

// Ubuntu 上 npm 安装的 Electron 常见 chrome-sandbox 权限不满足；本工具只加载本地 UI + FansOne 登录页。
app.commandLine.appendSwitch('no-sandbox');

let mainWindow;
let loginWindow;
let splashWindow;
let downloadManager;
let runtimeConfigCache = null;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function compareVersions(a, b) {
  const left = String(a || '0').replace(/^v/i, '').split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const right = String(b || '0').replace(/^v/i, '').split(/[.-]/).map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function checkUpdate(url = UPDATE_FEED_URL) {
  const currentVersion = app.getVersion();
  const response = await got.get(url, {
    responseType: 'json',
    timeout: { request: 12000 },
    retry: { limit: 1 },
    headers: { 'Cache-Control': 'no-cache' }
  });
  const data = response.body || {};
  const latestVersion = data.latest_version || data.version || data.latestVersion;
  if (!latestVersion) throw new Error('更新 JSON 缺少 latest_version/version 字段。');
  const downloadUrl = data.download_url || data.windows_download_url || data.url || data.homepage || '';
  return {
    ok: true,
    feedUrl: url,
    currentVersion,
    latestVersion,
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    mandatory: Boolean(data.mandatory),
    releaseDate: data.release_date || data.releaseDate || '',
    notes: Array.isArray(data.notes) ? data.notes : (data.notes ? [String(data.notes)] : []),
    downloadUrl,
    homepage: data.homepage || '',
    raw: data
  };
}

function normalizeSidebarAdItem(item = {}) {
  const imageUrl = item.imageUrl || item.image_url || item.image || item.src || '';
  const linkUrl = item.linkUrl || item.link_url || item.link || item.url || item.href || '';
  return {
    enabled: item.enabled !== false && Boolean(imageUrl && linkUrl),
    imageUrl,
    linkUrl,
    alt: item.alt || item.title || 'FO-BACKUP 广告',
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

class DownloadPausedError extends Error {
  constructor(message = '下载已暂停') {
    super(message);
    this.name = 'DownloadPausedError';
  }
}

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function updateJobTransfer(job, { progress, downloadedBytes, totalItems, doneItems } = {}) {
  if (!job) return;
  const now = Date.now();
  if (!job.startedAt) job.startedAt = now;
  if (typeof progress === 'number') job.progress = progress;
  if (typeof totalItems === 'number') job.totalItems = totalItems;
  if (typeof doneItems === 'number') job.doneItems = doneItems;

  if (typeof downloadedBytes === 'number') {
    const previousBytes = Number(job.downloadedBytes) || 0;
    const previousSpeedAt = Number(job.lastSpeedAt) || now;
    const deltaBytes = Math.max(0, downloadedBytes - previousBytes);
    const deltaSeconds = Math.max((now - previousSpeedAt) / 1000, 0.1);
    const instantSpeed = deltaBytes / deltaSeconds;

    job.downloadedBytes = downloadedBytes;
    job.lastSpeedAt = now;
    // Smooth the value a little so it does not jump wildly between HLS segments.
    job.speedBytes = job.speedBytes
      ? Math.round(job.speedBytes * 0.45 + instantSpeed * 0.55)
      : Math.round(instantSpeed);
  }

  job.speedText = job.status === 'running' ? `${formatBytes(job.speedBytes || 0)}/s` : '';
  job.transferText = job.totalItems ? `${job.doneItems || 0}/${job.totalItems}` : '';
}

function isMember(_config = {}) {
  // FO-BACKUP is now a free app: all local download privileges are always unlocked.
  return true;
}

function downloadConcurrency(value, _config = {}) {
  const n = Number(value) || 4;
  return Math.max(1, Math.min(20, n));
}

function createSpeedLimitStream({ bytesPerSecond = FREE_SPEED_LIMIT_BPS, shouldLimit = () => true } = {}) {
  let nextAvailableAt = Date.now();
  return new Transform({
    transform(chunk, _encoding, callback) {
      if (!shouldLimit()) {
        nextAvailableAt = Date.now();
        callback(null, chunk);
        return;
      }
      const now = Date.now();
      const waitMs = Math.max(0, nextAvailableAt - now);
      nextAvailableAt = Math.max(now, nextAvailableAt) + Math.ceil((chunk.length / bytesPerSecond) * 1000);
      setTimeout(() => callback(null, chunk), waitMs);
    }
  });
}


function safeName(input, fallback = 'untitled') {
  const cleaned = String(input || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return cleaned || fallback;
}

function userDirName(item) {
  const display = safeName(item.displayname || item.displayName || item.username || 'creator');
  const username = safeName(item.username || 'unknown');
  return `${display}(@${username})`;
}

function postFileBaseName(post, fallback = 'video') {
  const title = safeName(post.title, fallback);
  const publishedAt = post.created_at
    ? dayjs(post.created_at).format('YYYY-MM-DD HH-mm-ss')
    : 'unknown-time';
  return `${title} - ${publishedAt}`;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function readConfig() {
  const defaults = {
    downloadDir: path.join(app.getPath('downloads'), 'FansOne'),
    concurrency: 4,
    subscriptionType: 'subscribing',
    freeAccess: true
  };
  runtimeConfigCache = { ...defaults, ...(await readJson(CONFIG_PATH, {})) };
  return runtimeConfigCache;
}

async function writeConfig(patch) {
  const next = { ...(await readConfig()), ...patch };
  await writeJson(CONFIG_PATH, next);
  runtimeConfigCache = next;
  return next;
}

function shouldApplyFreeSpeedLimit() {
  return false;
}

async function restoreMainWindowPresentation(wasMaximized) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (wasMaximized && !mainWindow.isMaximized()) mainWindow.maximize();
}


function getFansoneSession() {
  return session.fromPartition(LOGIN_PARTITION);
}

async function getCookieString() {
  const cookies = await getFansoneSession().cookies.get({ url: BASE_URL });
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function parseCookieUser(cookieString) {
  const info = {};
  for (const part of cookieString.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    const value = rest.join('=');
    if (rawName === 'uid') info.uid = value;
    if (rawName === 'userId') info.userId = value;
    if (rawName === 'username') info.username = decodeURIComponent(value || '');
  }
  return info;
}

async function createApiClient() {
  const cookieString = await getCookieString();
  const user = parseCookieUser(cookieString);
  if (!cookieString || !user.uid) {
    throw new Error('尚未登录，或登录 cookie 中没有 uid。请先点击“登录/重新登录”。');
  }
  const client = axios.create({
    baseURL: API_BASE,
    timeout: 30000,
    headers: {
      Cookie: cookieString,
      Referer: `${BASE_URL}/`,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144 Safari/537.36'
    }
  });
  return { client, user, cookieString };
}

async function apiGet(pathname, params) {
  const { client } = await createApiClient();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await client.get(pathname, { params });
      if (response.status !== 200 || response.data?.success === false) {
        throw new Error(response.data?.message || `API 请求失败: ${pathname}`);
      }
      return response.data;
    } catch (err) {
      if ([401, 403].includes(httpStatusCode(err)) || attempt === 3) throw err;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
}

async function apiGetAllPages(pathname, params, { limit = 100, maxPages = 200 } = {}) {
  const first = await apiGet(pathname, { ...params, page: 1, limit });
  const totalCount = Number(first.count ?? first.totalCount ?? first.total ?? 0);
  const pageCount = totalCount ? Math.min(Math.ceil(totalCount / limit), maxPages) : 1;
  const data = Array.isArray(first.data) ? [...first.data] : [];
  for (let page = 2; page <= pageCount; page += 1) {
    const next = await apiGet(pathname, { ...params, page, limit });
    if (Array.isArray(next.data)) data.push(...next.data);
  }
  return { ...first, data, count: totalCount || data.length, totalCount: totalCount || data.length, pageCount };
}

async function getSubscriptions({ page = 1, limit = 100, type = 'subscribing', allPages = false } = {}) {
  const { user } = await createApiClient();
  const params = { uid: user.uid, type };
  if (allPages) return apiGetAllPages('/subscription', params, { limit });
  return apiGet('/subscription', { ...params, page, limit });
}

async function getPosts({ username, page = 1, limit = 100, type = 'all', allPages = false }) {
  const { user } = await createApiClient();
  const params = { uid: user.uid, username, type, isEnablePager: false };
  if (allPages) return apiGetAllPages('/post', params, { limit });
  return apiGet('/post', { ...params, page, limit });
}

async function getVideoSignedUrl(videoId, domain) {
  const data = await apiGet('/bunny/signed-url', { videoId, domain });
  return data.url;
}

function resolveUrl(baseUrl, target) {
  return new URL(target, baseUrl).toString();
}

function httpStatusCode(err) {
  return Number(err?.response?.statusCode || err?.response?.status || err?.statusCode || err?.status || 0);
}

async function getPostVideoPlaylist(post, headers) {
  const url = post.domain === 'video7.fansone.co'
    ? `https://${post.domain}/${post.domain}/${post.video}/master.m3u8`
    : await getVideoSignedUrl(post.video, post.domain);
  return resolveSources(url, target => fetchTextWithRetry(target, headers));
}


async function fetchFirstImageAsDataUrl(urls = []) {
  const headers = {
    Referer: `${BASE_URL}/`,
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144 Safari/537.36'
  };
  for (const url of urls) {
    if (!url || !/^https?:\/\//.test(String(url))) continue;
    try {
      const response = await got.get(url, {
        headers,
        retry: { limit: 0 },
        timeout: { request: 12000 },
        throwHttpErrors: false,
        responseType: 'buffer'
      });
      const contentType = response.headers['content-type'] || '';
      if (response.statusCode >= 200 && response.statusCode < 300 && contentType.startsWith('image/')) {
        return `data:${contentType.split(';')[0]};base64,${response.body.toString('base64')}`;
      }
    } catch {
      // Try next candidate URL.
    }
  }
  return null;
}

async function fetchTextWithRetry(url, headers) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return (await got.get(url, { headers, retry: { limit: 0 }, timeout: { request: HTTP_TIMEOUT_MS } })).body;
    } catch (err) {
      if ([401, 403].includes(httpStatusCode(err)) || attempt === 3) throw err;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
}

async function fileExistsNonEmpty(file) {
  try {
    const stat = await fs.stat(file);
    return stat.size > 0;
  } catch {
    return false;
  }
}

async function fileSize(file) {
  try {
    const stat = await fs.stat(file);
    return stat.size || 0;
  } catch {
    return 0;
  }
}

async function resumeDownloadToFile(url, target, { headers = {}, signal, speedLimited = false, progressStream = null } = {}) {
  if (await fileExistsNonEmpty(target)) return { skipped: true, size: await fileSize(target) };
  const partTarget = `${target}.part`;
  await ensureDir(path.dirname(target));
  let existingBytes = await fileSize(partTarget);
  const requestHeaders = existingBytes > 0 ? { ...headers, Range: `bytes=${existingBytes}-` } : headers;
  const source = got.stream(url, { headers: requestHeaders, retry: { limit: 0 }, signal, timeout: { request: HTTP_TIMEOUT_MS } });
  const responsePromise = once(source, 'response');
  const errorPromise = once(source, 'error').then(([err]) => { throw err; });
  const [response] = await Promise.race([responsePromise, errorPromise]);
  if (existingBytes > 0 && response.statusCode === 200) {
    // Server ignored Range; restart this partial file instead of appending duplicate bytes.
    existingBytes = 0;
    await fs.rm(partTarget, { force: true }).catch(() => {});
  }
  if (existingBytes > 0 && response.statusCode && response.statusCode !== 206) {
    throw new Error(`服务器不支持断点续传，状态码 ${response.statusCode}`);
  }
  if (existingBytes > 0) {
    const contentRange = String(response.headers['content-range'] || '').match(/^bytes (\d+)-(\d+)\/(?:\d+|\*)$/);
    if (!contentRange || Number(contentRange[1]) !== existingBytes) {
      source.destroy();
      throw new Error('服务器返回的续传范围不匹配，已保留原有分片。');
    }
  }
  const output = createWriteStream(partTarget, { flags: existingBytes > 0 ? 'a' : 'w' });
  const speedLimitCheck = typeof speedLimited === 'function' ? speedLimited : () => Boolean(speedLimited);
  const streams = speedLimitCheck() || typeof speedLimited === 'function'
    ? [source, createSpeedLimitStream({ shouldLimit: speedLimitCheck })]
    : [source];
  if (progressStream) streams.push(progressStream);
  streams.push(output);
  await pipeline(...streams);
  await fs.rename(partTarget, target);
  return { skipped: false, resumedBytes: existingBytes, size: await fileSize(target) };
}

function resolveBundledFfmpegPath() {
  try {
    const staticPath = require('ffmpeg-static');
    if (staticPath) {
      // In packaged Electron apps, executable resources unpacked from app.asar live under app.asar.unpacked.
      if (app.isPackaged && staticPath.includes('app.asar')) {
        return staticPath.replace('app.asar', 'app.asar.unpacked');
      }
      return staticPath;
    }
  } catch {
    // Dependency may be absent in development on SMB/Linux; fall back below.
  }
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

class DownloadManager {
  constructor(win) {
    this.win = win;
    // Each post already downloads segments/images concurrently; keep posts serial to avoid bulk-download stalls.
    this.queue = new PQueue({ concurrency: 1 });
    this.jobs = new Map();
    this.cancelled = new Set();
    this.running = new Set();
    this.enqueued = new Set();
    this.activeControllers = new Map();
    this.paused = false;
  }

  emit(type, payload) {
    this.win?.webContents?.send('download-event', { type, ...payload });
  }

  listJobs() {
    return Array.from(this.jobs.values());
  }

  async loadState() {
    const state = await readJson(STATE_PATH, { jobs: [], paused: false });
    this.paused = Boolean(state.paused);
    for (const saved of state.jobs || []) {
      if (!saved?.jobId) continue;
      const job = { ...saved };
      if (['running', 'queued'].includes(job.status)) job.status = this.paused ? 'paused' : 'queued';
      this.jobs.set(job.jobId, job);
    }
    if (this.paused) {
      this.queue.pause();
    } else {
      for (const job of this.jobs.values()) {
        if (job.status === 'queued') this.enqueueJob(job);
      }
      this.queue.start();
      this.saveState().catch(() => {});
    }
    return this.listJobs();
  }

  async saveState() {
    await writeJson(STATE_PATH, { paused: this.paused, jobs: this.listJobs().slice(-2000), updatedAt: new Date().toISOString() });
  }

  _trackController(jobId, controller) {
    if (!this.activeControllers.has(jobId)) this.activeControllers.set(jobId, new Set());
    this.activeControllers.get(jobId).add(controller);
  }

  _untrackController(jobId, controller) {
    const controllers = this.activeControllers.get(jobId);
    if (!controllers) return;
    controllers.delete(controller);
    if (!controllers.size) this.activeControllers.delete(jobId);
  }

  _abortJobStreams(jobId) {
    for (const controller of this.activeControllers.get(jobId) || []) {
      try { controller.abort(); } catch {}
    }
  }

  _ensureRunnable(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('下载任务已移除');
    if (this.cancelled.has(jobId)) throw new Error('下载已取消');
    if (this.paused || job?.pauseRequested) throw new DownloadPausedError();
  }

  enqueueJob(job) {
    if (!job?.jobId || !job.post || this.enqueued.has(job.jobId) || this.running.has(job.jobId)) return false;
    this.enqueued.add(job.jobId);
    this.queue.add(async () => {
      try {
        await this.runJob(job.jobId, job.post);
      } finally {
        this.enqueued.delete(job.jobId);
      }
    });
    return true;
  }

  cancel(jobId) {
    this.cancelled.add(jobId);
    this._abortJobStreams(jobId);
    this.emit('job-log', { jobId, message: '已请求取消，正在停止当前下载。' });
  }

  pause() {
    if (this.paused) return { paused: true };
    this.paused = true;
    this.queue.pause();
    this.queue.clear();
    this.enqueued.clear();
    for (const job of this.jobs.values()) {
      if (job.status === 'queued') {
        job.status = 'paused';
        job.speedText = '';
        this.emit('job-updated', { job });
      }
    }
    for (const jobId of this.running) {
      const job = this.jobs.get(jobId);
      if (job) {
        job.pauseRequested = true;
        job.resumeAfterPause = false;
        job.status = 'paused';
        job.speedText = '';
        this.emit('job-updated', { job });
      }
      this._abortJobStreams(jobId);
    }
    this.saveState().catch(() => {});
    this.emit('queue-state', { paused: true });
    this.emit('job-log', { message: '下载队列已暂停：正在停止当前网络请求；已完成的分片/图片会保留。' });
    return { paused: true };
  }

  resume() {
    this.paused = false;
    let queued = 0;
    for (const job of this.jobs.values()) {
      if (job.status === 'paused' || job.status === 'queued') {
        if (this.running.has(job.jobId)) {
          job.resumeAfterPause = true;
          job.status = 'paused';
          this.emit('job-updated', { job });
          continue;
        }
        job.pauseRequested = false;
        job.resumeAfterPause = false;
        job.status = 'queued';
        job.error = null;
        job.speedText = '';
        this.emit('job-updated', { job });
        if (this.enqueueJob(job)) queued += 1;
      }
    }
    this.queue.start();
    this.saveState().catch(() => {});
    this.emit('queue-state', { paused: false });
    this.emit('job-log', { message: `下载队列已继续：恢复 ${queued} 个任务，会自动跳过已完成的分片/图片。` });
    return { paused: false, queued };
  }

  retryFailed() {
    this.paused = false;
    let queued = 0;
    for (const job of this.jobs.values()) {
      if (job.status !== 'error') continue;
      job.pauseRequested = false;
      job.resumeAfterPause = false;
      job.status = 'queued';
      job.error = null;
      job.speedText = '';
      this.emit('job-updated', { job });
      if (this.enqueueJob(job)) queued += 1;
    }
    this.queue.start();
    this.saveState().catch(() => {});
    this.emit('queue-state', { paused: false });
    this.emit('job-log', { message: `已重试失败任务：重新排队 ${queued} 个，会自动跳过已完成的分片/图片。` });
    return { paused: false, queued };
  }

  clearRecords() {
    const count = this.jobs.size;
    this.paused = false;
    this.queue.clear();
    this.queue.start();
    this.enqueued.clear();
    for (const jobId of this.running) this._abortJobStreams(jobId);
    this.running.clear();
    this.cancelled.clear();
    this.activeControllers.clear();
    this.jobs.clear();
    this.saveState().catch(() => {});
    this.emit('queue-state', { paused: false });
    this.emit('records-cleared', { count });
    this.emit('job-log', { message: `已清空 ${count} 条下载记录，不会删除已下载文件。` });
    return { ok: true, count };
  }

  addPosts(posts) {
    const ids = [];
    if (Array.isArray(posts) && posts.length && this.paused) {
      this.paused = false;
      this.queue.start();
      this.emit('queue-state', { paused: false });
      this.emit('job-log', { message: '已自动开始下载队列。' });
    }
    for (const post of posts) {
      const postId = Number(post.id);
      const existing = Array.from(this.jobs.values()).find(job => Number(job.postId) === postId && ['queued', 'running', 'paused'].includes(job.status));
      if (existing) {
        ids.push(existing.jobId);
        if (existing.status === 'done') {
          this.emit('job-log', { message: `已跳过已完成任务：${existing.title || post.title || post.id}` });
        } else if (existing.status === 'paused') {
          existing.pauseRequested = false;
          existing.resumeAfterPause = false;
          existing.status = 'queued';
          existing.error = null;
          existing.speedText = '';
          this.emit('job-updated', { job: existing });
          this.enqueueJob(existing);
        }
        continue;
      }
      const jobId = `${post.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const job = {
        jobId,
        postId: post.id,
        title: post.title || '(无标题)',
        username: post.username,
        type: post.type,
        status: 'queued',
        progress: 0,
        speedText: '',
        transferText: '',
        downloadedBytes: 0,
        outputPath: null,
        error: null,
        pauseRequested: false,
        resumeAfterPause: false,
        post
      };
      this.jobs.set(jobId, job);
      ids.push(jobId);
      this.emit('job-updated', { job });
      if (!this.paused) this.enqueueJob(job);
    }
    this.saveState().catch(() => {});
    return ids;
  }

  async runJob(jobId, post) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    try {
      if (this.paused || job.pauseRequested) throw new DownloadPausedError();
      if (job.status === 'done') return;
      this.running.add(jobId);
      job.pauseRequested = false;
      job.resumeAfterPause = false;
      job.status = 'running';
      job.post = post;
      job.startedAt = job.startedAt || Date.now();
      updateJobTransfer(job, { progress: job.progress || 0, downloadedBytes: Number(job.downloadedBytes) || 0 });
      this.emit('job-updated', { job });
      await this.saveState();
      if (post.type === 'VIDEO' && post.video) {
        job.outputPath = await this.downloadVideo(jobId, post);
        job.mediaValidationVersion = 2;
      } else if (post.images) {
        job.outputPath = await this.downloadImages(jobId, post);
      } else {
        throw new Error('这个帖子没有可下载的视频或图片。');
      }
      job.status = this.cancelled.has(jobId) ? 'cancelled' : 'done';
      job.progress = job.status === 'done' ? 100 : job.progress;
      job.pauseRequested = false;
      job.resumeAfterPause = false;
      if (job.status === 'done') {
        job.speedText = '';
        job.transferText = '';
      }
    } catch (err) {
      if (err instanceof DownloadPausedError || job.pauseRequested) {
        job.status = 'paused';
        job.error = null;
        job.speedText = '';
      } else if (this.cancelled.has(jobId)) {
        job.status = 'cancelled';
        job.error = null;
        job.speedText = '';
      } else {
        job.status = 'error';
        job.error = err?.message || String(err);
      }
    } finally {
      const shouldResume = job.status === 'paused' && job.resumeAfterPause && !this.paused && !this.cancelled.has(jobId);
      this.running.delete(jobId);
      this.cancelled.delete(jobId);
      job.pauseRequested = false;
      job.resumeAfterPause = false;
      await this.saveState();
      this.emit('job-updated', { job });
      if (shouldResume) {
        job.status = 'queued';
        this.emit('job-updated', { job });
        this.enqueueJob(job);
        this.queue.start();
        await this.saveState();
      }
    }
  }

  async downloadVideo(jobId, post) {
    const config = await readConfig();
    const headers = { Referer: `${BASE_URL}/`, 'User-Agent': 'Mozilla/5.0' };
    const creatorDir = path.join(config.downloadDir, userDirName(post), 'videos');
    const tempDir = path.join(config.downloadDir, '.tmp', `post-${post.id}`, 'hls-v2');
    await ensureDir(creatorDir);
    await ensureDir(tempDir);
    this._ensureRunnable(jobId);
    const job = this.jobs.get(jobId);
    const emitProgress = (progress, message, doneItems = 0, totalItems = 0, downloadedBytes = 0) => {
      if (!job) return;
      updateJobTransfer(job, { progress, doneItems, totalItems, downloadedBytes });
      job.speedText = message;
      this.emit('job-updated', { job });
      this.saveState().catch(() => {});
    };
    emitProgress(1, '检查封装工具');
    const ffmpeg = await findFfmpeg(resolveBundledFfmpegPath());
    emitProgress(2, '读取视频与音轨清单');
    const sources = await getPostVideoPlaylist(post, headers);
    this._ensureRunnable(jobId);
    const expectations = { requireAudio: Boolean(sources.audio), videoDuration: sources.video.duration, audioDuration: sources.audio?.duration || 0 };
    this.emit('job-log', { jobId, message: `已读取清单：视频 ${sources.video.segments.length} 段${sources.audio ? `，独立音轨 ${sources.audio.segments.length} 段` : ''}。` });
    const baseFile = postFileBaseName(post, 'video');
    let finalOutput = path.join(creatorDir, `${baseFile}.mp4`);
    if (await fileExistsNonEmpty(finalOutput)) {
      const validation = new AbortController();
      this._trackController(jobId, validation);
      try {
        await validateMedia(ffmpeg, finalOutput, { ...expectations, signal: validation.signal });
        this._ensureRunnable(jobId);
        this.emit('job-log', { jobId, message: '已有 MP4 已通过音视频校验，跳过下载。' });
        return finalOutput;
      } catch (error) {
        this._ensureRunnable(jobId);
        if (validation.signal.aborted || error.name === 'AbortError') throw error;
        // Never overwrite an existing user file, even if it fails validation.
        finalOutput = path.join(creatorDir, `${baseFile}.repaired-${Date.now()}.mp4`);
        this.emit('job-log', { jobId, message: '已有 MP4 未通过校验，将另存修复版并保留原件。' });
      } finally {
        this._untrackController(jobId, validation);
      }
    } else {
      // A zero-length user file also must not be overwritten.
      try { await fs.access(finalOutput); finalOutput = path.join(creatorDir, `${baseFile}.repaired-${Date.now()}.mp4`); } catch {}
    }
    const tracks = [['video', sources.video], ...(sources.audio ? [['audio', sources.audio]] : [])].map(([kind, track]) => {
      const dir = path.join(tempDir, `${kind}-${trackCacheId(track)}`);
      const items = [
        ...(track.initUrl ? [{ url: track.initUrl, target: path.join(dir, 'init.mp4') }] : []),
        ...track.segments.map((url, index) => ({ url, target: path.join(dir, `${String(index).padStart(6, '0')}.segment`) }))
      ];
      return { kind, track, items };
    });
    const items = tracks.flatMap(t => t.items);
    let done = 0, downloadedBytes = 0;
    const queue = new PQueue({ concurrency: downloadConcurrency(config.concurrency, config) });
    let firstFailure = null;
    const tasks = items.map(item => queue.add(async () => {
      if (firstFailure) throw firstFailure;
      this._ensureRunnable(jobId);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (firstFailure) throw firstFailure;
        this._ensureRunnable(jobId);
        const controller = new AbortController();
        this._trackController(jobId, controller);
        try {
          await resumeDownloadToFile(item.url, item.target, { headers, signal: controller.signal, speedLimited: shouldApplyFreeSpeedLimit });
          if (!(await fileExistsNonEmpty(item.target))) throw new Error('分片为空，未标记为完成。');
          break;
        } catch (error) {
          if (this.paused || this.jobs.get(jobId)?.pauseRequested) throw new DownloadPausedError();
          if (this.cancelled.has(jobId)) throw new Error('下载已取消');
          this._ensureRunnable(jobId);
          if (controller.signal.aborted) throw firstFailure || error;
          const status = httpStatusCode(error);
          if ([401, 403].includes(status)) {
            firstFailure = new Error(`原站拒绝资源请求（HTTP ${status}），已停止。请先确认原站可正常播放；原文件及缓存已保留。`);
            this._abortJobStreams(jobId);
            throw firstFailure;
          }
          if (firstFailure) throw firstFailure;
          if (attempt === 3 || (status >= 400 && status < 500)) throw error;
          await sleep(500 * attempt);
          this._ensureRunnable(jobId);
        } finally {
          this._untrackController(jobId, controller);
        }
      }
      this._ensureRunnable(jobId);
      const completedBytes = await fileSize(item.target);
      downloadedBytes += completedBytes;
      done += 1;
      emitProgress(Math.round(done / items.length * 90), `${done}/${items.length} · 视频与音轨`, done, items.length, downloadedBytes);
    }).catch(error => { firstFailure ||= error; throw error; }));
    const settled = await Promise.allSettled(tasks);
    this._ensureRunnable(jobId);
    if (firstFailure) throw firstFailure;
    const failed = settled.find(item => item.status === 'rejected');
    if (failed) throw failed.reason;
    const operation = new AbortController();
    this._trackController(jobId, operation);
    const workDir = await fs.mkdtemp(path.join(tempDir, 'work-'));
    const assembled = tracks.map(t => path.join(workDir, `${t.kind}.${t.track.initUrl ? 'mp4' : 'ts'}`));
    const candidate = path.join(workDir, 'output.mp4');
    try {
      emitProgress(94, '合并初始化段与媒体分片', done, items.length, downloadedBytes);
      for (let i = 0; i < tracks.length; i += 1) await joinFiles(tracks[i].items.map(item => item.target), assembled[i], { signal: operation.signal });
      this._ensureRunnable(jobId);
      emitProgress(97, '无损封装并校验音视频', done, items.length, downloadedBytes);
      await muxTracks(ffmpeg, assembled[0], assembled[1] || null, candidate, { ...expectations, signal: operation.signal });
      this._ensureRunnable(jobId);
      // Hard-link publication is atomic and refuses to overwrite a pre-existing file.
      await fs.link(candidate, finalOutput);
      this.emit('job-log', { jobId, message: 'MP4 已通过音视频校验；原 TS 和下载缓存均保留。' });
      return finalOutput;
    } finally {
      this._untrackController(jobId, operation);
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async downloadImages(jobId, post) {
    const config = await readConfig();
    const urls = String(post.images || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!urls.length) throw new Error('没有图片地址。');
    const outputDir = path.join(config.downloadDir, userDirName(post), 'photos');
    await ensureDir(outputDir);
    const baseFile = postFileBaseName(post, 'photo');
    const targets = urls.map((url, index) => {
      const ext = path.extname(new URL(url).pathname) || '.jpg';
      return path.join(outputDir, `${baseFile}-${index + 1}${ext}`);
    });
    if ((await Promise.all(targets.map(fileExistsNonEmpty))).every(Boolean)) {
      this.emit('job-log', { jobId, message: `图片已全部存在，跳过下载：${outputDir}` });
      return outputDir;
    }

    const queue = new PQueue({ concurrency: downloadConcurrency(config.concurrency, config) });
    let done = 0;
    let downloadedBytes = 0;
    const completedAtStart = new Set();
    for (const target of targets) {
      if (await fileExistsNonEmpty(target)) {
        completedAtStart.add(target);
        done += 1;
        downloadedBytes += await fileSize(target);
      }
    }
    const settled = await Promise.allSettled(urls.map((url, index) => queue.add(async () => {
      this._ensureRunnable(jobId);
      const target = targets[index];
      if (completedAtStart.has(target)) return;
      if (!(await fileExistsNonEmpty(target))) {
        const controller = new AbortController();
        this._trackController(jobId, controller);
        try {
          await resumeDownloadToFile(url, target, {
            signal: controller.signal,
            speedLimited: shouldApplyFreeSpeedLimit
          });
        } catch (err) {
          if (this.paused || this.jobs.get(jobId)?.pauseRequested || controller.signal.aborted) {
            throw new DownloadPausedError();
          }
          throw err;
        } finally {
          this._untrackController(jobId, controller);
        }
      }
      this._ensureRunnable(jobId);
      if (!(await fileExistsNonEmpty(target))) throw new Error(`图片下载不完整：${path.basename(target)}`);
      downloadedBytes += await fileSize(target);
      done += 1;
      const job = this.jobs.get(jobId);
      if (job) {
        updateJobTransfer(job, {
          progress: Math.round((done / urls.length) * 100),
          downloadedBytes,
          totalItems: urls.length,
          doneItems: done
        });
        this.emit('job-updated', { job });
        this.saveState().catch(() => {});
      }
    })));
    if (this.paused || this.jobs.get(jobId)?.pauseRequested) throw new DownloadPausedError();
    const failed = settled.find((item) => item.status === 'rejected');
    if (failed) throw failed.reason;
    return outputDir;
  }
}


function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 300,
    resizable: false,
    frame: false,
    show: false,
    center: true,
    backgroundColor: '#eef2f7',
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.on('closed', () => { splashWindow = null; });
  return splashWindow;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

async function createMainWindow() {
  await ensureDir(DATA_DIR);
  Menu.setApplicationMenu(null);
  createSplashWindow();
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 1120,
    minHeight: 760,
    title: 'FansOne 下载器',
    icon: path.join(__dirname, '../build/icon.png'),
    show: false,
    backgroundColor: '#eef2f7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await mainWindow.webContents.session.clearCache().catch(() => {});
  downloadManager = new DownloadManager(mainWindow);
  await downloadManager.loadState();
  mainWindow.once('ready-to-show', showMainWindow);
  mainWindow.webContents.once('did-finish-load', () => setTimeout(showMainWindow, 180));
  mainWindow.on('close', () => {
    downloadManager?.pause();
  });
  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createMainWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });

ipcMain.handle('app:get-config', readConfig);
ipcMain.handle('app:set-config', (_e, patch) => writeConfig(patch));
ipcMain.handle('app:choose-download-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  return writeConfig({ downloadDir: result.filePaths[0] });
});
ipcMain.handle('app:open-path', (_e, target) => shell.openPath(target));
ipcMain.handle('shell:open-external', (_e, target) => shell.openExternal(String(target || '')));
ipcMain.handle('clipboard:write-text', (_e, text) => { clipboard.writeText(String(text || '')); return { ok: true }; });
ipcMain.handle('update:check', () => checkUpdate());
ipcMain.handle('ad:get-sidebar', () => getSidebarAd());
ipcMain.handle('app:get-state', async () => readJson(APP_STATE_PATH, {}));
ipcMain.handle('app:set-state', async (_e, state) => {
  await writeJson(APP_STATE_PATH, { ...(state || {}), savedAt: new Date().toISOString() });
  return { ok: true };
});
ipcMain.handle('image:fetch-first', (_e, urls) => fetchFirstImageAsDataUrl(urls));

ipcMain.handle('auth:status', async () => {
  const cookieString = await getCookieString();
  const user = parseCookieUser(cookieString);
  return { loggedIn: Boolean(cookieString && user.uid), user };
});

ipcMain.handle('auth:open-login', async () => {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }
  loginWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    title: '登录 FansOne',
    webPreferences: {
      partition: LOGIN_PARTITION,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  loginWindow.on('closed', () => { loginWindow = null; mainWindow?.webContents?.send('auth-changed'); });
  loginWindow.webContents.on('did-navigate', async (_event, url) => {
    if (/fansone\.co\/(explore|home|subscription|creator|post)/.test(url)) {
      mainWindow?.webContents?.send('auth-changed');
    }
  });
  await loginWindow.loadURL(`${BASE_URL}/login`);
});

ipcMain.handle('auth:logout', async () => {
  const ses = getFansoneSession();
  await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'] });
  return { ok: true };
});

ipcMain.handle('fansone:get-subscriptions', async (_e, params) => getSubscriptions(params));
ipcMain.handle('fansone:get-posts', async (_e, params) => getPosts(params));
ipcMain.handle('download:add-posts', async (_e, posts) => downloadManager.addPosts(posts));
ipcMain.handle('download:list-jobs', async () => downloadManager.listJobs());
ipcMain.handle('download:cancel', async (_e, jobId) => downloadManager.cancel(jobId));
ipcMain.handle('download:pause', async () => downloadManager.pause());
ipcMain.handle('download:resume', async () => downloadManager.resume());
ipcMain.handle('download:retry-failed', async () => downloadManager.retryFailed());
ipcMain.handle('download:clear-records', async () => downloadManager.clearRecords());

import path from 'node:path';
import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export function attributes(text) {
  const result = {};
  const pattern = /(?:^|,)\s*([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  for (const match of text.matchAll(pattern)) result[match[1]] = match[2].replace(/^"|"$/g, '');
  return result;
}

function mediaUrl(base, value) {
  const result = new URL(value, base);
  if (!['https:', 'http:'].includes(result.protocol)) throw new Error('播放清单包含不支持的资源地址。');
  return result.href;
}

export function parsePlaylist(content, baseUrl) {
  const lines = String(content).replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new Error('服务器没有返回有效的 HLS 播放清单。');
  const result = { variants: [], renditions: [], segments: [], initUrl: null, duration: 0, sequence: 0, endList: false };
  let variant = null;
  let sawSegment = false;
  for (const line of lines.slice(1)) {
    if (line.startsWith('#EXT-X-KEY:') || line.startsWith('#EXT-X-SESSION-KEY:')) {
      const a = attributes(line.slice(line.indexOf(':') + 1));
      if (a.METHOD !== 'NONE') throw new Error('检测到加密/DRM HLS，已停止，不会尝试解密或绕过保护。');
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      if (variant) throw new Error('播放清单缺少清晰度资源地址。');
      variant = attributes(line.slice(18));
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const a = attributes(line.slice(13));
      result.renditions.push({ ...a, url: a.URI ? mediaUrl(baseUrl, a.URI) : null });
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const a = attributes(line.slice(11));
      if (!a.URI || a.BYTERANGE) throw new Error('暂不支持缺失 URI 或使用 BYTERANGE 的初始化段，未生成成品。');
      const url = mediaUrl(baseUrl, a.URI);
      if (sawSegment || (result.initUrl && result.initUrl !== url)) throw new Error('暂不支持中途切换初始化段的清单，未生成成品。');
      result.initUrl = url;
    } else if (line.startsWith('#EXT-X-BYTERANGE:') || line === '#EXT-X-DISCONTINUITY') {
      throw new Error('暂不支持 BYTERANGE 或 DISCONTINUITY 清单，未生成成品。');
    } else if (line.startsWith('#EXTINF:')) {
      const duration = Number.parseFloat(line.slice(8));
      if (!Number.isFinite(duration) || duration < 0) throw new Error('播放清单的分片时长无效。');
      result.duration += duration;
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      result.sequence = Number(line.slice(22));
    } else if (line === '#EXT-X-ENDLIST') {
      result.endList = true;
    } else if (!line.startsWith('#')) {
      if (variant) {
        result.variants.push({ ...variant, url: mediaUrl(baseUrl, line) });
        variant = null;
      } else {
        result.segments.push(mediaUrl(baseUrl, line));
        sawSegment = true;
      }
    }
  }
  if (variant) throw new Error('播放清单缺少清晰度资源地址。');
  if (result.variants.length && result.segments.length) throw new Error('播放清单同时包含主清单与媒体分片，已停止。');
  return result;
}

export async function resolveSources(url, fetchText, depth = 0, seen = new Set()) {
  if (depth > 4 || seen.has(url)) throw new Error('播放清单嵌套过深或出现循环。');
  const nextSeen = new Set(seen).add(url);
  const parsed = parsePlaylist(await fetchText(url), url);
  if (parsed.variants.length) {
    const variant = [...parsed.variants].sort((a, b) => (Number(b.BANDWIDTH) || 0) - (Number(a.BANDWIDTH) || 0))[0];
    const selected = await resolveSources(variant.url, fetchText, depth + 1, nextSeen);
    if (variant.AUDIO) {
      const candidates = parsed.renditions.filter(a => a.TYPE === 'AUDIO' && a['GROUP-ID'] === variant.AUDIO);
      if (!candidates.length) throw new Error('主清单指定的独立音轨不存在。');
      const audio = candidates.find(a => a.DEFAULT === 'YES') || candidates.find(a => a.AUTOSELECT === 'YES') || candidates[0];
      if (audio.url) {
        const resolved = await resolveSources(audio.url, fetchText, depth + 1, nextSeen);
        if (resolved.audio) throw new Error('音轨清单结构不受支持。');
        selected.audio = resolved.video;
      }
    }
    return selected;
  }
  if (!parsed.segments.length) throw new Error('没有找到视频分片。');
  if (!parsed.endList) throw new Error('这是直播或尚未结束的清单，不能标记为完整下载。');
  return { video: { ...parsed, playlistUrl: url }, audio: null };
}

export function trackCacheId(track) {
  // Persist only a hash, never signed URLs. Normalize only known Bunny/FansOne
  // authentication fields; keep all other path prefixes and query parameters.
  const address = value => {
    const url = new URL(value);
    if (url.hostname === 'fansone.co' || url.hostname.endsWith('.fansone.co')) {
      url.pathname = url.pathname.replace(/^\/bcdn_token=[^/]+(?=\/)/, '');
      for (const key of ['token', 'expires', 'bcdn_token', 'token_path']) url.searchParams.delete(key);
    }
    return url.href;
  };
  return createHash('sha256').update(JSON.stringify({
    sequence: track.sequence, duration: track.duration,
    init: track.initUrl ? address(track.initUrl) : null,
    segments: track.segments.map(address)
  })).digest('hex').slice(0, 24);
}

export function runProcess(executable, args, { signal, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', settled = false, terminationError = null;
    let timer = null, killTimer = null;
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result);
    };
    const stop = error => {
      if (settled || terminationError) return;
      terminationError = error;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      // Resolve/reject only on close: callers can then safely clean temporary files.
    };
    const abort = () => stop(Object.assign(new Error('操作已中止'), { name: 'AbortError' }));
    if (timeout) timer = setTimeout(() => stop(new Error('工具响应超时')), timeout);
    child.stdout.on('data', b => { stdout = (stdout + b).slice(-65536); });
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-16384); });
    child.on('error', err => finish(err));
    child.on('close', code => finish(terminationError, { code, stdout, stderr }));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function findFfmpeg(bundledPath, { platform = process.platform, run = runProcess } = {}) {
  const candidates = [...new Set([
    bundledPath,
    ...(platform === 'darwin' ? ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'] : []),
    platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  ].filter(Boolean))];
  for (const candidate of candidates) {
    try { if ((await run(candidate, ['-version'], { timeout: 5000 })).code === 0) return candidate; } catch {}
  }
  throw new Error('没有找到适用于本机的 ffmpeg，已停止。现有视频和分片缓存均已保留。');
}

export async function joinFiles(files, destination, { signal } = {}) {
  signal?.throwIfAborted();
  const output = await fs.open(destination, 'wx');
  try {
    for (const file of files) {
      signal?.throwIfAborted();
      for await (const chunk of createReadStream(file)) {
        let offset = 0;
        while (offset < chunk.length) {
          signal?.throwIfAborted();
          const { bytesWritten } = await output.write(chunk, offset, chunk.length - offset);
          if (!bytesWritten) throw new Error('写入媒体文件失败。');
          offset += bytesWritten;
        }
      }
    }
    await output.sync();
  } finally {
    await output.close();
  }
}

export async function validateMedia(ffmpeg, file, { requireAudio = false, videoDuration = 0, audioDuration = 0, signal } = {}) {
  const map = ['-map', '0:v:0', '-map', requireAudio ? '0:a:0' : '0:a?'];
  const result = await runProcess(ffmpeg, ['-hide_banner', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', file, ...map, '-f', 'null', '-'], { signal });
  if (result.code !== 0) throw new Error(`媒体校验失败：${result.stderr || '无法读取音视频轨道'}`);
  // ffprobe is optional for installations that only bundle ffmpeg. When present,
  // also reject silent/truncated outputs relative to the source playlists.
  const ffprobe = path.isAbsolute(ffmpeg) ? path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : 'ffprobe';
  let probe;
  try { probe = await runProcess(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,duration:format=duration', '-of', 'json', file], { signal, timeout: 15000 }); }
  catch (error) { if (error.name === 'AbortError') throw error; return; }
  if (probe.code !== 0) throw new Error('ffprobe 无法读取输出文件。');
  const data = JSON.parse(probe.stdout);
  for (const [kind, expected] of [['video', videoDuration], ['audio', requireAudio ? audioDuration : 0]]) {
    if (!expected) continue;
    const stream = data.streams.find(s => s.codec_type === kind);
    const duration = Number(stream?.duration || (kind === 'video' ? data.format?.duration : 0));
    if (!stream || !Number.isFinite(duration) || Math.abs(duration - expected) > Math.max(1, expected * 0.005)) throw new Error(`${kind === 'audio' ? '音轨' : '视频'}时长与来源不符，未标记为完成。`);
  }
}

export async function muxTracks(ffmpeg, videoFile, audioFile, candidate, expectations = {}) {
  const reserved = await fs.open(candidate, 'wx');
  await reserved.close();
  const args = ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-i', videoFile];
  if (audioFile) args.push('-i', audioFile);
  args.push('-map', '0:v:0', '-map', audioFile ? '1:a:0' : '0:a?', '-c', 'copy', '-movflags', '+faststart', candidate);
  const result = await runProcess(ffmpeg, args, { signal: expectations.signal });
  if (result.code !== 0) throw new Error(`ffmpeg 封装失败，缓存已保留：${result.stderr}`);
  await validateMedia(ffmpeg, candidate, { ...expectations, requireAudio: Boolean(audioFile) });
}

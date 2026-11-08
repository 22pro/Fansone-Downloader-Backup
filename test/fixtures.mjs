import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findFfmpeg, parsePlaylist, runProcess } from '../src/hls-media.js';

export async function testFfmpeg() {
  // Integration tests require the system FFmpeg tools, including ffprobe.
  const ffmpeg = await findFfmpeg(process.env.FFMPEG_PATH || 'ffmpeg');
  const ffprobe = path.isAbsolute(ffmpeg)
    ? path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    : 'ffprobe';
  let probe;
  try { probe = await runProcess(ffprobe, ['-version'], { timeout: 5000 }); }
  catch { throw new Error('Integration tests require ffmpeg and ffprobe on PATH, or FFMPEG_PATH pointing to ffmpeg beside ffprobe.'); }
  assert.equal(probe.code, 0, 'Integration tests require a working ffprobe.');
  return ffmpeg;
}

// All test media is generated locally. No account, downloaded media, or network is used.
export async function syntheticHls() {
  const ffmpeg = await testFfmpeg();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fansone-fixtures-'));
  const urls = new Map();
  const manifests = new Map();
  let totalBytes = 0;
  try {
    for (const [kind, input] of [
      ['video', ['-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=24', '-t', '3', '-an', '-c:v', 'libx264', '-g', '24']],
      ['audio', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3', '-vn', '-c:a', 'aac']]
    ]) {
      const target = path.join(dir, kind);
      await fs.mkdir(target);
      const result = await runProcess(ffmpeg, [
        '-v', 'error', ...input, '-f', 'hls', '-hls_time', '1',
        '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
        '-hls_fmp4_init_filename', 'init.mp4',
        '-hls_segment_filename', path.join(target, '%d.m4s'), path.join(target, 'index.m3u8')
      ]);
      assert.equal(result.code, 0, result.stderr);
      const address = `https://fixture.invalid/${kind}/index.m3u8`;
      const text = await fs.readFile(path.join(target, 'index.m3u8'), 'utf8');
      manifests.set(address, text);
      const playlist = parsePlaylist(text, address);
      for (const url of [playlist.initUrl, ...playlist.segments]) {
        const buffer = await fs.readFile(path.join(target, path.basename(new URL(url).pathname)));
        urls.set(url, buffer);
        totalBytes += buffer.length;
      }
    }
    manifests.set('https://fixture.invalid/master.m3u8',
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="main",DEFAULT=YES,URI="audio/index.m3u8"\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,AUDIO="aac"\nvideo/index.m3u8\n');
    return { ffmpeg, urls, manifests, totalBytes, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
}

import test from 'node:test';
import { testFfmpeg } from './fixtures.mjs';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePlaylist, resolveSources, attributes, trackCacheId, findFfmpeg, joinFiles, runProcess, muxTracks, validateMedia } from '../src/hls-media.js';
const base='https://fixture.fansone.co/bcdn_token=abc&expires=100/id/';
const media=(file='seg.m4s',init=true)=>`#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:4\n${init?'#EXT-X-MAP:URI="init.mp4"\n':''}#EXTINF:6,\n${file}\n#EXT-X-ENDLIST\n`;

test('parse quoted CODECS commas and HLS init against media playlist URL',()=>{
 assert.equal(attributes('BANDWIDTH=100,CODECS="avc1,mp4a",AUDIO="main"').CODECS,'avc1,mp4a');
 const p=parsePlaylist(media(),base+'1080p/video.m3u8');
 assert.equal(p.initUrl,base+'1080p/init.mp4');assert.equal(p.segments[0],base+'1080p/seg.m4s');assert.equal(p.sequence,4);assert.equal(p.duration,6);
});
test('resolve highest rendition plus matching default independent audio',async()=>{
 const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="sound",NAME="main",DEFAULT=YES,URI="audio/audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,CODECS="avc1,mp4a",AUDIO="sound"\n1080p/video.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n720p/video.m3u8\n';
 const seen=[];const r=await resolveSources(base+'master.m3u8',async u=>{seen.push(u);return u.endsWith('master.m3u8')?master:media();});
 assert.ok(r.video.playlistUrl.includes('/1080p/'));assert.ok(r.audio.playlistUrl.includes('/audio/'));assert.equal(seen.length,3);
});
test('MPEG TS needs no initialization; embedded audio group is allowed',async()=>{
 const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="embedded",DEFAULT=YES\n#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="audio"\nvideo.m3u8';
 const p=await resolveSources(base+'master',async u=>u.endsWith('/master')?master:media('seg.ts',false));assert.equal(p.video.initUrl,null);assert.equal(p.audio,null);
});
for(const key of ['#EXT-X-KEY:METHOD=AES-128,URI="key"','#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"','#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="key"']){
 test('reject encrypted content '+key.split(':')[0],()=>assert.throws(()=>parsePlaylist('#EXTM3U\n'+key+'\nseg.ts\n#EXT-X-ENDLIST',base),/加密/));
}
test('accept METHOD=NONE but reject HTML/live/cycle/unsupported ranges',async()=>{
 assert.equal(parsePlaylist(media().replace('#EXTM3U','#EXTM3U\n#EXT-X-KEY:METHOD=NONE'),base).segments.length,1);
 assert.throws(()=>parsePlaylist('<html>denied</html>',base),/有效/);
 await assert.rejects(resolveSources(base,async()=>media().replace('#EXT-X-ENDLIST','')),/直播/);
 await assert.rejects(resolveSources(base+'self',async()=>'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nself'),/循环/);
 assert.throws(()=>parsePlaylist(media().replace('#EXTINF:6,','#EXT-X-BYTERANGE:10@0\n#EXTINF:6,'),base),/BYTERANGE/);
 assert.throws(()=>parsePlaylist(media().replace('seg.m4s','file:///etc/passwd'),base),/不支持/);
});
test('distinct full paths and query-selected assets never share a cache',()=>{
 const t=url=>({segments:[url],initUrl:null,sequence:0,duration:6});
 assert.notEqual(trackCacheId(t('https://x/one/a/b/c.ts')),trackCacheId(t('https://x/two/a/b/c.ts')));
 assert.notEqual(trackCacheId(t('https://x/seg?id=A')),trackCacheId(t('https://x/seg?id=B')));
 assert.equal(trackCacheId(t(base+'1080p/seg.m4s')),trackCacheId(t(base.replace('abc&expires=100','xyz&expires=200')+'1080p/seg.m4s')));
});
test('ffmpeg tries mac fallback after incompatible bundled executable',async()=>{
 const seen=[];const r=await findFfmpeg('/linux/ffmpeg',{platform:'darwin',run:async p=>{seen.push(p);if(p.startsWith('/linux'))throw Error('Exec format');return{code:0};}});assert.equal(r,'/opt/homebrew/bin/ffmpeg');assert.equal(seen.length,2);
 await assert.rejects(findFfmpeg('/broken',{platform:'darwin',run:async()=>({code:1})}),/没有找到/);
});
test('join uses exclusive output and fails quickly on EEXIST; supports abort',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fansone-join-'));try{
  await fs.writeFile(path.join(dir,'a'),'A');await fs.writeFile(path.join(dir,'b'),'B');await joinFiles([path.join(dir,'a'),path.join(dir,'b')],path.join(dir,'out'));assert.equal(await fs.readFile(path.join(dir,'out'),'utf8'),'AB');
  await assert.rejects(joinFiles([path.join(dir,'a')],path.join(dir,'out')),e=>e.code==='EEXIST');
  const c=new AbortController();c.abort();await assert.rejects(joinFiles([path.join(dir,'a')],path.join(dir,'abort'),{signal:c.signal}));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('abort waits for child exit even when SIGTERM is ignored',async()=>{
 const c=new AbortController();const start=Date.now();const p=runProcess(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{signal:c.signal});setTimeout(()=>c.abort(),200);await assert.rejects(p,e=>e.name==='AbortError');assert.ok(Date.now()-start>=1900);
});
test('real FFmpeg fMP4 init + independent AAC produces complete A/V; missing init and audio fail',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fansone-mux-'));const ff=await testFfmpeg();
 try{
  for(const [name,args] of [['video',['-f','lavfi','-i','testsrc2=size=64x64:rate=24','-t','2','-an','-c:v','libx264']],['audio',['-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','2','-vn','-c:a','aac']]]){
   const result=await runProcess(ff,['-v','error',...args,'-f','hls','-hls_time','1','-hls_playlist_type','vod','-hls_segment_type','fmp4','-hls_fmp4_init_filename',name+'-init.mp4','-hls_segment_filename',path.join(dir,name+'-%d.m4s'),path.join(dir,name+'.m3u8')]);assert.equal(result.code,0,result.stderr);
   const p=parsePlaylist(await fs.readFile(path.join(dir,name+'.m3u8'),'utf8'),'http://localhost/'+name+'.m3u8');await joinFiles([path.join(dir,name+'-init.mp4'),...p.segments.map(u=>path.join(dir,new URL(u).pathname.slice(1)))],path.join(dir,name+'-joined.mp4'));
  }
  const out=path.join(dir,'out.mp4');await muxTracks(ff,path.join(dir,'video-joined.mp4'),path.join(dir,'audio-joined.mp4'),out,{videoDuration:2,audioDuration:2});
  assert.equal((await runProcess(ff,['-v','error','-xerror','-i',out,'-f','null','-'])).code,0);
  await assert.rejects(validateMedia(ff,path.join(dir,'video-joined.mp4'),{requireAudio:true}));
  await assert.rejects(validateMedia(ff,path.join(dir,'video-0.m4s')));
  await assert.rejects(validateMedia(ff,out,{videoDuration:20}),/时长/);
  await assert.rejects(muxTracks(ff,path.join(dir,'video-joined.mp4'),path.join(dir,'audio-joined.mp4'),out));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

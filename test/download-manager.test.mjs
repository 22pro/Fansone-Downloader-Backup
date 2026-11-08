import test, { before, after } from 'node:test';
import { syntheticHls } from './fixtures.mjs';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import PQueue from 'p-queue';
import * as hls from '../src/hls-media.js';
const source=await fs.readFile(new URL('../src/main.js',import.meta.url),'utf8');
const classText=source.slice(source.indexOf('class DownloadManager'),source.indexOf('\nfunction createSplashWindow'));
const exists=async p=>{try{return(await fs.stat(p)).size>0;}catch{return false;}};
const size=async p=>{try{return(await fs.stat(p)).size;}catch{return 0;}};
let fixture;
let urls;
let manifests;
before(async () => {
 fixture = await syntheticHls();
 ({ urls, manifests } = fixture);
});
after(async () => { await fixture?.cleanup(); });
async function harness(customDownload){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fansone-manager-'));let calls=0;
 const realDownload=async(url,target,{signal}={})=>{signal?.throwIfAborted();if(await exists(target))return;await fs.mkdir(path.dirname(target),{recursive:true});const input=urls.get(url);assert.ok(input);if(typeof input==='string')await fs.link(input,target);else await fs.writeFile(target,input,{flag:'wx'});};
 const context={path,fs,PQueue,...hls,BASE_URL:'https://fansone.co',readConfig:async()=>({downloadDir:dir,concurrency:4}),userDirName:()=> 'fixture',postFileBaseName:()=> 'video',ensureDir:p=>fs.mkdir(p,{recursive:true}),fileExistsNonEmpty:exists,fileSize:size,resolveBundledFfmpegPath:()=>fixture.ffmpeg,getPostVideoPlaylist:()=>hls.resolveSources('https://fixture.invalid/master.m3u8',async u=>manifests.get(u)),downloadConcurrency:n=>n,updateJobTransfer:(j,p)=>Object.assign(j,p),resumeDownloadToFile:async(...args)=>{calls++;return customDownload?customDownload(realDownload,...args):realDownload(...args);},shouldApplyFreeSpeedLimit:()=>false,httpStatusCode:e=>Number(e?.response?.statusCode||0),sleep:ms=>new Promise(r=>setTimeout(r,ms)),DownloadPausedError:class DownloadPausedError extends Error{}};
 const Manager=new Function(...Object.keys(context),`return (${classText});`)(...Object.values(context));const m=new Manager(null);m.saveState=async()=>{};
 return {dir,m,post:{id:42,type:'VIDEO',video:'fixture',title:'fixture'},calls:()=>calls,clean:()=>fs.rm(dir,{recursive:true,force:true})};
}

test('real complete download-manager flow: external audio, init, existing TS preserved, repeat safely skips',async()=>{
 const h=await harness();try{
  const original=path.join(h.dir,'fixture/videos/video.ts');await fs.mkdir(path.dirname(original),{recursive:true});await fs.writeFile(original,'original sentinel');
  const [id]=h.m.addPosts([h.post]);await h.m.queue.onIdle();const job=h.m.jobs.get(id);assert.equal(job.status,'done',job.error);assert.equal(job.mediaValidationVersion,2);assert.equal(job.downloadedBytes,fixture.totalBytes);assert.ok(job.outputPath.endsWith('video.mp4'));assert.equal(await fs.readFile(original,'utf8'),'original sentinel');
  assert.equal((await hls.runProcess(fixture.ffmpeg,['-v','error','-xerror','-i',job.outputPath,'-f','null','-'])).code,0);
  const oldCalls=h.calls();const [id2]=h.m.addPosts([h.post]);assert.notEqual(id,id2);await h.m.queue.onIdle();assert.equal(h.m.jobs.get(id2).status,'done');assert.equal(h.calls(),oldCalls);
 }finally{await h.clean();}
});

test('invalid existing MP4 is preserved and output gets a separate repaired filename',async()=>{
 const h=await harness();try{
  const old=path.join(h.dir,'fixture/videos/video.mp4');await fs.mkdir(path.dirname(old),{recursive:true});await fs.writeFile(old,'invalid original');
  const [id]=h.m.addPosts([h.post]);await h.m.queue.onIdle();const j=h.m.jobs.get(id);assert.equal(j.status,'done',j.error);assert.match(j.outputPath,/\.repaired-/);assert.equal(await fs.readFile(old,'utf8'),'invalid original');
 }finally{await h.clean();}
});

test('403 is a visible failure, not retried and not reported as a playable TS',async()=>{
 let denied=0;const h=await harness(async()=>{denied++;throw Object.assign(new Error('Forbidden'),{response:{statusCode:403}});});try{
  const[id]=h.m.addPosts([h.post]);await h.m.queue.onIdle();const j=h.m.jobs.get(id);assert.equal(j.status,'error');assert.match(j.error,/403/);assert.ok(denied<=4);assert.equal(await exists(path.join(h.dir,'fixture/videos/video.mp4')),false);
 }finally{await h.clean();}
});

test('pause aborts active downloads, keeps completed cache and resumes the same task',async()=>{
 let releaseEntered;const entered=new Promise(r=>releaseEntered=r);let pausedOnce=false;
 const h=await harness(async(real,url,target,options)=>{
  if(!pausedOnce&&url.endsWith('/0.m4s')){releaseEntered();await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true});});}
  return real(url,target,options);
 });try{
  const[id]=h.m.addPosts([h.post]);await entered;h.m.pause();await h.m.queue.onIdle();assert.equal(h.m.jobs.get(id).status,'paused');
  pausedOnce=true;h.m.resume();await h.m.queue.onIdle();assert.equal(h.m.jobs.get(id).status,'done',h.m.jobs.get(id).error);
 }finally{await h.clean();}
});

test('clearing records stops all downloads without retries or final output',async()=>{
 let releaseEntered;const entered=new Promise(r=>releaseEntered=r);let calls=0;
 const h=await harness(async(real,url,target,options)=>{calls++;releaseEntered();await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}));});
 try{h.m.addPosts([h.post]);await entered;h.m.clearRecords();await h.m.queue.onIdle();assert.equal(h.m.jobs.size,0);assert.ok(calls<=4);assert.throws(()=>h.m._ensureRunnable('missing'),/移除/);assert.equal(await exists(path.join(h.dir,'fixture/videos/video.mp4')),false);}finally{await h.clean();}
});

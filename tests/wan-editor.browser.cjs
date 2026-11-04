'use strict';
/** Real Chromium + actual PHP panel/JS/CSS, simulated local AJAX only.
 * This is NOT evidence of a real Wan generation or configured staging backend.
 */
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const {execFileSync}=require('node:child_process');const {chromium}=require('playwright');
const ROOT=path.join(__dirname,'..');
(async()=>{
 const out=process.env.PPG_WAN_RESULTS;if(!out)throw Error('PPG_WAN_RESULTS is required outside the repository');fs.mkdirSync(out,{recursive:true});
 const clip=path.join(out,'synthetic-fixture.mp4');
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=gray:s=320x180:d=5','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',clip]);
 const html=execFileSync('php',[path.join(__dirname,'wan-editor-fixture.php')],{encoding:'utf8'});
 let generates=0,submits=0;const checks=[];const pass=n=>{checks.push(n);console.log('PASS:',n);};
 const server=http.createServer((req,res)=>{
  if(req.url==='/fixture.mp4'){res.setHeader('Content-Type','video/mp4');res.end(fs.readFileSync(clip));return;}
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(['/assets/setup-ai-admin.js','/assets/setup.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(ROOT,req.url)));return;}
  if(req.url==='/wp-admin/admin-ajax.php'&&req.method==='POST'){
   let text='';req.on('data',x=>{text+=x;if(text.length>65536)req.destroy();});req.on('end',()=>{
    const f=new URLSearchParams(text);res.setHeader('Content-Type','application/json');
    if(f.get('action')==='ppg_setup_ai_generate'){
     generates++;assert.equal(f.get('first_frame_id'),'13');assert.equal(f.get('last_frame_id'),'14');assert.equal(f.get('consent'),'1');
     res.end(JSON.stringify({success:true,data:{job_id:'job_0123456789abcdef',status:'processing',message:'Offline fixture rendering.'}}));
    }else res.end(JSON.stringify({success:true,data:generates?{job_id:'job_0123456789abcdef',status:'succeeded',attachment_id:777,url:'/fixture.mp4'}:{status:'idle'}}));
   });return;
  }
  res.statusCode=404;res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.PPG_CHROMIUM||'/home/byron/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('.ppg-setup-ai-generate').disabled);
  await page.evaluate(()=>document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.fixtureSubmits=(window.fixtureSubmits||0)+1;}));
  assert.equal(generates,0);pass('actual PHP editor boots and recovers without purchasing a render');
  await page.locator('.ppg-setup-ai-generate').click();assert.match(await page.locator('.ppg-setup-ai-error').innerText(),/paid/i);assert.equal(generates,0);pass('missing consent visibly blocks generation');
  await page.locator('#ppg_setup_ai_first_frame').selectOption('13');await page.locator('#ppg_setup_ai_last_frame').selectOption('14');
  await page.locator('#ppg_setup_ai_prompt').fill('Open the table slowly, keeping the camera fixed.');await page.locator('#ppg_setup_ai_consent').check();
  await page.locator('.ppg-setup-ai-generate').click();await page.locator('.ppg-setup-ai-result:not([hidden])').waitFor();
  assert.equal(generates,1);assert.equal(await page.locator('#ppg_setup_video_id').inputValue(),'0');assert.equal(await page.locator('#ppg_setup_mode').inputValue(),'pictures');assert.equal(await page.locator('#ppg_setup_ai_consent').isChecked(),false);
  pass('manual third/fourth-frame choices submit once and completed fixture does not select itself');
  await page.waitForFunction(()=>document.querySelector('.ppg-setup-ai-video').readyState>=1);
  await page.locator('.ppg-setup-ai-video').evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('.ppg-setup-ai-video').currentTime>.2);await page.locator('.ppg-setup-ai-video').evaluate(v=>v.pause());pass('actual Chromium plays the explicitly synthetic offline fixture');
  await page.screenshot({path:path.join(out,'wan-editor-desktop.png'),fullPage:true});
  await page.locator('.ppg-setup-ai-use-video').click();assert.equal(await page.locator('#ppg_setup_video_id').inputValue(),'777');assert.equal(await page.locator('#ppg_setup_mode').inputValue(),'video');
  assert.equal(await page.evaluate(()=>window.fixtureSubmits||0),0);pass('only explicit Use this video stages the selection, without submitting the form');
  await page.setViewportSize({width:390,height:844});await page.locator('.ppg-setup-ai').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'wan-editor-mobile.png'),fullPage:true});
  const overflow=await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})));fs.writeFileSync(path.join(out,'overflow.json'),JSON.stringify(overflow,null,2));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);pass('configured fixture fits phone width');
  assert.deepEqual(errors,[]);pass('no JavaScript exceptions in actual Chromium');
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({kind:'offline PHP/Chromium fixture; simulated AJAX; no Wan execution',checks,generates},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});

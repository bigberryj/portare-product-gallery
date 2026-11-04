'use strict';
// Read-only real staging UI verification: never Generate, Use, Update or health.
const {chromium}=require('playwright');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const ORIGIN='https://portare.up.railway.app';
(async()=>{
 const out=process.env.PPG_WAN_RESULTS;if(!out||!process.env.PPG_COOKIE_FILE)throw Error('Private output/cookie files required');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.PPG_CHROMIUM||'/home/byron/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 const checks=[];const pass=n=>{checks.push(n);console.log('PASS:',n);};
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1100}});await context.addCookies(JSON.parse(fs.readFileSync(process.env.PPG_COOKIE_FILE,'utf8')));
  const page=await context.newPage();const errors=[];let paidRequests=0;
  page.on('pageerror',e=>errors.push(e.stack||e.message));
  // Independently prevent accidental paid submission even if a UI regresses.
  await page.route('**/wp-admin/admin-ajax.php',route=>{
   const f=new URLSearchParams(route.request().postData()||'');
   if(f.get('action')==='ppg_setup_ai_generate'&&f.get('consent')==='1'){paidRequests++;return route.abort();}
   return route.continue();
  });
  await page.goto(ORIGIN+'/wp-admin/post.php?post=11012&action=edit',{waitUntil:'domcontentloaded',timeout:90000});assert(!page.url().includes('wp-login'));
  await page.locator('.product_data_tabs .ppg_options a').click();const panel=page.locator('.ppg-setup-ai');await panel.waitFor({state:'visible'});
  assert.equal(await panel.count(),1);pass('real authenticated product tab renders the Wan panel');
  const enabled=(await panel.getAttribute('data-ai-enabled'))==='1';
  assert.equal(enabled,false,'this reviewed staging check requires disabled generation');
  assert((await page.locator('.ppg-setup-ai-unavailable').innerText()).trim());
  assert.equal(await page.locator('.ppg-setup-ai-generate').count(),0);
  assert.equal(await page.locator('#ppg_setup_ai_consent').count(),0);
  pass('missing configuration visibly explains the gate and omits paid-render controls in the real web worker');
  const denied=await context.request.post(ORIGIN+'/wp-admin/admin-ajax.php',{form:{action:'ppg_setup_ai_generate',product_id:'11012',nonce:'invalid',consent:'1'}});assert.equal(denied.status(),403);pass('live generate endpoint rejects an invalid nonce before paid submission');
  await panel.scrollIntoViewIfNeeded();await panel.screenshot({path:path.join(out,'wan-staging-desktop.png')});await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();await page.waitForTimeout(600);await panel.screenshot({path:path.join(out,'wan-staging-mobile.png')});await page.screenshot({path:path.join(out,'wan-staging-mobile-full.png'),fullPage:true});
  assert.equal(await panel.evaluate(el=>{const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return top!==null&&el.contains(top);}),true,'mobile panel must be visibly painted, not covered by a resize overlay');
  const bounds=await panel.boundingBox();assert(bounds.x>=-1&&bounds.x+bounds.width<=391);pass('real WordPress Wan panel fits the phone viewport');
  const known=errors.filter(e=>e.includes('e.get is not a function')&&e.includes('/brizy-pro/public/editor-build/prod/js/preview.pro.min.js'));
  assert.deepEqual(errors.filter(e=>!known.includes(e)),[]);assert.equal(paidRequests,0);pass('no new JavaScript exceptions and no browser paid-generation attempts');
  fs.writeFileSync(path.join(out,'staging-results.json'),JSON.stringify({checks,enabled,knownBrizyBaselineCount:known.length,paidRequests,publicationWrites:0},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

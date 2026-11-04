/* Uses real WP-rendered snapshots and real staging media, never fabricated product responses.
   PPG_FILMSTRIP_SNAPSHOTS: private directory with gallery-before.html/gallery-after.html.
   PPG_CHROMIUM: installed Chromium executable. PPG_RESULTS: evidence output directory. */
const {chromium}=require('playwright');
const fs=require('fs');const path=require('path');const assert=require('node:assert/strict');
(async()=>{
 const snapshots=process.env.PPG_FILMSTRIP_SNAPSHOTS;
 if(!snapshots)throw Error('PPG_FILMSTRIP_SNAPSHOTS is required');
 const out=process.env.PPG_RESULTS||path.join(__dirname,'artifacts/filmstrip');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.PPG_CHROMIUM||undefined,headless:true,args:['--no-sandbox']});
 const results=[];
 try{
  for(const display of [{name:'desktop-retina',width:1440,height:1000,dpr:2},{name:'mobile-retina',width:390,height:844,dpr:3}]){
   const pair={display};
   for(const stage of ['before','after']){
    const context=await browser.newContext({viewport:{width:display.width,height:display.height},deviceScaleFactor:display.dpr});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const markup=fs.readFileSync(path.join(snapshots,'gallery-'+stage+'.html'),'utf8');
    await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main style="max-width:1200px;margin:24px auto;padding:0 16px">'+markup+'</main>',{waitUntil:'domcontentloaded'});
    await page.addStyleTag({path:path.join(__dirname,'../assets/gallery.css')});
    await page.addScriptTag({path:path.join(__dirname,'../assets/gallery.js')});
    await page.waitForSelector('.ppg-initialized');
    assert.equal(await page.locator('.ppg-thumb img').count(),6);
    const images=[];
    for(let i=0;i<6;i++){
     const image=page.locator('.ppg-thumb img').nth(i);await image.scrollIntoViewIfNeeded();
     await image.evaluate(async img=>{await img.decode();});
     const data=await image.evaluate(img=>{const r=img.getBoundingClientRect();return {src:img.currentSrc,width:r.width,height:r.height,srcset:img.srcset,sizes:img.sizes,loaded:img.naturalWidth>0,loading:img.loading,decoding:img.decoding};});
     const response=await context.request.get(data.src,{timeout:30000});assert.equal(response.status(),200);
     const buffer=await response.body();data.bytes=buffer.length;
     // Decode the fetched original bitmap without density correction from img.naturalWidth.
     const bitmap=await page.evaluate(async b64=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const b=await createImageBitmap(new Blob([bytes]));const size={width:b.width,height:b.height};b.close();return size;},buffer.toString('base64'));
     data.source=bitmap;
     if(stage==='after'){
      assert(data.srcset.includes('768w'),'responsive family includes larger sources');
      assert(!/-150x150\./.test(data.src),'no tiny square source selected');
      assert.equal(data.loading,'lazy');assert.equal(data.decoding,'async');
      assert(bitmap.width>=data.width*display.dpr*.9,'enough horizontal pixels for high-density display');
      assert(bitmap.height>=data.height*display.dpr*.9,'enough vertical pixels for cover crop');
     }
     images.push(data);
    }
    await page.locator('.ppg-thumb').first().scrollIntoViewIfNeeded();await page.locator('.ppg-next').click();
    await page.waitForFunction(()=>document.querySelector('.ppg-thumb[data-index="1"]').getAttribute('aria-pressed')==='true');
    await page.locator('.ppg-thumb').first().focus();await page.locator('.ppg-thumb').first().press('Home');
    await page.waitForFunction(()=>document.querySelector('.ppg-thumb[data-index="0"]').getAttribute('aria-pressed')==='true');
    await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
    await page.screenshot({path:path.join(out,display.name+'-'+stage+'.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    pair[stage]=images;
    await context.close();
   }
   for(let i=0;i<6;i++){
    assert(Math.abs(pair.before[i].width-pair.after[i].width)<1,'filmstrip width unchanged');
    assert(Math.abs(pair.before[i].height-pair.after[i].height)<1,'filmstrip height unchanged');
    assert(pair.after[i].source.width>pair.before[i].source.width,'source resolution increased');
   }
   console.log('PASS',display.name,'all six real image downloads, high-density cover resolution, identical frame sizes, navigation, zero JS errors');
   results.push(pair);
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});

const { chromium }=require('playwright');
const fs=require('fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.PPG_CHROMIUM || undefined,headless:true,args:['--no-sandbox']});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
  await context.addCookies(JSON.parse(fs.readFileSync(process.env.PPG_COOKIE_FILE,'utf8')));
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto('https://portare.up.railway.app/wp-admin/post.php?post=10440&action=edit',{waitUntil:'domcontentloaded',timeout:90000});
  if(response.status()!==200 || page.url().includes('wp-login'))throw Error('Admin access failed');
  await page.locator('.product_data_tabs .ppg_options a').click();
  const input=page.locator('#ppg_shortcode');
  const expected='[portare_product_gallery product_id="10440"]';
  if(await input.inputValue()!==expected)throw Error('Wrong shortcode');
  if(await input.getAttribute('readonly')===null || await input.getAttribute('name')!==null)throw Error('Shortcode must be read-only and unsaved');
  await page.locator('.ppg-copy-shortcode').click();
  await page.waitForFunction(()=>document.querySelector('.ppg-copy-status').textContent==='Shortcode copied.');
  if(await page.evaluate(()=>navigator.clipboard.readText())!==expected)throw Error('Clipboard contents differ');
  console.log('PASS real staging product panel, correct ID, readonly/no name, actual clipboard copy');
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('blocked'))}});document.execCommand=()=>false;});
  await page.locator('.ppg-copy-shortcode').click();
  await page.waitForFunction(()=>document.querySelector('.ppg-copy-status').textContent.includes('Could not copy automatically'));
  if(!await page.evaluate(()=>{const e=document.querySelector('#ppg_shortcode');return e.selectionStart===0&&e.selectionEnd===e.value.length&&!document.querySelector('.ppg-copy-shortcode').disabled;}))throw Error('Manual fallback failed');
  console.log('PASS clipboard denial gives visible manual-copy instructions, selects code, re-enables button');
  await page.evaluate(()=>{document.execCommand=()=>true;});
  await page.locator('.ppg-copy-shortcode').click();
  await page.waitForFunction(()=>document.querySelector('.ppg-copy-status').textContent==='Shortcode copied.');
  console.log('PASS selection-copy fallback branch');
  await page.setViewportSize({width:390,height:844});await input.scrollIntoViewIfNeeded();
  const fits=await page.evaluate(()=>{const e=document.querySelector('#ppg_shortcode').getBoundingClientRect();const p=document.querySelector('#ppg_product_panel').getBoundingClientRect();return e.width>0&&e.left>=p.left&&e.right<=p.right+1;});
  if(!fits)throw Error('Mobile shortcode overflow');
  if(process.env.PPG_SCREENSHOT) await page.screenshot({path:process.env.PPG_SCREENSHOT});
  if(errors.length)throw Error('Browser errors: '+errors.join(';'));
  console.log('PASS mobile field fits panel; no page JavaScript exceptions; no product Update submitted');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exit(1);});

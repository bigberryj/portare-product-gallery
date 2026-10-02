"""Real staging overlay and per-product toggle verification; restores QA state."""
import json,subprocess,base64,os
from pathlib import Path
from playwright.sync_api import sync_playwright
origin='https://portare.up.railway.app'
transport=['railway','ssh','--project','66d5f189-f54a-4c5e-b07a-3c551d4fa44a','--environment','production','--service','liveedge-web','--']
wpcommand=transport+['php','/usr/local/bin/wp','--path=/var/www/html','--allow-root','eval-file','/tmp/ppg-arrows-qa.php']
def wp(code):
 r=subprocess.run(transport+['cat > /tmp/ppg-arrows-qa.php'],input='<?php\n'+code,text=True,capture_output=True,timeout=90)
 if r.returncode:raise RuntimeError('QA helper upload failed')
 r=subprocess.run(wpcommand,capture_output=True,text=True,timeout=90)
 if r.returncode:raise RuntimeError('QA helper failed (sensitive output suppressed)')
 return r.stdout.strip()
snapshot=json.loads(wp('if(wp_get_environment_type()!=="staging"||home_url()!=="https://portare.up.railway.app")throw new RuntimeException("Target mismatch");echo wp_json_encode(["config"=>get_post_meta(10440,"_ppg_config",true),"slides"=>get_post_meta(10440,"_ppg_slides",true),"has_slides"=>metadata_exists("post",10440,"_ppg_slides"),"content"=>get_post_field("post_content",10440)]);'))
checks=[];expected_content=None
out=Path(__file__).resolve().parents[1]/'evidence/overlay-0.1.2';out.mkdir(exist_ok=True)
def check(ok,name):
 if not ok:raise AssertionError(name)
 checks.append(name);print('PASS:',name)
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/home/byron/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',headless=True,args=['--no-sandbox'])
  context=browser.new_context(viewport={'width':1600,'height':1000});context.add_cookies(json.loads(Path(os.environ['PPG_COOKIES']).read_text()))
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def frontend():
   page.goto(origin+'/product/the-portable-folding-kings-table/?ppg_overlay_qa=1',wait_until='domcontentloaded',timeout=90000)
   page.wait_for_selector('.ppg-initialized');page.locator('[data-ppg]').scroll_into_view_if_needed();page.wait_for_timeout(300)
  def editor():
   page.goto(origin+'/wp-admin/post.php?post=10440&action=edit',wait_until='domcontentloaded',timeout=90000)
   page.locator('.product_data_tabs .ppg_options a').click()
  frontend()
  check(page.locator('.ppg-toolbar').count()==0,'bottom toolbar removed')
  check(page.locator('.ppg-play').count()==0,'autoplay-off page has no play/pause button')
  check(page.locator('.ppg-stage .ppg-prev,.ppg-stage .ppg-next').count()==2,'main-image arrows are overlays inside image')
  check(page.locator('.ppg-thumbnail-nav .ppg-strip-prev,.ppg-thumbnail-nav .ppg-strip-next').count()==2,'thumbnail arrows overlay both strip sides')
  start=page.locator('.ppg-main-image').get_attribute('src');page.locator('.ppg-next').click();page.wait_for_function('(src)=>document.querySelector(".ppg-main-image").getAttribute("src")!==src',arg=start)
  check(page.locator('.ppg-thumb').nth(1).get_attribute('aria-pressed')=='true','main right arrow selects next photograph')
  page.locator('.ppg-prev').click();page.wait_for_function('(src)=>document.querySelector(".ppg-main-image").getAttribute("src")===src',arg=start)
  check(True,'main left arrow selects previous photograph')
  page.locator('.ppg-strip-next').click();page.wait_for_function('document.querySelector(".ppg-thumbnails").scrollLeft>0')
  check(page.locator('.ppg-main-image').get_attribute('src')==start,'strip arrow scrolls without changing main photograph')
  page.locator('.ppg-strip-prev').click();page.wait_for_function('document.querySelector(".ppg-thumbnails").scrollLeft<2')
  check(True,'strip left arrow returns to start')
  page.mouse.move(0,0);page.evaluate('document.activeElement.blur()');page.wait_for_timeout(250)
  opacity=page.locator('.ppg-next').evaluate('(e)=>Number(getComputedStyle(e).opacity)')
  check(0<opacity<1,'overlay arrows are semi-transparent at rest')
  page.locator('[data-ppg]').screenshot(path=str(out/'desktop.png'))
  page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(300)
  check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'mobile layout has no page overflow')
  check(page.locator('.ppg-next').evaluate('(e)=>e.getBoundingClientRect().width')>=44,'mobile arrows retain 44px touch targets')
  page.locator('.ppg-strip-next').click();page.wait_for_function('document.querySelector(".ppg-thumbnails").scrollLeft>0')
  check(True,'mobile thumbnail arrow scrolls strip')
  page.locator('[data-ppg]').screenshot(path=str(out/'mobile.png'))
  page.set_viewport_size({'width':1440,'height':1000})
  for main,thumb in [(False,True),(True,False),(False,False),(True,True)]:
   editor();page.locator('#ppg_main_arrows').set_checked(main);page.locator('#ppg_thumb_arrows').set_checked(thumb)
   with page.expect_navigation(wait_until='domcontentloaded',timeout=90000):page.locator('#publish').click()
   expected_content=json.loads(wp('echo wp_json_encode(get_post_field("post_content",10440));'))
   editor();check(page.locator('#ppg_main_arrows').is_checked()==main and page.locator('#ppg_thumb_arrows').is_checked()==thumb,f'product toggle save/reload main={main} thumbs={thumb}')
   frontend();check(page.locator('.ppg-prev').count()==int(main) and page.locator('.ppg-strip-prev').count()==int(thumb),f'frontend obeys independent toggles main={main} thumbs={thumb}')
  check(not errors,'no overlay/editor browser JavaScript exceptions')
  browser.close()
finally:
 snapshot['expected']=expected_content;encoded=base64.b64encode(json.dumps(snapshot).encode()).decode()
 wp('$s=json_decode(base64_decode("'+encoded+'"),true);update_post_meta(10440,"_ppg_config",$s["config"]);if($s["has_slides"])update_post_meta(10440,"_ppg_slides",wp_slash($s["slides"]));else delete_post_meta(10440,"_ppg_slides");$current=get_post_field("post_content",10440);if($s["expected"]!==null&&$current===$s["expected"]&&$current!==$s["content"])wp_update_post(wp_slash(["ID"=>10440,"post_content"=>$s["content"]]));echo "restored";')
(out/'results.json').write_text(json.dumps({'checks':checks,'origin':origin},indent=2))
print('PASS:',len(checks),'real staging overlay/editor checks')

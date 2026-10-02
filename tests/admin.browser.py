"""Authenticated local product-editor/browser smoke. Restores test metadata/content.
Dependencies: Python Playwright. Cookies must be supplied privately outside git.
"""
import json, os, subprocess, shlex
from pathlib import Path
from playwright.sync_api import sync_playwright
ORIGIN=os.environ.get('PPG_ORIGIN','http://100.96.13.84:8082')
COOKIES=os.environ.get('PPG_COOKIES','/home/byron/.hermes/cache/scratch/ppg-local-cookies.json')
WP=shlex.split(os.environ.get('PPG_WP','sudo -n docker exec liveedge-ols php /usr/local/bin/wp --path=/var/www/html --allow-root'))
def wp(code):
 if WP[0]=='railway':
  boundary=WP.index('--');transport=WP[:boundary+1]
  upload=subprocess.run(transport+['cat > /tmp/ppg-browser-helper.php'],input='<?php\n'+code,text=True,capture_output=True,timeout=90)
  if upload.returncode:raise RuntimeError('Staging QA helper upload failed')
  r=subprocess.run(WP+['eval-file','/tmp/ppg-browser-helper.php'],text=True,capture_output=True,timeout=90)
 else:r=subprocess.run(WP+['eval',code],text=True,capture_output=True,timeout=90)
 if r.returncode: raise RuntimeError('WP-CLI QA helper failed (sensitive transport output suppressed)')
 return r.stdout.strip()
snapshot=json.loads(wp('echo wp_json_encode(["config"=>get_post_meta(10440,"_ppg_config",true),"slides"=>get_post_meta(10440,"_ppg_slides",true),"has_slides"=>metadata_exists("post",10440,"_ppg_slides"),"settings"=>get_option("ppg_settings",null),"content"=>get_post_field("post_content",10440)]);'))
identity=json.loads(wp('echo wp_json_encode(["environment"=>wp_get_environment_type(),"origin"=>home_url()]);'))
if identity['environment']!='staging' or identity['origin'].rstrip('/')!=ORIGIN.rstrip('/'):
 raise RuntimeError('QA target mismatch: expected isolated staging browser and WP-CLI origins to match')
checks=[]
contentAfterUpdate=None
def check(ok,name):
 if not ok: raise AssertionError(name)
 checks.append(name);print('PASS:',name)
try:
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path='/home/byron/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',headless=True,args=['--no-sandbox'])
  ctx=b.new_context(viewport={'width':1440,'height':1000});ctx.add_cookies(json.loads(Path(COOKIES).read_text()))
  if ORIGIN.startswith('http://100.'):
   def forward(route):
    if '/wp-json/wc-admin/' in route.request.url: route.abort();return
    try:route.fulfill(response=route.fetch(url=route.request.url.replace(ORIGIN,'http://172.19.0.2'),headers={**route.request.headers,'host':'100.96.13.84:8082'},max_redirects=0,timeout=120000))
    except Exception:route.abort()
   ctx.route(ORIGIN+'/**',forward)
  page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def edit():
   page.goto(ORIGIN+'/wp-admin/post.php?post=10440&action=edit',wait_until='domcontentloaded',timeout=90000)
   page.locator('.product_data_tabs .ppg_options a').click();page.wait_for_timeout(400)
  edit();rows=page.locator('.ppg-admin-rows>.ppg-admin-row');check(rows.count()==6,'product editor lists all six images')
  # Set real product controls and two rich paragraphs through TinyMCE.
  page.locator('select[name="ppg_config[text_side]"]').select_option('right')
  page.locator('select[name="ppg_config[quote_align]"]').select_option('center')
  page.locator('#ppg_autoplay').check();page.locator('#ppg_interval').fill('2.5')
  second=rows.nth(1);sid=second.get_attribute('data-id');editor_id=second.locator('textarea.ppg-rich').get_attribute('id')
  check(page.evaluate('(id)=>!!tinymce.get(id)',editor_id),'per-image rich text editor initialized')
  page.evaluate('(id)=>tinymce.get(id).setContent("<p>QA gallery paragraph one.</p><p><strong>QA paragraph two.</strong></p>")',editor_id)
  second.locator('.ppg-down').click();check(rows.nth(2).get_attribute('data-id')==sid,'move-down changes order')
  third=rows.nth(2);editor_id=third.locator('textarea.ppg-rich').get_attribute('id')
  check('QA gallery paragraph one' in page.evaluate('(id)=>tinymce.get(id).getContent()',editor_id),'rich text preserved through reorder')
  # Remove a nonfeatured image, then add that same media item back using real picker.
  removed=rows.last.get_attribute('data-id');rows.last.locator('.ppg-remove').click();check(rows.count()==5,'image association removed in editor')
  page.locator('.ppg-add-images').click();page.wait_for_selector('.media-modal',timeout=20000)
  media=page.locator('.media-modal .attachment[data-id="'+removed+'"]')
  if not media.count():
   title=json.loads(wp('echo wp_json_encode(get_post('+removed+')->post_title);'))
   page.locator('.media-modal #media-search-input').fill(title)
  media.wait_for(state='visible',timeout=30000);media.click();page.locator('.media-modal .media-button-select').click()
  check(rows.count()==6 and rows.last.get_attribute('data-id')==removed,'media picker appends removed association')
  with page.expect_navigation(wait_until='domcontentloaded',timeout=90000): page.locator('#publish').click()
  page.wait_for_timeout(500)
  contentAfterUpdate=json.loads(wp('echo wp_json_encode(get_post_field("post_content",10440));'))
  edit();rows=page.locator('.ppg-admin-rows>.ppg-admin-row')
  check(page.locator('select[name="ppg_config[text_side]"]').input_value()=='right','text side survives normal product Update')
  check(page.locator('select[name="ppg_config[quote_align]"]').input_value()=='center','quote alignment survives Update')
  check(page.locator('#ppg_autoplay').is_checked() and page.locator('#ppg_interval').input_value()=='2.5','autoplay and speed survive Update')
  row=page.locator('.ppg-admin-rows>.ppg-admin-row[data-id="'+sid+'"]');editor_id=row.locator('textarea.ppg-rich').get_attribute('id')
  check('QA paragraph two.' in page.evaluate('(id)=>tinymce.get(id).getContent()',editor_id),'both rich paragraphs survive Update/reload')
  check(rows.nth(2).get_attribute('data-id')==sid,'gallery order survives Update/reload')
  frontend=ctx.new_page();frontend.goto(ORIGIN+'/product/the-portable-folding-kings-table/?ppg_admin_qa=1',wait_until='domcontentloaded',timeout=90000);frontend.wait_for_selector('.ppg-initialized')
  check(frontend.locator('[data-ppg]').get_attribute('data-text-side')=='right','saved right-side setting applied on real page')
  metrics=frontend.evaluate('''()=>({copy:document.querySelector('.ppg-copy').getBoundingClientRect().left,media:document.querySelector('.ppg-stage').getBoundingClientRect().left})''')
  check(metrics['copy']>metrics['media'],'real page copy is to right of image')
  frontend.locator('.ppg-thumb').nth(2).click();frontend.wait_for_function('document.querySelector(".ppg-description").textContent.includes("QA paragraph two.")')
  check('QA gallery paragraph one.' in frontend.locator('.ppg-description').inner_text(),'per-image saved paragraphs replace main description')
  frontend.close()
  page.goto(ORIGIN+'/wp-admin/options-general.php?page=portare-product-gallery',wait_until='domcontentloaded',timeout=90000)
  page.locator('input[name="ppg_settings[text_size]"]').fill('18');page.locator('select[name="ppg_settings[font]"]').select_option('serif');page.locator('select[name="ppg_settings[transition]"]').select_option('slide')
  with page.expect_navigation(wait_until='domcontentloaded',timeout=90000): page.locator('#submit').click()
  check(page.locator('input[name="ppg_settings[text_size]"]').input_value()=='18','appearance text size saved/reloaded')
  check(page.locator('select[name="ppg_settings[font]"]').input_value()=='serif','font selection saved/reloaded')
  check(page.locator('select[name="ppg_settings[transition]"]').input_value()=='slide','transition selection saved/reloaded')
  check(not errors,'no gallery-editor JavaScript exceptions')
  b.close()
finally:
 # Only restore fields intentionally exercised by this local test, never a full DB snapshot.
 snapshot['expected_content']=contentAfterUpdate
 payload=json.dumps(snapshot,separators=(',',':'));import base64
 encoded=base64.b64encode(payload.encode()).decode()
 wp('$s=json_decode(base64_decode("'+encoded+'"),true);update_post_meta(10440,"_ppg_config",$s["config"]);if($s["has_slides"])update_post_meta(10440,"_ppg_slides",wp_slash($s["slides"]));else delete_post_meta(10440,"_ppg_slides");if($s["settings"]===null)delete_option("ppg_settings");else update_option("ppg_settings",$s["settings"]);$current=get_post_field("post_content",10440);if($s["expected_content"]!==null&&$current===$s["expected_content"]&&$current!==$s["content"])wp_update_post(wp_slash(["ID"=>10440,"post_content"=>$s["content"]]));echo "restored";')
print('PASS:',len(checks),'authenticated editor/browser checks')

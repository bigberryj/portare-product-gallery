'use strict';
// Real Chromium + public image URLs. Standalone fixture, no WordPress claims.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = process.env.PPG_SCREENSHOTS || path.join(__dirname, 'artifacts');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (error, buffer) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html');
    res.end(buffer);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/tests/fixtures/gallery.html`;
  const browser = await chromium.launch({ headless: true });
  fs.mkdirSync(output, { recursive: true });
  const failures = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => failures.push(error.message));
  try {
    await page.goto(url);
    await page.waitForSelector('.ppg-initialized');
    await page.waitForFunction(() => document.querySelector('.ppg-main-image').naturalWidth > 0, { timeout: 30000 });
    const layout = await page.evaluate(() => {
      const box = s => document.querySelector(s).getBoundingClientRect().toJSON();
      const strip = document.querySelector('.ppg-thumbnails');
      return { copy: box('.ppg-copy'), media: box('.ppg-media'), stage: box('.ppg-stage'), thumb: box('.ppg-thumb'), strip: box('.ppg-thumbnails'), scroll: strip.scrollWidth, gap: getComputedStyle(strip).gap, radius: getComputedStyle(document.querySelector('.ppg-stage')).borderRadius, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(layout.copy.x < layout.media.x);
    assert.equal(layout.gap, '24px'); assert.equal(layout.radius, '32px'); assert.equal(layout.overflow, false);
    assert.ok(layout.scroll > layout.strip.width);
    assert.ok(Math.abs((layout.thumb.width * 4 + 72 + 6) - layout.strip.width) < 2);
    await page.evaluate(() => Promise.all(document.querySelector('.ppg').getAnimations().map(a => a.finished.catch(() => {}))));
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    console.log('PASS desktop columns / four thumbs / 24px gaps / 32px radius / overflow');
    const y = await page.evaluate(() => scrollY);
    await page.locator('.ppg-thumb').first().focus(); await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('[data-index="5"]').getAttribute('aria-pressed') === 'true');
    assert.equal(await page.evaluate(() => scrollY), y);
    assert.ok(await page.locator('.ppg-thumbnails').evaluate(el => el.scrollLeft > 0));
    assert.ok((await page.locator('.ppg-description').textContent()).includes('Sample image 6'));
    assert.ok(await page.locator('.ppg-main-image').evaluate(el => el.srcset.includes('600w') && !!el.currentSrc));
    console.log('PASS keyboard End / strip-only scroll / description switch / responsive source');
    await page.locator('.ppg-prev').click();
    await page.waitForFunction(() => document.querySelector('[data-index="4"]').getAttribute('aria-pressed') === 'true');
    assert.equal((await page.locator('.ppg-description').textContent()).trim(), 'Default product description.');
    // Fail an actual image request; prior successful image and text must survive.
    const prior = await page.locator('.ppg-main-image').getAttribute('src');
    await page.route('**/photo-1500534623283-312aade485b7**', route => route.abort());
    await page.evaluate(() => { const node=document.querySelector('.ppg-data'); const data=JSON.parse(node.textContent); data.slides[3].src += '&forced-error=1'; data.slides[3].srcset=''; window.PortareProductGallery.destroy(document.querySelector('.ppg')); node.textContent=JSON.stringify(data); window.PortareProductGallery.init(); });
    await page.locator('[data-index="3"]').click(); await page.waitForSelector('.ppg-error:not([hidden])');
    assert.equal(await page.locator('.ppg-main-image').getAttribute('src'), prior);
    assert.equal((await page.locator('.ppg-description').textContent()).trim(), 'Default product description.');
    console.log('PASS description fallback / request error retains valid image and text');
    await page.unrouteAll();
    await page.goto(url + '?textSide=right');
    const right = await page.evaluate(() => document.querySelector('.ppg-copy').getBoundingClientRect().x > document.querySelector('.ppg-media').getBoundingClientRect().x);
    assert.equal(right, true); console.log('PASS text-right columns');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.ppg-main-image').naturalWidth > 0);
    const mobile = await page.evaluate(() => {
      const selectors=['.ppg-title','.ppg-stage','.ppg-thumbnails','.ppg-description','.ppg-quote'];
      return { y: selectors.map(s=>document.querySelector(s).getBoundingClientRect().top), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(mobile.overflow, false); assert.deepEqual([...mobile.y].sort((a,b)=>a-b),mobile.y);
    await page.evaluate(() => Promise.all(document.querySelector('.ppg').getAnimations().map(a => a.finished.catch(() => {}))));
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.locator('.ppg-stage').dispatchEvent('pointerdown', { isPrimary: true, pointerId: 1, clientX: 250, clientY: 200 });
    await page.locator('.ppg-stage').dispatchEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 205 });
    await page.waitForFunction(() => document.querySelector('[data-index="1"]').getAttribute('aria-pressed') === 'true');
    console.log('PASS mobile ordering / no page overflow / swipe');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url + '?autoplay=1');
    assert.equal(await page.locator('.ppg-play').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('.ppg').evaluate(el=>getComputedStyle(el).animationName), 'none');
    await page.locator('.ppg-play').click();
    await page.evaluate(() => document.activeElement.blur()); await page.mouse.move(0, 0);
    await page.waitForFunction(() => document.querySelector('[data-index="1"]').getAttribute('aria-pressed') === 'true', { timeout: 10000 });
    await page.locator('[data-index="2"]').click();
    assert.equal(await page.locator('.ppg-play').getAttribute('aria-pressed'), 'false');
    console.log('PASS reduced-motion initial off / manual play / manual selection stops autoplay');
    const baseline = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    await baseline.goto(url);
    assert.equal(await baseline.locator('.ppg-toolbar').isVisible(), false);
    assert.equal(await baseline.locator('.ppg-stage').isVisible(), true);
    assert.equal(await baseline.locator('.ppg-title').isVisible(), true);
    assert.equal(await baseline.locator('.ppg-thumb').count(), 6);
    assert.equal(await baseline.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await baseline.close(); console.log('PASS no-JS initial layout and hidden JS-only controls');
    assert.deepEqual(failures, []); console.log('PASS no browser JavaScript errors');
    console.log(`Screenshots: ${output}`);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });

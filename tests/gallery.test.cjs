'use strict';
// Unit DOM tests: controlled Image loads, not claims about WordPress/network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../assets/gallery.js'), 'utf8');
function markup(extra = '', count = 6) {
  const slides = Array.from({ length: count }, (_, i) => ({ id: i, src: `https://example.test/${i}.jpg`, srcset: `https://example.test/${i}-small.jpg 400w, https://example.test/${i}.jpg 1200w`, sizes: '70vw', alt: `Image ${i}`, description: i === 4 ? '' : `<p>Description ${i}</p>`, x: 20, y: 80, zoom: 1.5 }));
  return `<section class="ppg" data-ppg data-autoplay="0" data-duration="0" ${extra}><div class="ppg-stage"><img class="ppg-main-image" src="https://example.test/0.jpg"></div><div class="ppg-description">Initial description</div><div class="ppg-thumbnails">${slides.map((_, i) => `<button class="ppg-thumb" data-index="${i}" aria-pressed="${i === 0}">${i}</button>`).join('')}</div><button class="ppg-prev"></button><button class="ppg-next"></button><button class="ppg-play"></button><p class="ppg-error" hidden></p><p class="ppg-status"></p><script class="ppg-data" type="application/json">${JSON.stringify({ slides, defaultDescription: '<p>Fallback</p>' })}</script></section>`;
}
function setup(html = markup(), reduced = false) {
  const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, loads = [], timeouts = new Map();
  let timerID = 0;
  const mq = new w.EventTarget(); mq.matches = reduced;
  w.matchMedia = () => mq;
  w.setTimeout = (cb, ms) => { const id = ++timerID; timeouts.set(id, { cb, ms }); return id; };
  w.clearTimeout = id => timeouts.delete(id);
  w.HTMLElement.prototype.scrollBy = function (opts) { this.scrollLeft += opts.left; };
  w.Image = function () { const img = w.document.createElement('img'); loads.push(img); return img; };
  w.eval(source);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const root = w.document.querySelector('.ppg');
  return { dom, w, root, loads, timeouts, mq,
    click: i => root.querySelector(`[data-index="${i}"]`).click(),
    resolve: async (i = loads.length - 1) => { const img = loads[i]; Object.defineProperty(img, 'naturalWidth', { value: 1200 }); if (img.onload) img.onload(); await Promise.resolve(); await Promise.resolve(); },
    tick: async ms => { const found = Array.from(timeouts).find(([, value]) => value.ms === ms); assert.ok(found, `timer ${ms} exists`); timeouts.delete(found[0]); found[1].cb(); await Promise.resolve(); },
    close: () => dom.window.close()
  };
}
function checked(name, fn) { test(name, async () => { const env = setup(); try { await fn(env); } finally { env.close(); } }); }
checked('initializes accessible controls and maintains focal frame', e => {
  assert.ok(e.root.classList.contains('ppg-initialized'));
  assert.equal(e.root.querySelector('.ppg-play').textContent, 'Play slideshow');
  assert.equal(e.root.querySelector('img').style.getPropertyValue('--ppg-zoom'), '1.5');
});
checked('loads before atomic image/text replacement and retains responsive sources', async e => {
  e.click(1); assert.equal(e.root.querySelector('.ppg-description').textContent, 'Initial description');
  await e.resolve(); const img = e.root.querySelector('.ppg-main-image');
  assert.equal(img.src, 'https://example.test/1.jpg'); assert.ok(img.srcset.includes('400w')); assert.equal(img.sizes, '70vw');
  assert.equal(e.root.querySelector('.ppg-description').textContent, 'Description 1');
  assert.equal(e.root.querySelector('[data-index="1"]').getAttribute('aria-pressed'), 'true');
});
checked('rapid changes discard stale loads and do not overwrite newer selection', async e => {
  e.click(1); const stale = e.loads[0].onload; e.click(2); await e.resolve(1); stale(); await Promise.resolve();
  assert.equal(e.root.querySelector('.ppg-description').textContent, 'Description 2');
  assert.equal(e.root.querySelectorAll('.ppg-main-image').length, 1);
});
checked('return to current image cancels a pending load and clears aria-busy', async e => {
  e.click(1); e.click(0); assert.equal(e.root.hasAttribute('aria-busy'), false); await e.resolve(0);
  assert.equal(e.root.querySelector('.ppg-description').textContent, 'Initial description');
});
checked('broken image preserves prior image/text and announces an error', async e => {
  e.click(1); e.loads[0].onerror(); await Promise.resolve();
  assert.equal(e.root.querySelector('img').src, 'https://example.test/0.jpg');
  assert.equal(e.root.querySelector('.ppg-description').textContent, 'Initial description');
  assert.equal(e.root.querySelector('.ppg-error').hidden, false);
  e.click(2); await e.resolve(); assert.equal(e.root.querySelector('.ppg-error').hidden, true);
});
checked('empty description uses sanitized default rich content', async e => {
  e.click(4); await e.resolve(); assert.equal(e.root.querySelector('.ppg-description').innerHTML, '<p>Fallback</p>');
});
checked('keyboard End/Home and arrows focus without whole-page scroll', async e => {
  const b = e.root.querySelector('.ppg-thumb'); let opts;
  e.root.querySelector('[data-index="5"]').focus = value => { opts = value; };
  b.dispatchEvent(new e.w.KeyboardEvent('keydown', { key: 'End', bubbles: true })); await e.resolve();
  assert.equal(opts.preventScroll, true); assert.equal(e.root.querySelector('[data-index="5"]').getAttribute('aria-pressed'), 'true');
});
checked('manual selection stops explicit slideshow and hover pauses its timer', async e => {
  e.root.querySelector('.ppg-play').click(); assert.ok(Array.from(e.timeouts.values()).some(t => t.ms === 5000));
  e.root.dispatchEvent(new e.w.MouseEvent('mouseenter')); assert.ok(!Array.from(e.timeouts.values()).some(t => t.ms === 5000));
  e.root.dispatchEvent(new e.w.MouseEvent('mouseleave')); await e.tick(5000); await e.resolve();
  assert.equal(e.root.querySelector('.ppg-description').textContent, 'Description 1');
  e.click(2); await e.resolve(); assert.equal(e.root.querySelector('.ppg-play').getAttribute('aria-pressed'), 'false');
});
checked('hidden-tab and focus pauses retain playing intent', e => {
  const p = e.root.querySelector('.ppg-play'); p.click();
  Object.defineProperty(e.w.document, 'hidden', { configurable: true, value: true });
  e.w.document.dispatchEvent(new e.w.Event('visibilitychange'));
  assert.ok(!Array.from(e.timeouts.values()).some(t => t.ms === 5000)); assert.equal(p.getAttribute('aria-pressed'), 'true');
  Object.defineProperty(e.w.document, 'hidden', { configurable: true, value: false }); e.w.document.dispatchEvent(new e.w.Event('visibilitychange'));
  e.root.dispatchEvent(new e.w.FocusEvent('focusin')); assert.ok(!Array.from(e.timeouts.values()).some(t => t.ms === 5000));
});
test('reduced-motion disables configured autoplay until explicit play', () => {
  const e = setup(markup('data-interval="1000"').replace('data-autoplay="0"', 'data-autoplay="1"'), true);
  try { assert.equal(e.root.querySelector('.ppg-play').getAttribute('aria-pressed'), 'false'); e.root.querySelector('.ppg-play').click(); assert.ok(Array.from(e.timeouts.values()).some(t => t.ms === 1000)); } finally { e.close(); }
});
checked('destroy cancels pending loads, timers and prevents stale mutation', async e => {
  e.click(1); e.w.PortareProductGallery.destroy(e.root); await e.resolve();
  assert.equal(e.root.classList.contains('ppg-initialized'), false); assert.equal(e.root.querySelector('.ppg-description').textContent, 'Initial description');
  assert.ok(!Array.from(e.timeouts.values()).some(t => t.ms === 15000));
});
checked('multiple and lazy-inserted instances initialize independently', async e => {
  const wrapper = e.w.document.createElement('div'); wrapper.innerHTML = markup(); e.w.document.body.appendChild(wrapper);
  await Promise.resolve(); await Promise.resolve(); const other = wrapper.querySelector('.ppg');
  assert.ok(other.classList.contains('ppg-initialized')); other.querySelector('[data-index="2"]').click(); await e.resolve();
  assert.equal(other.querySelector('.ppg-description').textContent, 'Description 2'); assert.equal(e.root.querySelector('.ppg-description').textContent, 'Initial description');
  wrapper.remove(); await Promise.resolve(); assert.equal(other.classList.contains('ppg-initialized'), false);
});
test('invalid JSON and no slides leave baseline markup unchanged', () => {
  for (const html of [markup('', 0), markup().replace('"slides":', 'bad-json:')]) {
    const e = setup(html); try { assert.equal(e.root.classList.contains('ppg-initialized'), false); } finally { e.close(); }
  }
});
test('PHP percentage zoom and explicit text-fade-off are respected', async () => {
  const e = setup(markup('data-text-fade="0"').replaceAll('"zoom":1.5', '"zoom":150').replace('data-duration="0"', 'data-duration="50"'));
  try {
    const seen = []; e.w.HTMLElement.prototype.animate = function (frames) { seen.push({ element: this, frames }); return { finished: Promise.resolve(), cancel() {} }; };
    assert.equal(e.root.querySelector('img').style.getPropertyValue('--ppg-zoom'), '1.5');
    e.click(1); await e.resolve();
    assert.equal(e.root.querySelector('.ppg-main-image').style.getPropertyValue('--ppg-zoom'), '1.5');
    assert.equal(seen.length, 1); assert.equal(seen[0].element.className, 'ppg-main-image');
  } finally { e.close(); }
});
test('fade/slide/none transition policies and description fade', async () => {
  for (const transition of ['fade', 'slide', 'none']) {
    const e = setup(markup(`data-transition="${transition}"`).replace('data-duration="0"', 'data-duration="50"'));
    try {
      const seen = []; e.w.HTMLElement.prototype.animate = function (frames) { seen.push({ element: this, frames }); return { finished: Promise.resolve(), cancel() {} }; };
      e.click(1); await e.resolve();
      assert.equal(seen.length, transition === 'none' ? 1 : 2);
      assert.equal(seen.at(-1).element.className, 'ppg-description');
      if (transition === 'slide') assert.equal(seen[0].frames[0].translate, '18px 0');
      if (transition === 'fade') assert.equal(seen[0].frames[0].opacity, 0);
    } finally { e.close(); }
  }
});
checked('image timeout preserves baseline and clears busy state', async e => {
  e.click(1); await e.tick(15000); await Promise.resolve();
  assert.equal(e.root.querySelector('.ppg-error').hidden, false);
  assert.equal(e.root.hasAttribute('aria-busy'), false);
  assert.equal(e.root.querySelector('.ppg-description').textContent, 'Initial description');
});
test('single-slide controls are disabled and no slideshow timer runs', () => {
  const e = setup(markup('', 1).replace('data-autoplay="0"', 'data-autoplay="1"'));
  try { for (const s of ['.ppg-prev', '.ppg-next', '.ppg-play']) assert.equal(e.root.querySelector(s).disabled, true); assert.ok(!Array.from(e.timeouts.values()).some(t => t.ms === 5000)); } finally { e.close(); }
});
checked('bounded lazy observer stops at 60s; explicit init handles later markup', async e => {
  await e.tick(60000);
  const wrapper = e.w.document.createElement('div'); wrapper.innerHTML = markup(); e.w.document.body.appendChild(wrapper); await Promise.resolve();
  assert.equal(wrapper.querySelector('.ppg').classList.contains('ppg-initialized'), false);
  e.w.PortareProductGallery.init(wrapper);
  assert.equal(wrapper.querySelector('.ppg').classList.contains('ppg-initialized'), true);
});

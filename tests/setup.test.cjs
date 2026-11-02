'use strict';
/*
 * Unit tests for the Portare setup media player, admin panel and MP4 export.
 *
 * These tests control time and media explicitly: requestAnimationFrame,
 * performance.now, Image loading, canvas and MediaRecorder are all driven by
 * the harness. They assert the documented behaviour of the shipped assets only
 * and make no claim about WordPress, the network or a real encoder.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SETUP_JS = fs.readFileSync(path.join(ROOT, 'assets/setup.js'), 'utf8');
const ADMIN_JS = fs.readFileSync(path.join(ROOT, 'assets/setup-admin.js'), 'utf8');
const SETUP_CSS = fs.readFileSync(path.join(ROOT, 'assets/setup.css'), 'utf8');

/* ------------------------------------------------------------------ harness */

function playerMarkup(options) {
  const opts = options || {};
  const mode = opts.mode || 'sequence';
  const count = opts.count === undefined ? 2 : opts.count;
  const motion = opts.motion || 0;
  const productId = opts.productId === undefined ? 42 : opts.productId;
  const images = Array.from({ length: count }, (unused, i) => ({
    id: i + 1,
    src: `https://example.test/${i}.jpg`,
    alt: `Frame ${i}`
  }));
  let body;
  if (mode === 'pictures') {
    body = '<div class="ppg-setup-pictures">' + images.map((image, i) =>
      `<img src="${image.src}" alt="${image.alt}">`).join('') + '</div>';
  } else if (mode === 'video') {
    body = '<video class="ppg-setup-video" controls playsinline preload="metadata" src="https://example.test/setup.mp4"></video>';
  } else {
    body = '<div class="ppg-setup-stage">' + images.map(image =>
      `<img class="ppg-setup-frame" src="${image.src}" alt="${image.alt}">`).join('') +
      '<button type="button" class="ppg-setup-play">Play</button></div>';
  }
  const data = { mode, images, motion, duration: 15000, productId };
  return '<section class="ppg-setup" data-ppg-setup data-mode="' + mode + '" data-product-id="' + productId +
    '" data-motion="' + motion + '" data-replace-illustrations="1">' +
    '<h3 class="ppg-setup-heading">How to set it up</h3>' + body +
    '<p class="ppg-setup-caption">Step by step.</p>' +
    '<script class="ppg-setup-data" type="application/json">' + JSON.stringify(data) + '</script>' +
    '</section>';
}

function setup(html, options) {
  const opts = options || {};
  const dom = new JSDOM('<!doctype html><html><body>' + (html || '') + '</body></html>', {
    url: 'https://example.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;

  // Deterministic clock: requestAnimationFrame timestamps and performance.now
  // share one base so the player and the recorder advance together.
  let clock = 1000;
  const queue = [];
  let rafId = 0;
  w.requestAnimationFrame = cb => { rafId += 1; queue.push({ id: rafId, cb }); return rafId; };
  w.cancelAnimationFrame = id => {
    const index = queue.findIndex(entry => entry.id === id);
    if (index >= 0) queue.splice(index, 1);
  };
  try {
    Object.defineProperty(w.performance, 'now', { configurable: true, value: () => clock });
  } catch (_) { /* jsdom always exposes performance.now */ }

  // Reduced motion is opt-in per test.
  const motionQuery = new w.EventTarget();
  motionQuery.matches = !!opts.reducedMotion;
  w.matchMedia = () => motionQuery;

  // Real timers still run; the harness can also fire one on demand.
  const timers = [];
  const realSetTimeout = w.setTimeout.bind(w);
  const realClearTimeout = w.clearTimeout.bind(w);
  w.setTimeout = (cb, ms, ...args) => {
    const id = realSetTimeout(cb, ms, ...args);
    timers.push({ id, ms, cb, args });
    return id;
  };
  w.clearTimeout = id => {
    const index = timers.findIndex(entry => entry.id === id);
    if (index >= 0) timers.splice(index, 1);
    realClearTimeout(id);
  };

  const env = {
    dom,
    w,
    doc: w.document,
    motionQuery,
    timers,
    queued: () => queue.length,
    run(ts) {
      const pending = queue.splice(0, queue.length);
      pending.forEach(entry => entry.cb(ts));
      return pending.length;
    },
    advance(ms, step) {
      const increment = step || 16;
      const target = clock + ms;
      while (clock < target) {
        clock = Math.min(clock + increment, target);
        env.run(clock);
      }
    },
    fireTimeout(ms) {
      const found = timers.find(entry => entry.ms === ms);
      assert.ok(found, 'a timeout of ' + ms + 'ms was scheduled');
      const index = timers.indexOf(found);
      timers.splice(index, 1);
      realClearTimeout(found.id);
      found.cb(...found.args);
    },
    setHidden(value) {
      Object.defineProperty(w.document, 'hidden', { configurable: true, value });
    },
    close() {
      try { w.close(); } catch (_) { /* already closed */ }
    }
  };
  return env;
}

/** Load the player into an environment and boot it. */
function boot(env) {
  env.w.eval(SETUP_JS);
  env.doc.dispatchEvent(new env.w.Event('DOMContentLoaded'));
  return env.w.PortareSetupMedia;
}

/** Load the admin panel (and the player it depends on) into an environment. */
function bootAdmin(env) {
  env.w.eval(SETUP_JS);
  env.w.eval(ADMIN_JS);
  env.doc.dispatchEvent(new env.w.Event('DOMContentLoaded'));
  return env.w.PortareSetupMedia;
}

test('a completed setup sequence can be replayed from the first frame', () => {
 const e=setup(playerMarkup()); boot(e); const button=e.doc.querySelector('.ppg-setup-play');
 button.click(); e.advance(15100); assert.equal(button.getAttribute('aria-pressed'),'false');
 button.click(); e.advance(1000); assert.equal(button.getAttribute('aria-pressed'),'true');
 assert.equal(e.doc.querySelector('.ppg-setup-frame').style.opacity,'1'); e.close();
});
test('failed setup media reports visibly and restores retained original illustrations', () => {
 const e=setup('<div data-ppg>'+playerMarkup()+'<div class="ppg-preserved"><div data-ppg-setup-original hidden style="display:none!important">Original</div></div></div>');
 boot(e);e.doc.querySelector('.ppg-setup-frame').dispatchEvent(new e.w.Event('error'));
 assert(e.doc.querySelector('.ppg-setup-load-error[role=alert]'));
 assert.equal(e.doc.querySelector('[data-ppg-setup-original]').hidden,false);
 assert.equal(e.doc.querySelector('.ppg-setup-play').disabled,true);e.close();
});

/* ------------------------------------------------------------- media stubs */

function stubImages(env, options) {
  const opts = options || {};
  const loaded = [];
  env.w.Image = function () {
    const image = {
      naturalWidth: opts.width || 800,
      naturalHeight: opts.height || 600,
      onload: null,
      onerror: null,
      _src: '',
      get src() { return this._src; },
      set src(value) {
        this._src = value;
        loaded.push(this);
        if (opts.fail) { if (this.onerror) this.onerror(); return; }
        if (this.onload) this.onload();
      }
    };
    return image;
  };
  return loaded;
}

function stubRecorder(env, options) {
  const opts = options || {};
  const state = { instances: [], stopped: 0, started: 0 };
  class FakeMediaRecorder {
    constructor(stream, config) {
      if (opts.refuse) throw new Error('refused');
      this.stream = stream;
      this.config = config || {};
      this.state = 'inactive';
      this.ondataavailable = null;
      this.onstop = null;
      this.onerror = null;
      state.instances.push(this);
    }
    start() {
      this.state = 'recording';
      state.started += 1;
    }
    stop() {
      this.state = 'inactive';
      state.stopped += 1;
      if (opts.encoderFails) { if (this.onerror) this.onerror(); return; }
      if (this.ondataavailable) this.ondataavailable({ data: new env.w.Blob([opts.payload || new Uint8Array([1, 2, 3, 4])]) });
      if (this.onstop) this.onstop();
    }
  }
  FakeMediaRecorder.isTypeSupported = type => {
    if (opts.unsupported) return false;
    return type === 'video/mp4;codecs=avc1.42001E' || type === 'video/mp4';
  };
  env.w.MediaRecorder = FakeMediaRecorder;
  return state;
}

function stubCanvas(env, options) {
  const opts = options || {};
  const state = { tracks: [], drawn: 0 };
  const context = {
    globalAlpha: 1,
    fillStyle: '',
    save() {},
    restore() {},
    fillRect() {},
    drawImage() { state.drawn += 1; },
    getImageData() {
      if (opts.tainted) throw new Error('SecurityError: tainted canvas');
      return { data: [0, 0, 0, 0] };
    }
  };
  env.w.HTMLCanvasElement.prototype.getContext = () => context;
  env.w.HTMLCanvasElement.prototype.captureStream = function () {
    const track = { stop() { state.tracks.push('stopped'); } };
    state.tracks.push(track);
    return { getTracks: () => [track] };
  };
  return state;
}

/* --------------------------------------------------------------- timeline */

test('the timeline helper is deterministic and covers the whole 15 second span', () => {
  const env = setup();
  try {
    const api = boot(env);
    for (const count of [2, 3, 4]) {
      const timeline = api.buildTimeline(count, { motion: false });
      assert.equal(timeline.duration, 15000);
      assert.equal(timeline.count, count);
      assert.equal(timeline.frames.length, count);
      assert.equal(timeline.frames[0].start, 0);
      assert.equal(timeline.frames[count - 1].end, 15000);
      // Frames tile the span without gaps.
      timeline.frames.forEach((frame, index) => {
        if (index > 0) assert.equal(frame.start, timeline.frames[index - 1].end);
      });
      // Deterministic: the same input yields the same output.
      assert.deepEqual(api.buildTimeline(count, { motion: false }), timeline);
      // The first frame is fully visible at t=0 so nothing is blank at rest.
      const atStart = api.sampleTimeline(timeline, 0);
      assert.equal(atStart.length, 1);
      assert.equal(atStart[0].index, 0);
      assert.equal(atStart[0].opacity, 1);
      // The last frame holds to the end of the sequence.
      const atEnd = api.sampleTimeline(timeline, 15000);
      assert.equal(atEnd.length, 1);
      assert.equal(atEnd[0].index, count - 1);
      assert.equal(atEnd[0].opacity, 1);
    }
  } finally { env.close(); }
});

test('frames crossfade and the gentle zoom stays inside the frame', () => {
  const env = setup();
  try {
    const api = boot(env);
    const timeline = api.buildTimeline(2, { motion: true });
    // Midpoint of the first transition: both frames are partially visible.
    const middle = api.sampleTimeline(timeline, 7500 - timeline.fade / 2);
    assert.equal(middle.length, 2);
    const total = middle.reduce((sum, state) => sum + state.opacity, 0);
    assert.ok(Math.abs(total - 1) < 0.02, 'crossfade opacities sum to about 1, got ' + total);
    assert.ok(middle[0].opacity > 0 && middle[0].opacity < 1);
    assert.ok(middle[1].opacity > 0 && middle[1].opacity < 1);
    // The zoom is gentle and never exceeds the contained frame (94% * 1.06).
    const zoomed = api.sampleTimeline(timeline, 7500);
    assert.ok(zoomed.length >= 1);
    assert.ok(Math.max(...zoomed.map(state => state.scale)) <= 1.06);
    assert.ok(Math.max(...zoomed.map(state => state.scale)) * 0.94 <= 1);
    // The zoom grows continuously and never jumps between frames.
    const early = api.sampleTimeline(timeline, 0)[0].scale;
    const later = api.sampleTimeline(timeline, 15000)[0].scale;
    assert.ok(later > early);
    assert.ok(Math.abs(later - 1.06) < 0.0001);
  } finally { env.close(); }
});

test('reduced motion removes the fade and the zoom', () => {
  const env = setup();
  try {
    const api = boot(env);
    const timeline = api.buildTimeline(3, { motion: true, reducedMotion: true });
    assert.equal(timeline.fade, 0);
    assert.equal(timeline.motion, false);
    const states = api.sampleTimeline(timeline, 7500);
    assert.equal(states.length, 1);
    assert.equal(states[0].scale, 1);
  } finally { env.close(); }
});

/* ----------------------------------------------------------- media URLs */

test('media URL validation accepts local and http(s) sources only', () => {
  const env = setup();
  try {
    const api = boot(env);
    assert.equal(api.validateMediaUrl('https://example.test/a.jpg'), true);
    assert.equal(api.validateMediaUrl('http://example.test/a.jpg'), true);
    assert.equal(api.validateMediaUrl('/wp-content/uploads/a.jpg'), true);
    assert.equal(api.validateMediaUrl('javascript:alert(1)'), false);
    assert.equal(api.validateMediaUrl('data:image/png;base64,AAAA'), false);
    assert.equal(api.validateMediaUrl('vbscript:msgbox'), false);
    assert.equal(api.validateMediaUrl('//evil.test/a.jpg'), false);
    assert.equal(api.validateMediaUrl(''), false);
    assert.equal(api.validateMediaUrl(null), false);
    assert.equal(api.validateMediaUrl(undefined), false);
    assert.equal(api.validateMediaUrl(42), false);
    assert.equal(api.validateMediaUrl('https://example.test/a.jpg\n'), true);
  } finally { env.close(); }
});

/* -------------------------------------------------------------- player */

test('a sequence root initializes, never autostarts and exposes accessible controls', () => {
  const env = setup(playerMarkup());
  try {
    const api = boot(env);
    const root = env.doc.querySelector('.ppg-setup');
    assert.ok(root.classList.contains('ppg-setup-initialized'));
    const play = root.querySelector('.ppg-setup-play');
    assert.equal(play.getAttribute('aria-pressed'), 'false');
    assert.equal(play.getAttribute('aria-label'), 'Play setup sequence');
    assert.equal(env.queued(), 0, 'nothing is scheduled before the visitor presses play');
    // The first frame is visible at rest.
    const frames = root.querySelectorAll('.ppg-setup-frame');
    assert.equal(frames[0].style.opacity, '1');
    assert.equal(frames[1].style.opacity, '0');
    assert.equal(frames[1].getAttribute('aria-hidden'), 'true');
    assert.equal(typeof api.init, 'function');
  } finally { env.close(); }
});

test('playing runs a finite 15 second sequence with a fade and then stops', () => {
  const env = setup(playerMarkup({ count: 3 }));
  try {
    boot(env);
    const root = env.doc.querySelector('.ppg-setup');
    const play = root.querySelector('.ppg-setup-play');
    const frames = root.querySelectorAll('.ppg-setup-frame');
    play.click();
    assert.equal(play.getAttribute('aria-pressed'), 'true');
    assert.ok(env.queued() > 0, 'a frame loop is scheduled while playing');
    // Mid sequence: a fade is in progress between two frames.
    env.advance(5000);
    const opacities = Array.from(frames).map(frame => Number(frame.style.opacity));
    const partial = opacities.filter(value => value > 0 && value < 1);
    assert.ok(partial.length >= 1, 'a per-image fade is visible during playback');
    // The sequence is finite: it ends after 15 seconds and returns to rest.
    env.advance(11000);
    assert.equal(play.getAttribute('aria-pressed'), 'false');
    assert.equal(frames[2].style.opacity, '1');
    assert.equal(env.queued(), 0, 'no frame loop survives the end of the sequence');
  } finally { env.close(); }
});

test('the play button pauses and resumes the sequence', () => {
  const env = setup(playerMarkup());
  try {
    boot(env);
    const root = env.doc.querySelector('.ppg-setup');
    const play = root.querySelector('.ppg-setup-play');
    play.click();
    env.advance(4000);
    play.click();
    assert.equal(play.getAttribute('aria-pressed'), 'false');
    const queuedWhilePaused = env.queued();
    env.advance(2000);
    assert.equal(env.queued(), queuedWhilePaused, 'a paused sequence schedules no frames');
    play.click();
    assert.equal(play.getAttribute('aria-pressed'), 'true');
    assert.ok(env.queued() > 0);
  } finally { env.close(); }
});

test('only one setup area plays at a time across duplicate instances', () => {
  const env = setup(playerMarkup() + playerMarkup({ productId: 43 }));
  try {
    boot(env);
    const roots = env.doc.querySelectorAll('.ppg-setup');
    assert.equal(roots.length, 2);
    const first = roots[0].querySelector('.ppg-setup-play');
    const second = roots[1].querySelector('.ppg-setup-play');
    first.click();
    assert.equal(first.getAttribute('aria-pressed'), 'true');
    second.click();
    assert.equal(second.getAttribute('aria-pressed'), 'true');
    assert.equal(first.getAttribute('aria-pressed'), 'false', 'the first sequence was paused');
  } finally { env.close(); }
});

test('starting a video pauses the other setup areas', () => {
  const env = setup(playerMarkup() + playerMarkup({ mode: 'video', count: 0 }));
  try {
    const paused = [];
    env.w.HTMLMediaElement.prototype.pause = function () { paused.push(this); };
    boot(env);
    const roots = env.doc.querySelectorAll('.ppg-setup');
    roots[0].querySelector('.ppg-setup-play').click();
    assert.equal(roots[0].querySelector('.ppg-setup-play').getAttribute('aria-pressed'), 'true');
    roots[1].querySelector('video').dispatchEvent(new env.w.Event('play'));
    assert.equal(roots[0].querySelector('.ppg-setup-play').getAttribute('aria-pressed'), 'false');
  } finally { env.close(); }
});

test('a hidden tab pauses every setup area', () => {
  const env = setup(playerMarkup());
  try {
    boot(env);
    const play = env.doc.querySelector('.ppg-setup-play');
    play.click();
    assert.equal(play.getAttribute('aria-pressed'), 'true');
    env.setHidden(true);
    env.doc.dispatchEvent(new env.w.Event('visibilitychange'));
    assert.equal(play.getAttribute('aria-pressed'), 'false');
  } finally { env.close(); }
});

test('removing a root releases it and destroy() tears it down', () => {
  const env = setup(playerMarkup());
  try {
    const api = boot(env);
    const root = env.doc.querySelector('.ppg-setup');
    root.querySelector('.ppg-setup-play').click();
    assert.ok(env.queued() > 0);
    api.destroy(root);
    assert.equal(root.classList.contains('ppg-setup-initialized'), false);
    assert.equal(root.querySelector('.ppg-setup-play').getAttribute('aria-pressed'), 'false');
    assert.equal(env.queued(), 0, 'destroy cancels the frame loop');
    // A destroyed root no longer reacts.
    root.querySelector('.ppg-setup-play').click();
    assert.equal(env.queued(), 0);
  } finally { env.close(); }
});

test('a removed root is cleaned up by the bounded observer', async () => {
  const env = setup(playerMarkup());
  try {
    boot(env);
    const root = env.doc.querySelector('.ppg-setup');
    root.querySelector('.ppg-setup-play').click();
    root.remove();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(root.classList.contains('ppg-setup-initialized'), false);
    assert.equal(env.queued(), 0);
  } finally { env.close(); }
});

test('the observer stops after 60 seconds and explicit init still works', () => {
  const env = setup(playerMarkup());
  try {
    const api = boot(env);
    assert.ok(env.timers.some(entry => entry.ms === 60000), 'the observation window is bounded to 60 seconds');
    env.fireTimeout(60000);
    const wrapper = env.doc.createElement('div');
    wrapper.innerHTML = playerMarkup({ productId: 99 });
    env.doc.body.appendChild(wrapper);
    assert.equal(wrapper.querySelector('.ppg-setup').classList.contains('ppg-setup-initialized'), false);
    api.init(wrapper);
    assert.equal(wrapper.querySelector('.ppg-setup').classList.contains('ppg-setup-initialized'), true);
  } finally { env.close(); }
});

test('late roots mounted by the builder are picked up', async () => {
  const env = setup();
  try {
    boot(env);
    const wrapper = env.doc.createElement('div');
    wrapper.innerHTML = playerMarkup({ productId: 77 });
    env.doc.body.appendChild(wrapper);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(wrapper.querySelector('.ppg-setup').classList.contains('ppg-setup-initialized'), true);
  } finally { env.close(); }
});

test('the ppg:mounted event initializes setup areas that arrive with the gallery', () => {
  const env = setup();
  try {
    boot(env);
    const wrapper = env.doc.createElement('div');
    wrapper.innerHTML = playerMarkup({ productId: 78 });
    env.doc.body.appendChild(wrapper);
    env.doc.dispatchEvent(new env.w.CustomEvent('ppg:mounted', { detail: { gallery: wrapper } }));
    assert.equal(wrapper.querySelector('.ppg-setup').classList.contains('ppg-setup-initialized'), true);
  } finally { env.close(); }
});

test('malformed setup data leaves the markup untouched', () => {
  const broken = playerMarkup().replace('{"mode":"sequence"', '{"mode":"sequence" BROKEN');
  assert.notEqual(broken, playerMarkup(), 'the fixture must actually be corrupted');
  const env = setup(broken);
  try {
    boot(env);
    const root = env.doc.querySelector('.ppg-setup');
    assert.equal(root.classList.contains('ppg-setup-initialized'), false);
    assert.equal(root.querySelector('.ppg-setup-play').getAttribute('aria-pressed'), null);
    assert.equal(env.queued(), 0);
  } finally { env.close(); }
});

test('a sequence with fewer than two images cannot be played', () => {
  const env = setup(playerMarkup({ count: 1 }));
  try {
    boot(env);
    const root = env.doc.querySelector('.ppg-setup');
    const play = root.querySelector('.ppg-setup-play');
    assert.equal(play.disabled, true);
    assert.equal(play.getAttribute('aria-disabled'), 'true');
    play.click();
    assert.equal(env.queued(), 0);
  } finally { env.close(); }
});

/* --------------------------------------------------------------- preview */

test('createPreview builds safe markup for every mode', () => {
  const env = setup();
  try {
    const api = boot(env);
    const pictures = api.createPreview({
      mode: 'pictures',
      images: [{ id: 1, src: 'https://example.test/a.jpg', alt: 'A' }],
      motion: 0,
      productId: 5
    });
    assert.equal(pictures.getAttribute('data-ppg-setup'), '');
    assert.equal(pictures.getAttribute('data-mode'), 'pictures');
    assert.equal(pictures.querySelectorAll('.ppg-setup-pictures img').length, 1);
    assert.ok(pictures.querySelector('script.ppg-setup-data'));

    const sequence = api.createPreview({
      mode: 'sequence',
      images: [
        { id: 1, src: 'https://example.test/a.jpg', alt: 'A' },
        { id: 2, src: 'https://example.test/b.jpg', alt: 'B' }
      ],
      motion: 1,
      productId: 5
    });
    assert.equal(sequence.querySelectorAll('.ppg-setup-stage img.ppg-setup-frame').length, 2);
    assert.ok(sequence.querySelector('button.ppg-setup-play'));
    assert.equal(sequence.getAttribute('data-motion'), '1');

    const video = api.createPreview({ mode: 'video', images: [], motion: 0, productId: 5, videoUrl: 'https://example.test/v.mp4' });
    const element = video.querySelector('video.ppg-setup-video');
    assert.ok(element);
    assert.equal(element.getAttribute('controls'), '');
    assert.equal(element.getAttribute('playsinline'), '');
    assert.equal(element.getAttribute('preload'), 'metadata');
  } finally { env.close(); }
});

test('the preview never injects unsanitized markup from data', () => {
  const env = setup();
  try {
    const api = boot(env);
    const preview = api.createPreview({
      mode: 'pictures',
      images: [{ id: 1, src: 'https://example.test/a.jpg', alt: '<img src=x onerror=alert(1)>' }],
      heading: '<script>alert(1)</script>',
      caption: '</script><script>alert(2)</script>',
      motion: 0,
      productId: 5
    });
    assert.equal(preview.querySelectorAll('script').length, 1, 'only the data script is present');
    assert.equal(preview.querySelector('.ppg-setup-heading').textContent, '<script>alert(1)</script>');
    assert.equal(preview.querySelector('img').getAttribute('alt'), '<img src=x onerror=alert(1)>');
    const data = preview.querySelector('script.ppg-setup-data').textContent;
    assert.ok(!data.includes('</script>'), 'the data script cannot be closed early');
  } finally { env.close(); }
});

/* ---------------------------------------------------------------- export */

test('MP4 export reports a clear reason when the browser cannot record MP4', async () => {
  const env = setup();
  try {
    const api = boot(env);
    stubImages(env);
    stubRecorder(env, { unsupported: true });
    stubCanvas(env);
    const capability = api.supportsMp4Export();
    assert.equal(capability.supported, false);
    assert.match(capability.reason, /MP4/i);
    await assert.rejects(
      api.exportVideo({ images: [{ src: 'https://example.test/a.jpg' }, { src: 'https://example.test/b.jpg' }] }),
      /MP4/i
    );
  } finally { env.close(); }
});

test('MP4 export needs at least two images', async () => {
  const env = setup();
  try {
    const api = boot(env);
    stubImages(env);
    stubRecorder(env);
    stubCanvas(env);
    await assert.rejects(
      api.exportVideo({ images: [{ src: 'https://example.test/a.jpg' }] }),
      /at least two/i
    );
  } finally { env.close(); }
});

test('MP4 export produces a real MP4 blob only after the recorder stopped', async () => {
  const env = setup();
  try {
    const api = boot(env);
    stubImages(env);
    const recorder = stubRecorder(env);
    stubCanvas(env);
    const promise = api.exportVideo({
      images: [{ src: 'https://example.test/a.jpg' }, { src: 'https://example.test/b.jpg' }],
      motion: true
    });
    // Let the image loading microtasks settle before the frame loop starts.
    await new Promise(resolve => setTimeout(resolve, 0));
    env.advance(15000);
    const result = await promise;
    assert.equal(result.mimeType, 'video/mp4');
    assert.equal(result.duration, 15000);
    assert.equal(result.width, 1280);
    assert.equal(result.height, 720);
    assert.equal(result.fps, 30);
    assert.equal(result.blob.type, 'video/mp4');
    assert.ok(result.blob.size > 0);
    assert.equal(recorder.started, 1);
    assert.equal(recorder.stopped, 1);
  } finally { env.close(); }
});

// Structured ISO-BMFF header fixtures, not playable video or staging evidence.
for (const version of [0, 1]) {
  test(`MP4 export finalizes v${version} movie/track/media duration headers without changing media bytes`, async () => {
    const box = (type, payload) => { const head=Buffer.alloc(8);head.writeUInt32BE(payload.length+8);head.write(type,4);return Buffer.concat([head,payload]); };
    const header = scale => { const data=Buffer.alloc(40);data[0]=version;if(scale)data.writeUInt32BE(scale,version?20:12);return data; };
    const payload=Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('moov',Buffer.concat([box('mvhd',header(1000)),box('trak',Buffer.concat([box('tkhd',header(0)),box('mdia',box('mdhd',header(90000)))]))])),box('mdat',Buffer.from([19,23,29,31]))]);
    const env=setup();
    try {
      env.w.Blob=Blob; // Native Blob.arrayBuffer exercises the real finalization path.
      const api=boot(env);stubImages(env);stubRecorder(env,{payload});stubCanvas(env);
      const promise=api.exportVideo({images:[{src:'https://example.test/a.jpg'},{src:'https://example.test/b.jpg'}]});
      await new Promise(resolve=>setTimeout(resolve,0));env.advance(15000);
      const result=await promise;const output=Buffer.from(await result.blob.arrayBuffer());
      for(const [type,scale,offset] of [['mvhd',1000,version?24:16],['tkhd',1000,version?28:20],['mdhd',90000,version?24:16]]) {
        const start=output.indexOf(Buffer.from(type))+4;assert.ok(start>=4);
        if(version)assert.equal(output.readUInt32BE(start+offset),0);
        assert.equal(output.readUInt32BE(start+offset+(version?4:0)),15*scale,type);
      }
      assert.deepEqual(output.subarray(-4),payload.subarray(-4));assert.equal(output.length,payload.length);
    } finally { env.close(); }
  });
}

test('MP4 export rejects a canvas tainted by cross-origin images', async () => {
  const env = setup();
  try {
    const api = boot(env);
    stubImages(env);
    stubRecorder(env);
    stubCanvas(env, { tainted: true });
    await assert.rejects(
      api.exportVideo({ images: [{ src: 'https://example.test/a.jpg' }, { src: 'https://example.test/b.jpg' }] }),
      /not served from this site|Media Library/i
    );
  } finally { env.close(); }
});

test('MP4 export surfaces image loading failures', async () => {
  const env = setup();
  try {
    const api = boot(env);
    stubImages(env, { fail: true });
    stubRecorder(env);
    stubCanvas(env);
    await assert.rejects(
      api.exportVideo({ images: [{ src: 'https://example.test/a.jpg' }, { src: 'https://example.test/b.jpg' }] }),
      /could not be loaded/i
    );
  } finally { env.close(); }
});

test('a cancelled export never resolves with a file', async () => {
  const env = setup();
  try {
    const api = boot(env);
    stubImages(env);
    const recorder = stubRecorder(env);
    stubCanvas(env);
    const controller = new env.w.AbortController();
    const promise = api.exportVideo({
      images: [{ src: 'https://example.test/a.jpg' }, { src: 'https://example.test/b.jpg' }],
      signal: controller.signal
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(promise, /cancelled/i);
    assert.equal(recorder.stopped, 1);
  } finally { env.close(); }
});

test('a hidden tab aborts the export instead of returning a partial file', async () => {
  const env = setup();
  try {
    const api = boot(env);
    stubImages(env);
    const recorder = stubRecorder(env);
    stubCanvas(env);
    const promise = api.exportVideo({
      images: [{ src: 'https://example.test/a.jpg' }, { src: 'https://example.test/b.jpg' }]
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    env.setHidden(true);
    env.doc.dispatchEvent(new env.w.Event('visibilitychange'));
    await assert.rejects(promise, /hidden/i);
    assert.equal(recorder.stopped, 1);
  } finally { env.close(); }
});

test('an encoder failure rejects the export', async () => {
  const env = setup();
  try {
    const api = boot(env);
    stubImages(env);
    stubRecorder(env, { encoderFails: true });
    stubCanvas(env);
    const promise = api.exportVideo({
      images: [{ src: 'https://example.test/a.jpg' }, { src: 'https://example.test/b.jpg' }]
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    env.advance(15000);
    await assert.rejects(promise, /encoder failed/i);
  } finally { env.close(); }
});

/* ----------------------------------------------------------------- admin */

function adminMarkup() {
  return '<div class="ppg-setup-admin" data-product-id="42" data-upload-url="/wp-admin/admin-ajax.php" data-upload-nonce="nonce123">' +
    '<input type="hidden" name="ppg_setup_present" value="1">' +
    '<input type="hidden" id="ppg_setup_video_id" name="ppg_setup[video_id]" value="" data-url="">' +
    '<input type="hidden" id="ppg_setup_poster_id" name="ppg_setup[poster_id]" value="" data-url="">' +
    '<select id="ppg_setup_mode" name="ppg_setup[mode]"><option value="pictures">Pictures</option>' +
    '<option value="sequence">Sequence</option><option value="video">Video</option></select>' +
    '<input type="checkbox" id="ppg_setup_motion" name="ppg_setup[motion]" value="1">' +
    '<input type="text" id="ppg_setup_heading" name="ppg_setup[heading]" value="">' +
    '<textarea id="ppg_setup_caption" name="ppg_setup[caption]"></textarea>' +
    '<ol class="ppg-setup-list"></ol>' +
    '<template id="ppg-setup-image-template"><li class="ppg-setup-image" data-id="0" data-src="" data-alt="">' +
    '<img class="ppg-setup-thumb" src="" alt="" hidden>' +
    '<span class="ppg-setup-image-label"></span>' +
    '<input type="hidden" name="ppg_setup[images][]" value="0">' +
    '<button type="button" class="button ppg-setup-image-up">Up</button>' +
    '<button type="button" class="button ppg-setup-image-down">Down</button>' +
    '<button type="button" class="button ppg-setup-image-remove">Remove</button></li></template>' +
    '<button type="button" class="button ppg-setup-add-images">Add images</button>' +
    '<button type="button" class="button ppg-setup-pick-video">Choose video</button>' +
    '<button type="button" class="button ppg-setup-clear-video">Clear video</button>' +
    '<span class="ppg-setup-video-label"></span>' +
    '<button type="button" class="button ppg-setup-pick-poster">Choose poster</button>' +
    '<button type="button" class="button ppg-setup-clear-poster">Clear poster</button>' +
    '<span class="ppg-setup-poster-label"></span>' +
    '<button type="button" class="button ppg-setup-preview-button">Preview</button>' +
    '<div class="ppg-setup-preview"></div>' +
    '<button type="button" class="button ppg-setup-export">Export video</button>' +
    '<button type="button" class="button ppg-setup-export-cancel" disabled>Cancel</button>' +
    '<a class="ppg-setup-download" hidden>Download</a>' +
    '<button type="button" class="button ppg-setup-use-video" hidden>Add to Media Library</button>' +
    '<p class="ppg-setup-admin-status" role="status" aria-live="polite"></p>' +
    '<p class="ppg-setup-admin-error" role="alert"></p>' +
    '</div>';
}

function stubMediaLibrary(env) {
  const state = { frames: [] };
  env.w.wp = {
    media(options) {
      const frame = {
        options,
        handlers: {},
        on(event, cb) { this.handlers[event] = cb; return this; },
        state() {
          return { get: () => frame.selection };
        },
        selection: { each(cb) { frame.models.forEach(cb); }, toJSON() { return frame.models[0]; } },
        models: [],
        open() { state.frames.push(frame); }
      };
      return frame;
    }
  };
  return state;
}

function addImageRow(env, id, src, alt) {
  const list = env.doc.querySelector('.ppg-setup-list');
  const item = env.doc.createElement('li');
  item.className = 'ppg-setup-image';
  item.setAttribute('data-id', String(id));
  item.setAttribute('data-src', src);
  item.setAttribute('data-alt', alt || '');
  item.innerHTML = '<img src="" alt=""><span class="ppg-setup-image-label">Image #' + id + '</span>' +
    '<input type="hidden" name="ppg_setup[images][]" value="' + id + '">' +
    '<button type="button" class="button ppg-setup-image-up">Up</button>' +
    '<button type="button" class="button ppg-setup-image-down">Down</button>' +
    '<button type="button" class="button ppg-setup-image-remove">Remove</button>';
  list.appendChild(item);
  return item;
}

test('the admin panel lists images, reorders them and removes the association only', async () => {
  const env = setup(adminMarkup());
  try {
    bootAdmin(env);
    const list = env.doc.querySelector('.ppg-setup-list');
    addImageRow(env, 1, 'https://example.test/1.jpg', 'One');
    addImageRow(env, 2, 'https://example.test/2.jpg', 'Two');
    addImageRow(env, 3, 'https://example.test/3.jpg', 'Three');
    // The order controls follow the list when rows arrive from anywhere.
    await new Promise(resolve => setTimeout(resolve, 0));
    const items = () => Array.from(list.querySelectorAll('li.ppg-setup-image'));
    assert.equal(items().length, 3);
    // The first row cannot move up and the last cannot move down.
    assert.equal(items()[0].querySelector('.ppg-setup-image-up').disabled, true);
    assert.equal(items()[2].querySelector('.ppg-setup-image-down').disabled, true);
    items()[2].querySelector('.ppg-setup-image-up').click();
    assert.deepEqual(items().map(item => item.getAttribute('data-id')), ['1', '3', '2']);
    items()[0].querySelector('.ppg-setup-image-down').click();
    assert.deepEqual(items().map(item => item.getAttribute('data-id')), ['3', '1', '2']);
    items()[1].querySelector('.ppg-setup-image-remove').click();
    assert.deepEqual(items().map(item => item.getAttribute('data-id')), ['3', '2']);
    assert.equal(env.doc.querySelectorAll('input[name="ppg_setup[images][]"]').length, 2);
  } finally { env.close(); }
});

test('the media library appends images without duplicates and stops at four', () => {
  const env = setup(adminMarkup());
  try {
    bootAdmin(env);
    const library = stubMediaLibrary(env);
    addImageRow(env, 1, 'https://example.test/1.jpg', 'One');
    env.doc.querySelector('.ppg-setup-add-images').click();
    const frame = library.frames[0];
    assert.equal(frame.options.library.type, 'image');
    assert.ok(frame.options.multiple);
    frame.models = [
      { toJSON: () => ({ id: 1, type: 'image', url: 'https://example.test/1.jpg', alt: 'One' }) },
      { toJSON: () => ({ id: 2, type: 'image', url: 'https://example.test/2.jpg', alt: 'Two' }) },
      { toJSON: () => ({ id: 2, type: 'image', url: 'https://example.test/2.jpg', alt: 'Two again' }) },
      { toJSON: () => ({ id: 3, type: 'image', url: 'https://example.test/3.jpg', alt: 'Three' }) },
      { toJSON: () => ({ id: 4, type: 'image', url: 'https://example.test/4.jpg', alt: 'Four' }) },
      { toJSON: () => ({ id: 5, type: 'image', url: 'https://example.test/5.jpg', alt: 'Five' }) }
    ];
    frame.handlers.select();
    const ids = Array.from(env.doc.querySelectorAll('li.ppg-setup-image')).map(item => item.getAttribute('data-id'));
    assert.deepEqual(ids, ['1', '2', '3', '4'], 'duplicates and anything past four are skipped');
    assert.equal(env.doc.querySelector('.ppg-setup-add-images').disabled, true);
    // A new row uses the PHP template markup and stores the image id.
    const added = env.doc.querySelector('li.ppg-setup-image[data-id="2"]');
    assert.equal(added.querySelector('input[name="ppg_setup[images][]"]').value, '2');
    assert.equal(added.querySelector('.ppg-setup-image-label').textContent, 'Image #2');
    assert.ok(added.querySelector('.ppg-setup-image-up'));
    assert.ok(added.querySelector('.ppg-setup-image-down'));
    assert.ok(added.querySelector('.ppg-setup-image-remove'));
  } finally { env.close(); }
});

test('the media library only accepts image attachments', () => {
  const env = setup(adminMarkup());
  try {
    bootAdmin(env);
    const library = stubMediaLibrary(env);
    env.doc.querySelector('.ppg-setup-add-images').click();
    const frame = library.frames[0];
    frame.models = [{ toJSON: () => ({ id: 9, type: 'video', url: 'https://example.test/v.mp4' }) }];
    frame.handlers.select();
    assert.equal(env.doc.querySelectorAll('li.ppg-setup-image').length, 0);
  } finally { env.close(); }
});

test('choosing and clearing a video or poster updates the fields locally only', () => {
  const env = setup(adminMarkup());
  try {
    bootAdmin(env);
    const library = stubMediaLibrary(env);
    const videoField = env.doc.querySelector('#ppg_setup_video_id');
    const posterField = env.doc.querySelector('#ppg_setup_poster_id');
    env.doc.querySelector('.ppg-setup-pick-video').click();
    const videoFrame = library.frames[0];
    assert.equal(videoFrame.options.library.type, 'video');
    videoFrame.models = [{ toJSON: () => ({ id: 77, url: 'https://example.test/v.mp4' }) }];
    videoFrame.handlers.select();
    assert.equal(videoField.value, '77');
    assert.equal(videoField.getAttribute('data-url'), 'https://example.test/v.mp4');
    assert.equal(env.doc.querySelector('.ppg-setup-video-label').textContent, 'Video #77');
    assert.equal(env.doc.querySelector('#ppg_setup_mode').value, 'video');
    env.doc.querySelector('.ppg-setup-clear-video').click();
    assert.equal(videoField.value, '');
    assert.equal(videoField.getAttribute('data-url'), '');
    env.doc.querySelector('.ppg-setup-pick-poster').click();
    const posterFrame = library.frames[1];
    assert.equal(posterFrame.options.library.type, 'image');
    posterFrame.models = [{ toJSON: () => ({ id: 88, url: 'https://example.test/p.jpg', sizes: { thumbnail: { url: 'https://example.test/p-thumb.jpg' } } }) }];
    posterFrame.handlers.select();
    assert.equal(posterField.value, '88');
    assert.equal(posterField.getAttribute('data-url'), 'https://example.test/p-thumb.jpg');
    env.doc.querySelector('.ppg-setup-clear-poster').click();
    assert.equal(posterField.value, '');
  } finally { env.close(); }
});

test('the admin preview renders the selected setup media', () => {
  const env = setup(adminMarkup());
  try {
    bootAdmin(env);
    addImageRow(env, 1, 'https://example.test/1.jpg', 'One');
    addImageRow(env, 2, 'https://example.test/2.jpg', 'Two');
    env.doc.querySelector('#ppg_setup_mode').value = 'sequence';
    env.doc.querySelector('.ppg-setup-preview-button').click();
    const preview = env.doc.querySelector('.ppg-setup-preview');
    assert.equal(preview.querySelectorAll('.ppg-setup-frame').length, 2);
    assert.ok(preview.querySelector('.ppg-setup-play'));
    assert.equal(env.doc.querySelector('.ppg-setup-admin-status').textContent, 'Preview updated.');
  } finally { env.close(); }
});

test('no admin control submits the product form', () => {
  const env = setup(adminMarkup());
  try {
    bootAdmin(env);
    const controls = env.doc.querySelectorAll('.ppg-setup-admin button, .ppg-setup-admin a');
    assert.ok(controls.length > 0);
    controls.forEach(control => {
      assert.notEqual(control.getAttribute('type'), 'submit', control.className + ' must not submit the product');
    });
  } finally { env.close(); }
});

test('the export button is disabled with an explicit reason when MP4 is unavailable', async () => {
  const env = setup(adminMarkup());
  try {
    const api = bootAdmin(env);
    stubImages(env);
    stubRecorder(env, { unsupported: true });
    stubCanvas(env);
    await new Promise(resolve => setTimeout(resolve, 0));
    const exportButton = env.doc.querySelector('.ppg-setup-export');
    assert.equal(exportButton.disabled, true);
    assert.match(exportButton.getAttribute('title'), /MP4/i);
    assert.match(env.doc.querySelector('.ppg-setup-admin-error').textContent, /MP4/i);
  } finally { env.close(); }
});

test('exporting in the admin produces a downloadable file and never labels WebM as MP4', async () => {
  const env = setup(adminMarkup());
  try {
    const api = bootAdmin(env);
    stubImages(env);
    stubRecorder(env);
    stubCanvas(env);
    addImageRow(env, 1, 'https://example.test/1.jpg', 'One');
    addImageRow(env, 2, 'https://example.test/2.jpg', 'Two');
    const created = [];
    env.w.URL.createObjectURL = blob => { created.push(blob); return 'blob:setup/' + created.length; };
    env.w.URL.revokeObjectURL = () => {};
    await new Promise(resolve => setTimeout(resolve, 0));
    env.doc.querySelector('.ppg-setup-export').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    env.advance(15000);
    await new Promise(resolve => setTimeout(resolve, 10));
    const link = env.doc.querySelector('a.ppg-setup-download');
    assert.equal(link.hidden, false);
    assert.equal(link.getAttribute('download'), 'generated.mp4');
    assert.equal(link.getAttribute('href'), 'blob:setup/1');
    assert.equal(created.length, 1);
    assert.equal(created[0].type, 'video/mp4');
    assert.ok(env.doc.querySelector('.ppg-setup-preview video.ppg-setup-video'));
    assert.equal(env.doc.querySelector('.ppg-setup-use-video').hidden, false);
  } finally { env.close(); }
});

test('cancelling an export in the admin discards the partial recording', async () => {
  const env = setup(adminMarkup());
  try {
    const api = bootAdmin(env);
    stubImages(env);
    stubRecorder(env);
    stubCanvas(env);
    addImageRow(env, 1, 'https://example.test/1.jpg', 'One');
    addImageRow(env, 2, 'https://example.test/2.jpg', 'Two');
    env.w.URL.createObjectURL = () => 'blob:setup/1';
    env.w.URL.revokeObjectURL = () => {};
    await new Promise(resolve => setTimeout(resolve, 0));
    env.doc.querySelector('.ppg-setup-export').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    env.doc.querySelector('.ppg-setup-export-cancel').click();
    assert.equal(env.doc.querySelector('a.ppg-setup-download').hidden, true);
    assert.match(env.doc.querySelector('.ppg-setup-admin-error').textContent, /cancelled/i);
  } finally { env.close(); }
});

test('uploading the recorded video stores the attachment id locally', async () => {
  const env = setup(adminMarkup());
  try {
    const api = bootAdmin(env);
    stubImages(env);
    stubRecorder(env);
    stubCanvas(env);
    addImageRow(env, 1, 'https://example.test/1.jpg', 'One');
    addImageRow(env, 2, 'https://example.test/2.jpg', 'Two');
    env.w.URL.createObjectURL = () => 'blob:setup/1';
    env.w.URL.revokeObjectURL = () => {};
    const requests = [];
    env.w.fetch = (url, options) => {
      requests.push({ url, body: options.body });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 501, url: 'https://example.test/generated.mp4' } })
      });
    };
    await new Promise(resolve => setTimeout(resolve, 0));
    env.doc.querySelector('.ppg-setup-export').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    env.advance(15000);
    await new Promise(resolve => setTimeout(resolve, 10));
    env.doc.querySelector('.ppg-setup-use-video').click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/wp-admin/admin-ajax.php');
    const body = requests[0].body;
    assert.equal(body.get('action'), 'ppg_setup_upload');
    assert.equal(body.get('product_id'), '42');
    assert.equal(body.get('nonce'), 'nonce123');
    const file = body.get('setup_video');
    assert.ok(file, 'the recorded file is uploaded');
    assert.equal(file.name, 'generated.mp4');
    const videoField = env.doc.querySelector('#ppg_setup_video_id');
    assert.equal(videoField.value, '501');
    assert.equal(videoField.getAttribute('data-url'), 'https://example.test/generated.mp4');
    assert.equal(env.doc.querySelector('#ppg_setup_mode').value, 'video');
    assert.match(env.doc.querySelector('.ppg-setup-admin-status').textContent, /Update the product/i);
  } finally { env.close(); }
});

test('a rejected upload reports the reason and keeps the file locally', async () => {
  const env = setup(adminMarkup());
  try {
    const api = bootAdmin(env);
    stubImages(env);
    stubRecorder(env);
    stubCanvas(env);
    addImageRow(env, 1, 'https://example.test/1.jpg', 'One');
    addImageRow(env, 2, 'https://example.test/2.jpg', 'Two');
    env.w.URL.createObjectURL = () => 'blob:setup/1';
    env.w.URL.revokeObjectURL = () => {};
    env.w.fetch = () => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ success: false, data: { message: 'The file is not a valid MP4.' } })
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    env.doc.querySelector('.ppg-setup-export').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    env.advance(15000);
    await new Promise(resolve => setTimeout(resolve, 10));
    env.doc.querySelector('.ppg-setup-use-video').click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.match(env.doc.querySelector('.ppg-setup-admin-error').textContent, /not a valid MP4/i);
    assert.equal(env.doc.querySelector('#ppg_setup_video_id').value, '', 'nothing is stored when the upload fails');
  } finally { env.close(); }
});

/* -------------------------------------------------------------------- CSS */

test('the stylesheet scopes the public area to the gallery root', () => {
  assert.match(SETUP_CSS, /\.ppg \.ppg-setup\b/);
  assert.match(SETUP_CSS, /\.ppg-setup-admin \.ppg-setup\b/, 'the admin preview is styled outside .ppg');
  assert.match(SETUP_CSS, /#ppg_product_panel \.ppg-setup-admin/, 'admin chrome stays inside the product panel');
  assert.match(SETUP_CSS, /object-fit:\s*contain/, 'frames contain the artwork instead of cropping it');
  assert.match(SETUP_CSS, /contain:\s*layout paint/, 'setup media is contained');
  // 44px touch target for the public sequence control.
  const play = SETUP_CSS.match(/\.ppg \.ppg-setup-play \{[^}]*\}/);
  assert.ok(play, 'the public play button is styled');
  assert.match(play[0], /min-height:\s*44px/);
  assert.match(play[0], /min-width:\s*44px/);
});

test('the phone layout moves the setup area between the description and the quote', () => {
  const mobile = SETUP_CSS.match(/@media \(max-width: 767px\) \{[\s\S]*?\n\}/);
  assert.ok(mobile, 'a phone breakpoint exists');
  const block = mobile[0];
  assert.match(block, /\.ppg\[data-ppg\] \.ppg-copy \{[^}]*display:\s*contents/);
  assert.match(block, /\.ppg\[data-ppg\] \.ppg-setup \{[^}]*grid-row:\s*5/);
  assert.match(block, /\.ppg\[data-ppg\] \.ppg-quote \{[^}]*grid-row:\s*6/);
  assert.match(block, /\.ppg\[data-ppg\] \.ppg-error \{[^}]*grid-row:\s*7/);
  assert.match(block, /\.ppg\[data-ppg\] \.ppg-preserved \{[^}]*grid-row:\s*8/);
});

test('no asset writes untrusted markup through innerHTML', () => {
  [SETUP_JS, ADMIN_JS].forEach(source => {
    assert.ok(!/\.innerHTML\s*=/.test(source), 'innerHTML assignment found');
    assert.ok(!/\.outerHTML\s*=/.test(source), 'outerHTML assignment found');
    assert.ok(!/insertAdjacentHTML/.test(source), 'insertAdjacentHTML found');
    assert.ok(!/document\.write/.test(source), 'document.write found');
  });
});

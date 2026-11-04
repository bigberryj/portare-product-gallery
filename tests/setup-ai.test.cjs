'use strict';
/*
 * Unit tests for the Wan AI motion controller in the product editor.
 *
 * The provider is a server-side concern; these tests only exercise the
 * browser contract: the first/last frame selection, the per-request consent
 * that covers both paid credits and the external image transfer, the optional
 * prompt and render settings, the bounded polling loop, the explicit
 * "Use this video" hand-off and the recovery/resume path. No network call is
 * made; fetch is stubbed and the product form is never submitted.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const AI_JS = fs.readFileSync(path.join(ROOT, 'assets/setup-ai-admin.js'), 'utf8');
const SETUP_PHP = fs.readFileSync(path.join(ROOT, 'includes/class-ppg-setup.php'), 'utf8');
const SETUP_CSS = fs.readFileSync(path.join(ROOT, 'assets/setup.css'), 'utf8');

/* ------------------------------------------------------------------ markup */

function aiBlock(options) {
  const opts = options || {};
  const enabled = opts.enabled === false ? '0' : '1';
  const provider = opts.provider || 'Wan';
  const reason = opts.reason || '';
  const attributes = [
    'class="ppg-setup-ai"',
    'data-ai-enabled="' + enabled + '"',
    'data-ai-provider="' + provider + '"',
    'data-ai-reason="' + reason.replace(/"/g, '&quot;') + '"',
    'data-ai-duration="5"',
    'data-ai-min-images="2"',
    'data-ai-max-images="4"',
    'data-ai-generate-url="/wp-admin/admin-ajax.php"',
    'data-ai-status-url="/wp-admin/admin-ajax.php"',
    'data-ai-nonce="ai-nonce"'
  ].join(' ');
  return '<div ' + attributes + '>' +
    '<h4 class="ppg-setup-ai-title">AI motion (' + provider + ')</h4>' +
    (enabled === '0'
      ? '<p class="description ppg-setup-ai-unavailable">AI motion generation is not configured on this site.</p>'
      : '<select id="ppg_setup_ai_first_frame" class="ppg-setup-ai-frame-select"></select>' +
        '<select id="ppg_setup_ai_last_frame" class="ppg-setup-ai-frame-select"></select>' +
        '<textarea id="ppg_setup_ai_prompt" maxlength="500"></textarea>' +
        '<select id="ppg_setup_ai_duration"><option value="5" selected>5 seconds</option>' +
        '<option value="10">10 seconds</option><option value="15">15 seconds</option></select>' +
        '<select id="ppg_setup_ai_resolution"><option value="480P">480P</option>' +
        '<option value="720P" selected>720P</option></select>' +
        '<input type="checkbox" id="ppg_setup_ai_consent" value="1">' +
        '<button type="button" class="button button-primary ppg-setup-ai-generate">Generate with ' + provider + '</button>' +
        '<button type="button" class="button ppg-setup-ai-resume">Resume</button>' +
        '<p class="ppg-setup-ai-status" role="status" aria-live="polite"></p>' +
        '<p class="ppg-setup-ai-error" role="alert" aria-live="assertive"></p>' +
        '<div class="ppg-setup-ai-result" hidden>' +
        '<p class="ppg-setup-ai-result-label"></p>' +
        '<div class="ppg-setup-ai-preview"></div>' +
        '<button type="button" class="button ppg-setup-ai-use-video">Use this video</button>' +
        '</div>') +
    '</div>';
}

function markup(options) {
  const opts = options || {};
  const images = opts.images || [];
  const items = images.map(id =>
    '<li class="ppg-setup-image" data-id="' + id + '" data-src="https://example.test/' + id + '.png">' +
    '<span class="ppg-setup-image-label">Image #' + id + '</span></li>').join('');
  return '<form id="product-form">' +
    '<div class="ppg-setup-admin" data-product-id="42" data-upload-url="/wp-admin/admin-ajax.php" data-upload-nonce="nonce123">' +
    '<input type="hidden" id="ppg_setup_video_id" name="ppg_setup[video_id]" value="" data-url="">' +
    '<select id="ppg_setup_mode" name="ppg_setup[mode]"><option value="pictures" selected>Pictures</option>' +
    '<option value="sequence">Sequence</option><option value="video">Video</option></select>' +
    '<span class="ppg-setup-video-label"></span>' +
    '<ol class="ppg-setup-list">' + items + '</ol>' +
    aiBlock(opts) +
    '<p class="ppg-setup-admin-status" role="status" aria-live="polite"></p>' +
    '<p class="ppg-setup-admin-error" role="alert"></p>' +
    '</div></form>';
}

/* ----------------------------------------------------------------- harness */

/** Default response for a request that no test has queued. */
function idleResponse() {
  return { success: true, data: { status: 'idle', message: 'No render to resume.' } };
}

/**
 * Boot the editor panel.
 *
 * The fetch stub is installed before DOMContentLoaded is dispatched, because
 * the controller performs its automatic recovery read at that moment.
 */
function boot(html, options) {
  const opts = options || {};
  const dom = new JSDOM('<!doctype html><html><body>' + html + '</body></html>', {
    url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const timers = [];
  const w = dom.window;
  w.setTimeout = (cb, delay) => { const t = { cb, delay, id: timers.length }; timers.push(t); return t.id; };
  w.clearTimeout = id => { const t = timers.find(item => item.id === id); if (t) t.done = true; };

  const env = {
    dom, w,
    doc: w.document,
    requests: [],
    submissions: [],
    queue: (opts.responses || []).slice(),
    runTimers() {
      const due = timers.filter(t => !t.done && !t.ran);
      due.forEach(t => { t.ran = true; t.cb(); });
      return due.length;
    },
    close() { try { w.close(); } catch (_) { /* closed */ } }
  };

  /**
   * Stub fetch with a queue of responses, recording every request body.
   *
   * A response entry may be a plain object (success envelope), or an object
   * with `httpError`, `malformed` or `networkError` to exercise the failure
   * paths of the transport.
   */
  w.fetch = (url, options) => {
    const body = new w.URLSearchParams(options.body);
    env.requests.push({ url, body, action: body.get('action') });
    const next = env.queue.shift();
    if (!next) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(idleResponse()))
      });
    }
    if (next.networkError) {
      return Promise.reject(new Error(next.networkError));
    }
    if (next.malformed) {
      return Promise.resolve({
        ok: next.httpError !== true,
        status: next.httpError ? 500 : 200,
        text: () => Promise.resolve('<html>not json</html>')
      });
    }
    const payload = next.payload !== undefined ? next.payload : { success: true, data: {} };
    const status = next.status || 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(payload))
    });
  };

  w.eval(AI_JS);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  env.doc.getElementById('product-form').addEventListener('submit', event => {
    event.preventDefault();
    env.submissions.push(event);
  });
  // The controller reads the latest job on load. Requests made after this
  // point are the ones a test triggered itself.
  env.baseline = env.requests.length;
  return env;
}

/** Queue further responses for requests made after boot. */
function stubFetch(env, responses) {
  env.queue = responses.slice();
}

function addImages(env, ids) {
  const list = env.doc.querySelector('.ppg-setup-list');
  ids.forEach(id => {
    const item = env.doc.createElement('li');
    item.className = 'ppg-setup-image';
    item.setAttribute('data-id', String(id));
    list.appendChild(item);
  });
}

function flush() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function statusText(env) {
  const node = env.doc.querySelector('.ppg-setup-ai-status');
  return node ? node.textContent : '';
}

function errorText(env) {
  const node = env.doc.querySelector('.ppg-setup-ai-error');
  return node ? node.textContent : '';
}

function generateRequests(env) {
  return env.requests.slice(env.baseline).filter(request => request.action === 'ppg_setup_ai_generate');
}

function statusRequests(env) {
  return env.requests.slice(env.baseline).filter(request => request.action === 'ppg_setup_ai_status');
}

test('a failed video preview reports the media error and blocks Use', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    await flush();
    stubFetch(env, [{ payload: { success: true, data: { status: 'succeeded', job_id: 'job_0123456789abcdef', attachment_id: 333, url: 'https://example.test/missing.mp4' } } }]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    env.doc.querySelector('.ppg-setup-ai-video').dispatchEvent(new env.w.Event('error'));
    assert.match(errorText(env), /could not be played/i);
    assert.equal(env.doc.querySelector('.ppg-setup-ai-use-video').disabled, true);
    assert.equal(Number(env.doc.querySelector('#ppg_setup_video_id').value || 0), 0);
  } finally { env.close(); }
});

/* ------------------------------------------------------------------- tests */

test('manual frame choices survive generation sync and can use the fourth setup image', async () => {
  const html = markup({ images: [11, 12, 13, 14] }).replace('data-ai-max-images="4"', 'data-ai-max-images="2"');
  const env = boot(html);
  try {
    await flush();
    const first = env.doc.querySelector('#ppg_setup_ai_first_frame');
    const last = env.doc.querySelector('#ppg_setup_ai_last_frame');
    first.value = '13'; last.value = '14';
    first.dispatchEvent(new env.w.Event('change'));
    last.dispatchEvent(new env.w.Event('change'));
    stubFetch(env, [{ payload: { success: true, data: { status: 'processing', job_id: 'job_0123456789abcdef' } } }]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    assert.equal(generateRequests(env)[0].body.get('first_frame_id'), '13');
    assert.equal(generateRequests(env)[0].body.get('last_frame_id'), '14');
    assert.equal(first.value, '13'); assert.equal(last.value, '14');
  } finally { env.close(); }
});

test('every paid generation requires a newly checked consent box', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    await flush();
    stubFetch(env, [{ payload: { success: true, data: { status: 'succeeded', job_id: 'job_0123456789abcdef', attachment_id: 12, url: 'https://example.test/clip.mp4' } } }]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    assert.equal(env.doc.querySelector('#ppg_setup_ai_consent').checked, false);
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    assert.equal(generateRequests(env).length, 1);
    assert.match(errorText(env), /approve/i);
  } finally { env.close(); }
});

test('failed automatic recovery cannot unlock another paid generation', async () => {
  const env = boot(markup({ images: [11, 12] }), { responses: [{ networkError: 'Status unreachable' }] });
  try {
    await flush();
    assert.equal(env.doc.querySelector('.ppg-setup-ai-generate').disabled, true);
    stubFetch(env, [{ payload: { success: true, data: { status: 'idle' } } }]);
    env.doc.querySelector('.ppg-setup-ai-resume').click();
    await flush();
    assert.equal(env.doc.querySelector('.ppg-setup-ai-generate').disabled, false);
    assert.equal(generateRequests(env).length, 0);
  } finally { env.close(); }
});


test('the panel renders the first and last frame controls and the Wan settings', () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    const first = env.doc.querySelector('#ppg_setup_ai_first_frame');
    const last = env.doc.querySelector('#ppg_setup_ai_last_frame');
    assert.ok(first, 'a first frame control exists');
    assert.ok(last, 'a last frame control exists');
    assert.ok(env.doc.querySelector('#ppg_setup_ai_duration'), 'a duration control exists');
    assert.ok(env.doc.querySelector('#ppg_setup_ai_resolution'), 'a resolution control exists');
    assert.ok(env.doc.querySelector('#ppg_setup_ai_consent'), 'a consent control exists');
    const generate = env.doc.querySelector('.ppg-setup-ai-generate');
    assert.equal(generate.getAttribute('type'), 'button', 'the generate button never submits the form');
    assert.equal(env.doc.querySelector('.ppg-setup-ai-resume').getAttribute('type'), 'button');
    assert.equal(env.doc.querySelector('.ppg-setup-ai-use-video').getAttribute('type'), 'button');
    assert.match(generate.textContent, /Wan/, 'the button names the provider');
  } finally { env.close(); }
});

test('the frame controls follow the current setup image list', () => {
  const env = boot(markup({ images: [11, 12, 13] }));
  try {
    const first = env.doc.querySelector('#ppg_setup_ai_first_frame');
    const last = env.doc.querySelector('#ppg_setup_ai_last_frame');
    assert.equal(first.value, '11', 'the first image is the default first frame');
    assert.equal(last.value, '13', 'the last image is the default last frame');
    assert.notEqual(first.value, last.value, 'the default frames are distinct');
    assert.deepEqual(Array.from(first.options).map(o => o.value), ['11', '12', '13']);
  } finally { env.close(); }
});

test('images added after load extend the frame controls', async () => {
  const env = boot(markup({ images: [11] }));
  try {
    const first = env.doc.querySelector('#ppg_setup_ai_first_frame');
    const last = env.doc.querySelector('#ppg_setup_ai_last_frame');
    assert.equal(first.value, '11');
    assert.equal(last.value, '11', 'a single image is used for both frames until a second one exists');
    addImages(env, [12]);
    // The mutation observer rebuilds the controls on the next microtask.
    await flush();
    assert.deepEqual(Array.from(first.options).map(o => o.value), ['11', '12']);
    assert.equal(first.value, '11');
    assert.equal(last.value, '12', 'the last frame follows the newest list entry');
    assert.notEqual(first.value, last.value);
  } finally { env.close(); }
});

test('reordered images move the default last frame', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    const list = env.doc.querySelector('.ppg-setup-list');
    const last = env.doc.querySelector('#ppg_setup_ai_last_frame');
    assert.equal(last.value, '12');
    list.insertBefore(list.lastElementChild, list.firstElementChild);
    await flush();
    assert.equal(last.value, '11', 'the default last frame follows the new list order');
  } finally { env.close(); }
});

test('the frame controls use the four-image setup pool, not an unbounded list', async () => {
  const env = boot(markup({ images: [11, 12, 13, 14, 15] }));
  try {
    const first = env.doc.querySelector('#ppg_setup_ai_first_frame');
    assert.deepEqual(Array.from(first.options).map(o => o.value), ['11', '12', '13', '14'], 'the list is bounded by maxImages');
  } finally { env.close(); }
});

test('generation requires explicit consent before any request is sent', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    stubFetch(env, []);
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    assert.equal(generateRequests(env).length, 0, 'no render request without consent');
    const message = errorText(env);
    assert.match(message, /paid/i, 'the consent asks about the paid credits');
    assert.match(message, /upload|image/i, 'the consent asks about the external image transfer');
    assert.equal(env.submissions.length, 0, 'the product form is never submitted');
  } finally { env.close(); }
});

test('the first and last frame must be different images', async () => {
  const env = boot(markup({ images: [11] }));
  try {
    stubFetch(env, []);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    assert.equal(generateRequests(env).length, 0, 'a single image cannot be both frames');
    assert.match(errorText(env), /at least 2 setup images/i);
  } finally { env.close(); }
});

test('the request carries the fixed fields, the settings and the consent', async () => {
  const env = boot(markup({ images: [11, 12, 13] }));
  try {
    stubFetch(env, [{ payload: { success: true, data: { job_id: 'job_0123456789abcdef', status: 'processing', message: 'Rendering.' } } }]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('#ppg_setup_ai_prompt').value = 'Unfold it slowly';
    env.doc.querySelector('#ppg_setup_ai_duration').value = '10';
    env.doc.querySelector('#ppg_setup_ai_resolution').value = '480P';
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    const requests = generateRequests(env);
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.body.get('product_id'), '42');
    assert.equal(request.body.get('nonce'), 'ai-nonce');
    assert.equal(request.body.get('consent'), '1');
    assert.equal(request.body.get('first_frame_id'), '11');
    assert.equal(request.body.get('last_frame_id'), '13');
    assert.equal(request.body.get('prompt'), 'Unfold it slowly');
    assert.equal(request.body.get('duration'), '10');
    assert.equal(request.body.get('resolution'), '480P');
    assert.equal(env.submissions.length, 0, 'the product form is never submitted');
  } finally { env.close(); }
});

test('the default duration and resolution are sent when the operator does not change them', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    stubFetch(env, [{ payload: { success: true, data: { job_id: 'job_0123456789abcdef', status: 'processing' } } }]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    const request = generateRequests(env)[0];
    assert.equal(request.body.get('duration'), '5');
    assert.equal(request.body.get('resolution'), '720P');
    assert.equal(request.body.get('prompt'), '', 'a blank prompt is sent as an empty string');
  } finally { env.close(); }
});

test('a finished clip is previewed and is not staged until Use this video is pressed', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    stubFetch(env, [
      { payload: { success: true, data: { job_id: 'job_0123456789abcdef', status: 'processing', message: 'Rendering.' } } },
      { payload: { success: true, data: { job_id: 'job_0123456789abcdef', status: 'succeeded', attachment_id: 777, url: 'https://example.test/ai.mp4', message: 'Ready.' } } }
    ]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    env.runTimers();
    await flush();

    const polls = statusRequests(env);
    assert.equal(polls.length, 1);
    assert.equal(polls[0].body.get('job_id'), 'job_0123456789abcdef');

    const result = env.doc.querySelector('.ppg-setup-ai-result');
    assert.equal(result.hidden, false, 'the result panel is shown');
    const video = env.doc.querySelector('.ppg-setup-ai-preview video');
    assert.ok(video, 'a preview video element exists');
    assert.equal(video.getAttribute('controls') !== null, true, 'the preview has native controls');
    assert.equal(video.getAttribute('src'), 'https://example.test/ai.mp4');
    assert.equal(env.doc.querySelector('#ppg_setup_video_id').value, '', 'the product is not touched by the render');
    assert.equal(env.doc.querySelector('#ppg_setup_mode').value, 'pictures');

    env.doc.querySelector('.ppg-setup-ai-use-video').click();
    assert.equal(env.doc.querySelector('#ppg_setup_video_id').value, '777', 'Use this video stages the clip');
    assert.equal(env.doc.querySelector('#ppg_setup_video_id').getAttribute('data-url'), 'https://example.test/ai.mp4');
    assert.equal(env.doc.querySelector('#ppg_setup_mode').value, 'video');
    assert.match(env.doc.querySelector('.ppg-setup-video-label').textContent, /777/);
    assert.equal(env.submissions.length, 0, 'the product is published by the normal product Update');
  } finally { env.close(); }
});

test('Use this video dispatches change and input events so the setup preview refreshes', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    stubFetch(env, [
      { payload: { success: true, data: { job_id: 'job_0123456789abcdef', status: 'succeeded', attachment_id: 42, url: 'https://example.test/ai.mp4' } } }
    ]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    const videoField = env.doc.querySelector('#ppg_setup_video_id');
    const modeField = env.doc.querySelector('#ppg_setup_mode');
    const seen = [];
    videoField.addEventListener('change', () => seen.push('video:change'));
    videoField.addEventListener('input', () => seen.push('video:input'));
    modeField.addEventListener('change', () => seen.push('mode:change'));
    modeField.addEventListener('input', () => seen.push('mode:input'));
    env.doc.querySelector('.ppg-setup-ai-use-video').click();
    assert.ok(seen.includes('video:change'), 'the video field announces the change');
    assert.ok(seen.includes('video:input'), 'the video field announces the input');
    assert.ok(seen.includes('mode:change'), 'the mode field announces the change');
    assert.ok(seen.includes('mode:input'), 'the mode field announces the input');
  } finally { env.close(); }
});

test('a provider failure is reported visibly and unlocks the button', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    stubFetch(env, [{ status: 402, payload: { success: false, data: { code: 'provider_error', message: 'The Wan account has no usable credit.' } } }]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    assert.match(errorText(env), /no usable credit/i);
    assert.equal(env.doc.querySelector('.ppg-setup-ai-generate').disabled, false);
    assert.equal(env.doc.querySelector('#ppg_setup_video_id').value, '', 'no video is staged on failure');
    assert.equal(env.doc.querySelector('.ppg-setup-ai-result').hidden, true);
  } finally { env.close(); }
});

test('an HTTP failure is reported instead of being swallowed', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    stubFetch(env, [{ status: 500, payload: { success: false, data: { code: 'server_error', message: 'The render service failed.' } } }]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    assert.match(errorText(env), /render service failed/i);
    assert.equal(env.doc.querySelector('.ppg-setup-ai-generate').disabled, true, 'an ambiguous server failure must be resumed, not resubmitted');
  } finally { env.close(); }
});

test('a malformed response is reported instead of being swallowed', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    stubFetch(env, [{ malformed: true }]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    assert.match(errorText(env), /could not be started/i);
    assert.equal(env.doc.querySelector('.ppg-setup-ai-generate').disabled, true, 'malformed responses cannot prove that no paid job was accepted');
  } finally { env.close(); }
});

test('a transport failure never resubmits the render', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    stubFetch(env, [{ networkError: 'The connection was lost.' }]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    assert.match(errorText(env), /connection was lost/i);
    assert.match(errorText(env), /resume/i, 'the operator is pointed at the resume path');
    assert.equal(generateRequests(env).length, 1, 'the render is not sent again');
    assert.equal(env.doc.querySelector('.ppg-setup-ai-generate').disabled, true, 'a second paid render is blocked');
  } finally { env.close(); }
});

test('an unknown generation outcome is never resubmitted and can be resumed', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    stubFetch(env, [
      { payload: { success: true, data: { job_id: 'job_0123456789abcdef', status: 'unknown', message: 'The outcome is not known.' } } },
      { payload: { success: true, data: { job_id: 'job_0123456789abcdef', status: 'succeeded', attachment_id: 5, url: 'https://example.test/late.mp4' } } }
    ]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    assert.match(statusText(env), /not known/i);
    assert.equal(generateRequests(env).length, 1, 'the unknown outcome is not retried');

    env.doc.querySelector('.ppg-setup-ai-resume').click();
    await flush();
    assert.equal(generateRequests(env).length, 1, 'resuming never starts a render');
    const polls = statusRequests(env);
    assert.equal(polls.length, 1);
    assert.match(statusText(env), /use this video/i);
    const video = env.doc.querySelector('.ppg-setup-ai-preview video');
    assert.ok(video, 'the recovered clip is previewed');
    assert.equal(video.getAttribute('src'), 'https://example.test/late.mp4');
  } finally { env.close(); }
});

test('the resume button reads the latest job for the product and user', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    stubFetch(env, [{ payload: { success: true, data: { job_id: 'job_0123456789abcdef', status: 'processing', message: 'Still rendering.' } } }]);
    env.doc.querySelector('.ppg-setup-ai-resume').click();
    await flush();
    const polls = statusRequests(env);
    assert.equal(polls.length, 1);
    assert.equal(polls[0].body.get('product_id'), '42');
    assert.equal(polls[0].body.get('nonce'), 'ai-nonce');
    assert.equal(polls[0].body.get('job_id'), '', 'a blank job id asks the server for the latest job');
    assert.match(statusText(env), /still rendering/i);
  } finally { env.close(); }
});

test('the panel reads the latest job on load without starting a render', async () => {
  const env = boot(markup({ images: [11, 12] }), {
    responses: [{ payload: { success: true, data: { job_id: 'job_0123456789abcdef', status: 'processing', message: 'Still rendering.' } } }]
  });
  try {
    await flush();
    assert.equal(env.requests.length, 1, 'the recovery read is the only request');
    assert.equal(env.requests[0].action, 'ppg_setup_ai_status');
    assert.equal(env.requests[0].body.get('job_id'), '');
    assert.equal(env.requests[0].body.get('product_id'), '42');
    assert.equal(env.requests.some(request => request.action === 'ppg_setup_ai_generate'), false, 'no render is started on load');
    assert.match(statusText(env), /still rendering/i);
  } finally { env.close(); }
});

test('nothing is sent on load when the provider is not configured', async () => {
  const env = boot(markup({ images: [11, 12], enabled: false }));
  try {
    await flush();
    assert.equal(env.requests.length, 0, 'a missing configuration sends no request at all');
    assert.match(env.doc.querySelector('.ppg-setup-ai-unavailable').textContent, /not configured/i);
  } finally { env.close(); }
});

test('the controller never sends a credential to the server', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    stubFetch(env, [
      { payload: { success: true, data: { job_id: 'job_0123456789abcdef', status: 'processing' } } },
      { payload: { success: true, data: { job_id: 'job_0123456789abcdef', status: 'succeeded', attachment_id: 9, url: 'https://example.test/ai.mp4' } } }
    ]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    env.runTimers();
    await flush();
    assert.ok(env.requests.length >= 2);
    for (const request of env.requests) {
      for (const [key] of request.body) {
        assert.doesNotMatch(key, /key|secret|token|password/i, 'no credential field is sent');
      }
    }
    const serialized = env.requests.map(request => request.body.toString()).join('&');
    assert.doesNotMatch(serialized, /wan_access|access_key|apikey|bearer/i, 'no credential value is sent');
  } finally { env.close(); }
});

test('the polling loop stops after the bounded timeout and suggests the resume path', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    stubFetch(env, [{ payload: { success: true, data: { job_id: 'job_0123456789abcdef', status: 'processing', message: 'Rendering.' } } }]);
    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    assert.equal(generateRequests(env).length, 1);
    assert.equal(statusRequests(env).length, 0);

    // Move the clock past the polling deadline before the next poll fires.
    const realNow = env.w.Date.now;
    env.w.Date.now = () => realNow() + (16 * 60 * 1000);
    try {
      env.runTimers();
      await flush();
    } finally {
      env.w.Date.now = realNow;
    }
    assert.equal(statusRequests(env).length, 0, 'no further poll is sent after the deadline');
    assert.match(statusText(env), /resume/i, 'the operator is offered the resume path');
    assert.equal(generateRequests(env).length, 1, 'no second render is started');
  } finally { env.close(); }
});

test('a stale recovery response never overwrites a newer result', async () => {
  const env = boot(markup({ images: [11, 12] }));
  try {
    // The load time recovery is answered late and with an older clip.
    let releaseRecovery;
    const originalFetch = env.w.fetch;
    env.w.fetch = (url, options) => {
      const body = new env.w.URLSearchParams(options.body);
      env.requests.push({ url, body, action: body.get('action') });
      if (body.get('action') === 'ppg_setup_ai_status' && !env.released) {
        env.released = true;
        return new Promise(resolve => {
          releaseRecovery = () => resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(JSON.stringify({
              success: true,
              data: { job_id: 'job_0000000000000001', status: 'succeeded', attachment_id: 111, url: 'https://example.test/stale.mp4' }
            }))
          });
        });
      }
      return originalFetch(url, options);
    };
    stubFetch(env, [{ payload: { success: true, data: { job_id: 'job_0000000000000002', status: 'succeeded', attachment_id: 222, url: 'https://example.test/fresh.mp4' } } }]);

    env.doc.querySelector('#ppg_setup_ai_consent').checked = true;
    env.doc.querySelector('.ppg-setup-ai-generate').click();
    await flush();
    const video = env.doc.querySelector('.ppg-setup-ai-preview video');
    assert.ok(video, 'the new clip is previewed');
    assert.equal(video.getAttribute('src'), 'https://example.test/fresh.mp4');

    // The late recovery response arrives after the newer render finished.
    if (releaseRecovery) releaseRecovery();
    await flush();
    assert.equal(video.getAttribute('src'), 'https://example.test/fresh.mp4', 'the stale clip does not replace the current result');
    assert.equal(env.doc.querySelector('#ppg_setup_video_id').value, '', 'the stale response still does not stage a video');
  } finally { env.close(); }
});

test('the server side panel always explains a missing configuration', () => {
  assert.match(SETUP_PHP, /ppg-setup-ai-unavailable/, 'the unavailable reason is rendered');
  assert.match(SETUP_PHP, /ppg-setup-ai-frame-select/, 'the frame controls are rendered');
  assert.match(SETUP_PHP, /ppg-setup-ai-use-video/, 'the explicit hand-off button is rendered');
  assert.match(SETUP_PHP, /data-ai-reason/, 'the server reason is exposed to the editor');
  assert.doesNotMatch(SETUP_PHP, /ppg_setup_ai_prompt"\s+name=/, 'the AI controls are not submitted with the product form');
});

test('the panel exposes the provider name and the bounded settings to the editor', () => {
  assert.match(SETUP_PHP, /data-ai-provider=/, 'the provider name reaches the editor');
  assert.match(SETUP_PHP, /'provider' => 'Wan'/, 'Wan is the default provider name');
  assert.match(SETUP_PHP, /'5' => '5 seconds'/, 'the duration options are bounded');
  assert.match(SETUP_PHP, /'15' => '15 seconds'/, 'the duration options are bounded');
  assert.match(SETUP_PHP, /'480P' => /, 'the resolution options are bounded');
  assert.match(SETUP_PHP, /'720P' => /, 'the resolution options are bounded');
  assert.match(SETUP_PHP, /spends paid/, 'the consent names the paid credits');
  assert.match(SETUP_PHP, /uploads the selected setup images/, 'the consent names the external image transfer');
});

test('the AI panel is rendered in every case, including a missing configuration', () => {
  // The block markup lives outside the enabled/disabled branch, so the panel
  // is never omitted from the editor.
  const blockStart = SETUP_PHP.indexOf('class="ppg-setup-ai"');
  const blockEnd = SETUP_PHP.indexOf('</div>', SETUP_PHP.indexOf('ppg-setup-ai-result'));
  assert.ok(blockStart > 0, 'the AI block is rendered');
  assert.ok(blockEnd > blockStart, 'the AI block is closed');
  assert.ok(SETUP_PHP.includes('data-ai-enabled='), 'the block always carries its enabled state');
  assert.ok(SETUP_PHP.includes('ppg-setup-ai-unavailable'), 'the reason is rendered when disabled');
});

test('the generated clip styles are scoped to the editor panel', () => {
  assert.match(SETUP_CSS, /\.ppg-setup-ai-video/, 'the preview video has its own rule');
  assert.match(SETUP_CSS, /\.ppg-setup-ai-error/, 'the AI error line has its own rule');
  assert.doesNotMatch(SETUP_CSS, /\.ppg\s+\.ppg-setup-ai/, 'the admin rules do not leak into the public gallery');
});

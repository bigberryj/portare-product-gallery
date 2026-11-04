/**
 * Offline tests for the Wan transport runner.
 *
 * The runner is exercised against a stub child transport. No real @wan-ai/cli
 * process is started and no provider call is made.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const runner = require('../runtime/wan-runner.cjs');

/* ------------------------------------------------------------- fixtures */

/** A stub child transport that records its argv and replays a canned answer. */
function makeStub(responses) {
  const calls = [];
  let index = 0;
  const spawnFn = (bin, args, options) => {
    calls.push({ bin, args, options });
    const answer = responses[index] || { stdout: '{}', stderr: '', exitCode: 0 };
    index += 1;
    const { EventEmitter } = require('node:events');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 1000 + calls.length;
    child.kill = () => true;
    setImmediate(() => {
      if (answer.stdout) child.stdout.emit('data', Buffer.from(answer.stdout));
      if (answer.stderr) child.stderr.emit('data', Buffer.from(answer.stderr));
      child.emit('close', answer.exitCode === undefined ? 0 : answer.exitCode);
    });
    return child;
  };
  return { spawnFn, calls };
}

/** A media root with two real frame files. */
function makeMediaRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppg-wan-media-'));
  const first = path.join(root, 'first.png');
  const last = path.join(root, 'last.jpg');
  fs.writeFileSync(first, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64, 1)]));
  fs.writeFileSync(last, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 2)]));
  return { root, first, last };
}

/** Environment for the runner. */
function makeEnv(mediaRoot) {
  return {
    WAN_ACCESS_KEY: 'wan-sk.testid.testsecret',
    PPG_WAN_CLI: __filename,
    PPG_WAN_MEDIA_ROOT: mediaRoot,
  };
}

/* ------------------------------------------------------------ arg shapes */

test('create builds a fixed argument vector with no shell', () => {
  const args = runner.buildCreateArgs({
    first_frame: '/media/first.png',
    last_frame: '/media/last.jpg',
    duration: 10,
    resolution: '480P',
    prompt: 'unfold it',
  });
  assert.deepStrictEqual(args, [
    'frame2video',
    '--first-frame', '/media/first.png',
    '--last-frame', '/media/last.jpg',
    '--duration', '10',
    '--resolution', '480P',
    '--audio-output=false',
    '--prompt', 'unfold it',
    '--output', 'json',
  ]);
});

test('status builds a fixed argument vector', () => {
  assert.deepStrictEqual(runner.buildStatusArgs({ task_id: 'task-1' }), [
    'result', 'get', 'task-1', '--output', 'json',
  ]);
});

test('health and credits use read-only argument vectors', () => {
  assert.deepStrictEqual(runner.buildHealthArgs(), ['auth', 'status', '--output', 'json']);
  assert.deepStrictEqual(runner.buildCreditsArgs(), ['credits', '--output', 'json']);
});

/* --------------------------------------------------------- request rules */

test('an unknown operation is refused', async () => {
  const result = await runner.handle({ op: 'delete' }, { env: makeEnv('/tmp') });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'unknown_operation');
});

test('a request without an operation is refused', async () => {
  const result = await runner.handle({}, { env: makeEnv('/tmp') });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'unknown_operation');
});

test('a request that is not an object is refused', async () => {
  const result = await runner.handle(['create'], { env: makeEnv('/tmp') });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'invalid_request');
});

test('an unknown request field is refused', async () => {
  const result = await runner.handle({ op: 'status', task_id: 't', base_url: 'https://evil.test' }, { env: makeEnv('/tmp') });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'unknown_field');
});

test('a shell override field is refused', async () => {
  const result = await runner.handle({ op: 'status', task_id: 't', shell: 'rm -rf /' }, { env: makeEnv('/tmp') });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'unknown_field');
});

test('a path override field is refused', async () => {
  const result = await runner.handle({ op: 'status', task_id: 't', cli_path: '/tmp/evil.js' }, { env: makeEnv('/tmp') });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'unknown_field');
});

test('a missing credential is refused before anything runs', async () => {
  const stub = makeStub([{}]);
  const env = makeEnv('/tmp');
  delete env.WAN_ACCESS_KEY;
  const result = await runner.handle({ op: 'health' }, { env, spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'missing_credential');
  assert.strictEqual(stub.calls.length, 0);
});

test('a missing runtime is refused before anything runs', async () => {
  const stub = makeStub([{}]);
  const env = makeEnv('/tmp');
  env.PPG_WAN_CLI = '/nonexistent/wan/cli.js';
  const result = await runner.handle({ op: 'health' }, { env, spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'runtime_missing');
  assert.strictEqual(stub.calls.length, 0);
});

/* -------------------------------------------------------------- create */

test('create refuses a duration outside the allowlist', async () => {
  const media = makeMediaRoot();
  const stub = makeStub([{}]);
  const result = await runner.handle({
    op: 'create',
    first_frame: media.first,
    last_frame: media.last,
    duration: 7,
    resolution: '720P',
    prompt: 'x',
  }, { env: makeEnv(media.root), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'invalid_request');
  assert.strictEqual(stub.calls.length, 0);
});

test('create refuses a resolution outside the allowlist', async () => {
  const media = makeMediaRoot();
  const stub = makeStub([{}]);
  const result = await runner.handle({
    op: 'create',
    first_frame: media.first,
    last_frame: media.last,
    duration: 5,
    resolution: '1080P',
    prompt: 'x',
  }, { env: makeEnv(media.root), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'invalid_request');
  assert.strictEqual(stub.calls.length, 0);
});

test('create refuses a frame outside the media root', async () => {
  const media = makeMediaRoot();
  const stub = makeStub([{}]);
  const result = await runner.handle({
    op: 'create',
    first_frame: '/etc/passwd.png',
    last_frame: media.last,
    duration: 5,
    resolution: '720P',
    prompt: 'x',
  }, { env: makeEnv(media.root), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'invalid_media');
  assert.strictEqual(stub.calls.length, 0);
});

test('create refuses a frame with an unsupported extension', async () => {
  const media = makeMediaRoot();
  const stub = makeStub([{}]);
  const result = await runner.handle({
    op: 'create',
    first_frame: path.join(media.root, 'frame.svg'),
    last_frame: media.last,
    duration: 5,
    resolution: '720P',
    prompt: 'x',
  }, { env: makeEnv(media.root), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'invalid_media');
});

test('create refuses the same frame twice', async () => {
  const media = makeMediaRoot();
  const stub = makeStub([{}]);
  const result = await runner.handle({
    op: 'create',
    first_frame: media.first,
    last_frame: media.first,
    duration: 5,
    resolution: '720P',
    prompt: 'x',
  }, { env: makeEnv(media.root), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'invalid_media');
});

test('create returns the task id and keeps the credential out of argv', async () => {
  const media = makeMediaRoot();
  const stub = makeStub([{ stdout: JSON.stringify({ taskId: 'task-42', request: {} }) }]);
  const result = await runner.handle({
    op: 'create',
    first_frame: media.first,
    last_frame: media.last,
    duration: 5,
    resolution: '720P',
    prompt: 'unfold it',
  }, { env: makeEnv(media.root), spawnFn: stub.spawnFn });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.task_id, 'task-42');
  assert.strictEqual(stub.calls.length, 1);

  const call = stub.calls[0];
  assert.strictEqual(call.options.shell, false);
  // argv[0] is the CLI entry point; the operation arguments follow it.
  const argv = call.args.slice(1);
  assert.strictEqual(argv[0], 'frame2video');
  assert.ok(!call.args.includes('wan-sk.testid.testsecret'), 'the credential is never an argument');
  assert.ok(argv.includes('--first-frame'));
  assert.ok(argv.includes('--audio-output=false'));
  assert.ok(argv.includes('--output'));
  assert.ok(argv.includes('json'));

  // The child environment is built from scratch and carries the credential.
  const env = call.options.env;
  assert.strictEqual(env.WAN_ACCESS_KEY, 'wan-sk.testid.testsecret');
  assert.strictEqual(env.WAN_OUTPUT, 'json');
  assert.strictEqual(env.LANG, 'C.UTF-8');
  assert.ok(!('DB_PASSWORD' in env), 'no unrelated secret is forwarded');
  assert.ok(!('WP_OPTIONS' in env), 'no WordPress secret is forwarded');
});

test('create reports a provider error envelope', async () => {
  const media = makeMediaRoot();
  const stub = makeStub([{
    stdout: JSON.stringify({ ok: false, errorCode: '4018', errorMsg: 'not a member' }),
  }]);
  const result = await runner.handle({
    op: 'create',
    first_frame: media.first,
    last_frame: media.last,
    duration: 5,
    resolution: '720P',
    prompt: 'x',
  }, { env: makeEnv(media.root), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'provider_rejected');
  assert.strictEqual(result.error.ambiguous, false);
  assert.match(result.error.message, /membership/i);
});

test('an unrecognised provider error is an ambiguous outcome', async () => {
  const media = makeMediaRoot();
  const stub = makeStub([{
    stdout: JSON.stringify({ ok: false, errorCode: 'GATEWAY_TIMEOUT', errorMsg: 'upstream timeout' }),
  }]);
  const result = await runner.handle({
    op: 'create',
    first_frame: media.first,
    last_frame: media.last,
    duration: 5,
    resolution: '720P',
    prompt: 'x',
  }, { env: makeEnv(media.root), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.ambiguous, true);
});

test('every post-submission failure of create is ambiguous', async () => {
  const media = makeMediaRoot();
  const cases = [
    { stdout: 'not json at all' },
    { stdout: JSON.stringify({ request: {} }) },
    { stdout: JSON.stringify({ ok: false, errorCode: 'GATEWAY_TIMEOUT' }) },
  ];
  for (const answer of cases) {
    const stub = makeStub([answer]);
    const result = await runner.handle({
      op: 'create',
      first_frame: media.first,
      last_frame: media.last,
      duration: 5,
      resolution: '720P',
      prompt: 'x',
    }, { env: makeEnv(media.root), spawnFn: stub.spawnFn });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.ambiguous, true, 'an uncertain outcome must be ambiguous');
  }
});

test('a pre-submission refusal is not ambiguous', async () => {
  const media = makeMediaRoot();
  const stub = makeStub([{}]);
  const result = await runner.handle({
    op: 'create',
    first_frame: media.first,
    last_frame: media.last,
    duration: 7,
    resolution: '720P',
    prompt: 'x',
  }, { env: makeEnv(media.root), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'invalid_request');
  assert.notStrictEqual(result.error.ambiguous, true);
});

test('create reports an unreadable provider answer', async () => {
  const media = makeMediaRoot();
  const stub = makeStub([{ stdout: 'not json at all' }]);
  const result = await runner.handle({
    op: 'create',
    first_frame: media.first,
    last_frame: media.last,
    duration: 5,
    resolution: '720P',
    prompt: 'x',
  }, { env: makeEnv(media.root), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'provider_unreadable');
});

test('create reports a missing task reference', async () => {
  const media = makeMediaRoot();
  const stub = makeStub([{ stdout: JSON.stringify({ request: {} }) }]);
  const result = await runner.handle({
    op: 'create',
    first_frame: media.first,
    last_frame: media.last,
    duration: 5,
    resolution: '720P',
    prompt: 'x',
  }, { env: makeEnv(media.root), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'provider_unreadable');
});

/* -------------------------------------------------------------- status */

test('status maps a running task to processing', async () => {
  const stub = makeStub([{ stdout: JSON.stringify({ ok: true, status: 1, statusLabel: 'processing' }) }]);
  const result = await runner.handle({ op: 'status', task_id: 'task-1' }, { env: makeEnv('/tmp'), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, 'processing');
  assert.strictEqual(result.download_url, '');
});

test('status maps a finished task to succeeded and returns the download url', async () => {
  const stub = makeStub([{
    stdout: JSON.stringify({
      ok: true,
      status: 2,
      statusLabel: 'succeeded',
      result: [{ downloadUrl: 'https://x.oss-cn-x.aliyuncs.com/out/clip.mp4' }],
    }),
  }]);
  const result = await runner.handle({ op: 'status', task_id: 'task-1' }, { env: makeEnv('/tmp'), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, 'succeeded');
  assert.strictEqual(result.download_url, 'https://x.oss-cn-x.aliyuncs.com/out/clip.mp4');
});

test('status maps a failed task to failed and keeps the reason', async () => {
  const stub = makeStub([{
    stdout: JSON.stringify({ ok: false, status: 3, statusLabel: 'failed', errorMsg: 'content policy' }),
  }]);
  const result = await runner.handle({ op: 'status', task_id: 'task-1' }, { env: makeEnv('/tmp'), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, 'failed');
  assert.strictEqual(result.error, 'content policy');
});

test('status refuses a task reference with unexpected characters', async () => {
  const stub = makeStub([{}]);
  const result = await runner.handle({ op: 'status', task_id: 'task 1; rm -rf /' }, { env: makeEnv('/tmp'), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'invalid_request');
  assert.strictEqual(stub.calls.length, 0);
});

test('status refuses an empty task reference', async () => {
  const result = await runner.handle({ op: 'status', task_id: '' }, { env: makeEnv('/tmp'), spawnFn: makeStub([{}]).spawnFn });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'invalid_request');
});

/* -------------------------------------------------------------- health */

test('health reports an authenticated provider', async () => {
  const stub = makeStub([
    { stdout: JSON.stringify({ ok: true, authenticated: true, data: { taskQuota: { image: 2, video: 1 } } }) },
    { stdout: JSON.stringify({ points: 12 }) },
  ]);
  const result = await runner.handle({ op: 'health' }, { env: makeEnv('/tmp'), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.enabled, true);
  assert.match(result.message, /accepted/i);
  assert.deepStrictEqual(result.task_quota, { image: 2, video: 1 });
  assert.strictEqual(stub.calls.length, 2);
  assert.deepStrictEqual(stub.calls[0].args.slice(1), ['auth', 'status', '--output', 'json']);
  assert.deepStrictEqual(stub.calls[1].args.slice(1), ['credits', '--output', 'json']);
});

test('health reports an unauthenticated provider', async () => {
  const stub = makeStub([
    { stdout: JSON.stringify({ ok: true, authenticated: false }) },
    { stdout: JSON.stringify({ points: 0 }) },
  ]);
  const result = await runner.handle({ op: 'health' }, { env: makeEnv('/tmp'), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.enabled, false);
});

test('health survives a failing credit query', async () => {
  const stub = makeStub([
    { stdout: JSON.stringify({ ok: true, authenticated: true }) },
    { stdout: 'not json', exitCode: 1 },
  ]);
  const result = await runner.handle({ op: 'health' }, { env: makeEnv('/tmp'), spawnFn: stub.spawnFn });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.enabled, true);
});

/* -------------------------------------------------------- normalisation */

test('the status label mapping covers the provider values', () => {
  assert.strictEqual(runner.deriveStatusLabel(0), 'queued');
  assert.strictEqual(runner.deriveStatusLabel(1), 'processing');
  assert.strictEqual(runner.deriveStatusLabel(2), 'succeeded');
  assert.strictEqual(runner.deriveStatusLabel('completed'), 'succeeded');
  assert.strictEqual(runner.deriveStatusLabel('failed'), 'failed');
  assert.strictEqual(runner.deriveStatusLabel(9), 'failed');
  assert.strictEqual(runner.deriveStatusLabel('processing'), 'processing');
  assert.strictEqual(runner.deriveStatusLabel(undefined), 'unknown');
});

test('the download url is taken from the task result', () => {
  assert.strictEqual(
    runner.extractDownloadUrl([{ downloadUrl: 'https://a.test/c.mp4' }]),
    'https://a.test/c.mp4'
  );
  assert.strictEqual(
    runner.extractDownloadUrl([{ downloadUrlWithLogo: 'https://a.test/w.mp4' }]),
    'https://a.test/w.mp4'
  );
  assert.strictEqual(
    runner.extractDownloadUrl([{ url: 'https://a.test/u.mp4' }]),
    'https://a.test/u.mp4'
  );
  assert.strictEqual(runner.extractDownloadUrl('https://a.test/plain.mp4'), 'https://a.test/plain.mp4');
  assert.strictEqual(runner.extractDownloadUrl([{ other: 'x' }]), '');
  assert.strictEqual(runner.extractDownloadUrl(null), '');
  assert.strictEqual(runner.extractDownloadUrl([{ downloadUrl: 'not-a-url' }]), '');
});

test('the provider error message maps the membership rejection', () => {
  const message = runner.providerErrorMessage({ ok: false, errorCode: '4018', errorMsg: 'x' });
  assert.match(message, /membership/i);
});

test('the provider error message explains a local media rejection', () => {
  const message = runner.providerErrorMessage({
    ok: false,
    errorCode: 'LOCAL_FILE_VALIDATION_FAILED',
    details: { issue: 'unsupported_format', suggestedFix: { action: 'convert_format' } },
  });
  assert.match(message, /frame images/i);
});

/* ------------------------------------------------------------ redaction */

test('redaction removes the credential and signed query strings', () => {
  const secret = 'wan-sk.testid.testsecret';
  const text = runner.redact('failed for ' + secret + ' at https://a.test/c.mp4?sig=abc123', secret);
  assert.ok(!text.includes(secret));
  assert.ok(!text.includes('sig=abc123'));
  assert.ok(text.includes('[redacted]'));
});

test('redaction removes a bearer token', () => {
  const text = runner.redact('Authorization: Bearer abc.def.ghi');
  assert.ok(!text.includes('abc.def.ghi'));
});

test('redaction bounds the message length', () => {
  const text = runner.redact('x'.repeat(5000));
  assert.ok(text.length <= 601);
});

/* -------------------------------------------------------------- limits */

test('the runner declares its allowlists', () => {
  assert.deepStrictEqual(runner.ALLOWED_DURATIONS, [5, 10, 15]);
  assert.deepStrictEqual(runner.ALLOWED_RESOLUTIONS, ['480P', '720P']);
  assert.deepStrictEqual(runner.ALLOWED_IMAGE_EXTENSIONS, ['.png', '.jpg', '.jpeg', '.webp']);
  assert.deepStrictEqual(Object.keys(runner.OP_FIELDS).sort(), ['create', 'health', 'status']);
  assert.ok(runner.LIMITS.inputBytes > 0);
  assert.ok(runner.LIMITS.stdoutBytes > 0);
});

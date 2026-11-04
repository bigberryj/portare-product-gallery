#!/usr/bin/env node
/**
 * Portare Wan transport runner.
 *
 * The WordPress plugin never talks to wan.video directly. It writes one JSON
 * request to this runner's stdin and reads one JSON response from stdout.
 *
 * Responsibilities:
 * - Translate a small, fixed set of operations into fixed argument vectors for
 *   the pinned @wan-ai/cli build. No shell is used, so nothing in the request
 *   can be interpreted as a command.
 * - Reject unknown operations, unknown request fields, and every attempt to
 *   override the executable, the API base URL, the shell or the media root.
 * - Pass the AccessKey to the CLI through the child environment only. It is
 *   never placed in an argument vector and never echoed back.
 * - Give the child a minimal environment built from scratch, so unrelated
 *   WordPress secrets cannot reach the CLI process.
 * - Cap input and output size, enforce a timeout, and clean up the whole
 *   child process group when the deadline passes.
 * - Sanitize every error string before it leaves this process.
 *
 * Operations:
 *   {"op":"create","first_frame":"/abs/path.png","last_frame":"/abs/path.png",
 *    "duration":5,"resolution":"720P","prompt":"..."}
 *   {"op":"status","task_id":"..."}
 *   {"op":"health"}
 *
 * Responses:
 *   {"ok":true,"op":"create","task_id":"..."}
 *   {"ok":true,"op":"status","status":"processing|succeeded|failed",
 *    "download_url":"","error":""}
 *   {"ok":true,"op":"health","enabled":true,"message":"...","task_quota":{}}
 *   {"ok":false,"op":"...","error":{"code":"...","message":"..."}}
 */

'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LIMITS = {
  inputBytes: 64 * 1024,
  stdoutBytes: 1024 * 1024,
  stderrBytes: 256 * 1024,
  promptChars: 20000,
  mediaBytes: 20 * 1024 * 1024,
  pathChars: 4096,
  taskIdChars: 200,
};

const ALLOWED_DURATIONS = [5, 10, 15];
const ALLOWED_RESOLUTIONS = ['480P', '720P'];
const ALLOWED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const DEFAULT_CLI = '/opt/portare-wan/node_modules/@wan-ai/cli/dist/index.js';
const CHILD_PATH = '/usr/local/bin:/usr/bin:/bin';
const TIME_BUDGET_MS = { create: 180000, status: 60000, health: 45000 };

/** The only request fields each operation accepts. Anything else is refused. */
const OP_FIELDS = {
  create: ['op', 'first_frame', 'last_frame', 'duration', 'resolution', 'prompt'],
  status: ['op', 'task_id'],
  health: ['op'],
};

/* ------------------------------------------------------------------ output */

function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

/**
 * Build one failure envelope.
 *
 * `ambiguous` marks an outcome the caller cannot classify. It is set for
 * every failure that happens after the provider may already have accepted
 * the request, so the caller never resubmits a possibly paid render.
 */
function fail(op, code, message, extra) {
  const error = { code, message: String(message || '') };
  if (extra && typeof extra === 'object') {
    for (const key of Object.keys(extra)) {
      error[key] = extra[key];
    }
  }
  return { ok: false, op, error };
}

/* --------------------------------------------------------------- redaction */
function redact(text, secret) {
  let out = String(text == null ? '' : text);
  if (secret) {
    out = out.split(secret).join('[redacted]');
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]');
  out = out.replace(/wan-sk\.[A-Za-z0-9._-]+/g, 'wan-sk.[redacted]');
  // Query strings on provider URLs carry signed parameters.
  out = out.replace(/(https?:\/\/[^\s?"'<>]*)\?[^\s"'<>]*/g, '$1?[redacted]');
  out = out.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
  if (out.length > 600) {
    out = out.slice(0, 600) + '…';
  }
  return out.trim();
}

/* ------------------------------------------------------------------ inputs */

function readStdin(cap) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    process.stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size > cap) {
        finish({ ok: false, message: 'The request was larger than this runner accepts.' });
        try {
          process.stdin.destroy();
        } catch (error) {
          /* ignore */
        }
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on('end', () => finish({ ok: true, data: Buffer.concat(chunks).toString('utf8') }));
    process.stdin.on('error', () => finish({ ok: false, message: 'The request could not be read.' }));
  });
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a media path handed to the CLI.
 *
 * The path must be an existing regular file with an allowed image extension
 * that lives inside the media root this runner was configured with.
 */
function validateMediaPath(candidate, mediaRoot) {
  if (typeof candidate !== 'string' || candidate === '') {
    return 'A frame image path is missing.';
  }
  if (candidate.length > LIMITS.pathChars) {
    return 'A frame image path is too long.';
  }
  if (/[\u0000-\u001f]/.test(candidate)) {
    return 'A frame image path contains control characters.';
  }
  if (!path.isAbsolute(candidate)) {
    return 'A frame image path must be absolute.';
  }
  const extension = path.extname(candidate).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(extension)) {
    return 'A frame image must be a PNG, JPEG or WebP file.';
  }
  let root = '';
  let resolved = '';
  try {
    root = fs.realpathSync(mediaRoot);
    resolved = fs.realpathSync(candidate);
  } catch (error) {
    return 'A frame image could not be read on this server.';
  }
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return 'A frame image is outside the allowed media folder.';
  }
  let stats = null;
  try {
    stats = fs.statSync(resolved);
  } catch (error) {
    return 'A frame image could not be read on this server.';
  }
  if (!stats.isFile()) {
    return 'A frame image is not a readable file.';
  }
  if (stats.size > LIMITS.mediaBytes) {
    return 'A frame image is larger than the provider accepts.';
  }
  return '';
}

/* -------------------------------------------------------------- cli result */

function interpretCliJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

/** Map the provider status value onto the CLI's own label vocabulary. */
function deriveStatusLabel(raw) {
  if (raw === -1) return 'queued_relax';
  if (raw === 0) return 'queued';
  if (raw === 1) return 'processing';
  if (raw === 2 || raw === 'completed') return 'succeeded';
  if (raw === 'failed' || (typeof raw === 'number' && raw > 2)) return 'failed';
  if (raw === 'processing' || raw === 'thinking') return 'processing';
  if (raw === 'succeeded' || raw === 'success') return 'succeeded';
  return 'unknown';
}

/** Pull the provider download URL out of a task result. */
function extractDownloadUrl(result) {
  let items = [];
  if (Array.isArray(result)) {
    items = result;
  } else if (typeof result === 'string') {
    items = [result];
  } else if (isPlainObject(result)) {
    items = [result];
  }
  for (const item of items) {
    if (typeof item === 'string') {
      if (/^https?:\/\//i.test(item)) return item;
      continue;
    }
    if (!isPlainObject(item)) continue;
    // The CLI prefers the watermark-free downloadUrl, then the watermarked
    // variant, then a plain url field.
    for (const key of ['downloadUrl', 'downloadUrlWithLogo', 'url']) {
      const value = item[key];
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    }
  }
  return '';
}

/**
 * Map a CLI error envelope onto a message an operator can act on.
 */
function providerErrorMessage(json) {
  const code = typeof json.errorCode === 'string' ? json.errorCode : '';
  const raw = typeof json.errorMsg === 'string' ? json.errorMsg : '';
  const details = isPlainObject(json.details) ? json.details : {};
  const detailCode = typeof details.errorCode === 'string' ? details.errorCode : '';
  const detailMessage = typeof details.errorMsg === 'string' ? details.errorMsg : '';

  if (code === '4018' || detailCode === '4018') {
    return 'The Wan account is not a member of the plan the CLI requires, so the request was rejected. A Wan membership is required before this site can generate clips.';
  }
  if (code === 'LOCAL_FILE_VALIDATION_FAILED' || detailCode === 'LOCAL_FILE_VALIDATION_FAILED') {
    const issue = typeof details.issue === 'string' ? details.issue : '';
    const suggestion = isPlainObject(details.suggestedFix) ? details.suggestedFix : {};
    const action = typeof suggestion.action === 'string' ? suggestion.action : '';
    const parts = [];
    if (issue) parts.push(issue);
    if (action === 'convert_format') parts.push('convert the frame to PNG, JPEG or WebP and try again');
    if (action === 'scale_down' || action === 'reduce_file_size') parts.push('use a smaller frame image');
    return 'The provider rejected one of the frame images' + (parts.length ? ': ' + parts.join('; ') : '.');
  }
  if (code === '50001') {
    return 'The Wan account has no usable inspiration points left for this render.';
  }
  if (code === '50004') {
    return 'The Wan request would enter a holding path the CLI does not support. Check the account credits and the queue state.';
  }
  if (code === '4007' || code === '50000' || code === '100101') {
    return 'The Wan queue already holds too many in-flight tasks. Wait for the running tasks to finish and try again.';
  }
  if (code === '9005' || code === '9006' || code === '9010' || code === '9013') {
    return 'The provider rejected the request parameters: ' + (raw || detailMessage || 'the frame images were not accepted.');
  }
  if (code === '9007' || code === '9008' || code === '9012' || code === '10017') {
    return 'The provider rejected the frame images on content safety grounds. Choose different setup images.';
  }
  if (code === '10003') {
    return 'The Wan account does not have permission for this feature.';
  }
  if (raw) return 'The provider rejected the request: ' + raw;
  if (detailMessage) return 'The provider rejected the request: ' + detailMessage;
  return 'The provider rejected the request.';
}

/**
 * Provider error codes that mean the request was definitely refused.
 *
 * Only these are treated as a definite rejection. An error the runner does
 * not recognise may be a transport failure after the provider already
 * accepted the render, so it is treated as an unknown outcome.
 */
const DEFINITIVE_PROVIDER_CODES = new Set([
  '4018',
  'LOCAL_FILE_VALIDATION_FAILED',
  '50001',
  '50004',
  '4007',
  '50000',
  '100101',
  '9005',
  '9006',
  '9010',
  '9013',
  '9007',
  '9008',
  '9012',
  '10017',
  '10003',
]);

/**
 * Did the provider definitely refuse the request?
 *
 * @param {object} json Parsed CLI answer.
 * @returns {boolean} True only for a known, definite rejection.
 */
function isDefinitiveProviderError(json) {
  const code = typeof json.errorCode === 'string' ? json.errorCode : '';
  const details = isPlainObject(json.details) ? json.details : {};
  const detailCode = typeof details.errorCode === 'string' ? details.errorCode : '';
  if (DEFINITIVE_PROVIDER_CODES.has(code) || DEFINITIVE_PROVIDER_CODES.has(detailCode)) {
    return true;
  }
  return false;
}

/* ------------------------------------------------------------- child spawn */

/**
 * Run the pinned CLI with a fixed argument vector.
 *
 * The child receives a minimal environment built from scratch. It never sees
 * the environment of the WordPress process.
 */
function runCli(args, options) {
  const opts = options || {};
  const env = opts.env || {};
  const timeoutMs = opts.timeoutMs || 60000;
  const spawnFn = opts.spawnFn || spawn;
  const nodeBin = opts.nodeBin || process.execPath;

  return new Promise((resolve) => {
    let child = null;
    try {
      child = spawnFn(nodeBin, [opts.cli].concat(args), {
        cwd: opts.cwd || os.tmpdir(),
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      resolve({ ok: false, code: 'runner_spawn_failed', message: 'The Wan runtime could not be started.', exitCode: null, stdout: '', stderr: '' });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let overflow = false;
    let settled = false;

    const kill = () => {
      // Only the group this runner started is killed. The child is spawned
      // detached, so its pid is the group id of that group alone.
      const pid = child && typeof child.pid === 'number' ? child.pid : 0;
      if (pid > 0) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch (error) {
          /* the group may already be gone */
        }
      }
      try {
        child.kill('SIGKILL');
      } catch (error) {
        /* ignore */
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);

    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.removeListener('SIGTERM', onTermination);
      process.removeListener('SIGINT', onTermination);
      resolve(result);
    };

    // PHP can terminate this runner before its own CLI deadline. Because the
    // CLI has an isolated process group, forward cancellation only to that
    // group; otherwise a detached paid submission could outlive its owner.
    const onTermination = () => {
      timedOut = true;
      kill();
    };
    process.once('SIGTERM', onTermination);
    process.once('SIGINT', onTermination);

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        if (stdout.length + chunk.length > LIMITS.stdoutBytes) {
          overflow = true;
          kill();
          return;
        }
        stdout += chunk.toString('utf8');
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        if (stderr.length + chunk.length > LIMITS.stderrBytes) {
          overflow = true;
          kill();
          return;
        }
        stderr += chunk.toString('utf8');
      });
    }
    child.on('error', () => {
      settle({ ok: false, code: 'runner_spawn_failed', message: 'The Wan runtime could not be started.', exitCode: null, stdout, stderr });
    });
    child.on('close', (code) => {
      settle({ ok: true, exitCode: code, stdout, stderr, timedOut, overflow });
    });
  });
}

/* ------------------------------------------------------------- operations */

function buildCreateArgs(payload) {
  return [
    'frame2video',
    '--first-frame', payload.first_frame,
    '--last-frame', payload.last_frame,
    '--duration', String(payload.duration),
    '--resolution', payload.resolution,
    '--audio-output=false',
    '--prompt', payload.prompt,
    '--output', 'json',
  ];
}

function buildStatusArgs(payload) {
  return ['result', 'get', payload.task_id, '--output', 'json'];
}

function buildHealthArgs() {
  return ['auth', 'status', '--output', 'json'];
}

function buildCreditsArgs() {
  return ['credits', '--output', 'json'];
}

async function opCreate(payload, ctx) {
  if (typeof payload.duration !== 'number' || !Number.isInteger(payload.duration) || !ALLOWED_DURATIONS.includes(payload.duration)) {
    return fail('create', 'invalid_request', 'The requested clip duration is not supported.');
  }
  if (typeof payload.resolution !== 'string' || !ALLOWED_RESOLUTIONS.includes(payload.resolution)) {
    return fail('create', 'invalid_request', 'The requested clip resolution is not supported.');
  }
  if (typeof payload.prompt !== 'string' || payload.prompt.length > LIMITS.promptChars) {
    return fail('create', 'invalid_request', 'The prompt is not acceptable.');
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(payload.prompt)) {
    return fail('create', 'invalid_request', 'The prompt contains control characters.');
  }
  const mediaRoot = ctx.env.PPG_WAN_MEDIA_ROOT || '';
  if (!mediaRoot) {
    return fail('create', 'media_root_missing', 'The media folder for this site is not configured.');
  }
  const firstError = validateMediaPath(payload.first_frame, mediaRoot);
  if (firstError) return fail('create', 'invalid_media', firstError);
  const lastError = validateMediaPath(payload.last_frame, mediaRoot);
  if (lastError) return fail('create', 'invalid_media', lastError);
  if (path.resolve(payload.first_frame) === path.resolve(payload.last_frame)) {
    return fail('create', 'invalid_media', 'The first and the last frame must be different images.');
  }

  const result = await runCli(buildCreateArgs(payload), {
    cli: ctx.cli,
    env: ctx.childEnv,
    cwd: ctx.home,
    timeoutMs: ctx.budget.create,
    spawnFn: ctx.spawnFn,
    nodeBin: ctx.nodeBin,
  });

  if (!result.ok) {
    return fail('create', result.code, result.message, { ambiguous: result.code !== 'runner_spawn_failed' });
  }
  if (result.overflow) {
    return fail('create', 'runner_output_too_large', 'The provider returned more data than this runner accepts.', { ambiguous: true });
  }
  if (result.timedOut) {
    return fail('create', 'runner_timeout', 'The provider did not answer in time. The render may or may not have started.', { ambiguous: true });
  }

  const json = interpretCliJson(result.stdout);
  if (!json) {
    const detail = redact(result.stderr || result.stdout, ctx.secret);
    return fail('create', 'provider_unreadable', 'The provider did not return a usable answer.' + (detail ? ' ' + detail : ''), { ambiguous: true });
  }
  if (json.ok === false || (typeof json.errorCode === 'string' && json.errorCode)) {
    // Only a known rejection is a definite failure. An error this runner
    // does not recognise may be a transport failure after the provider
    // already accepted the render.
    const definitive = isDefinitiveProviderError(json);
    return fail(
      'create',
      definitive ? 'provider_rejected' : 'provider_unreadable',
      providerErrorMessage(json),
      { ambiguous: !definitive }
    );
  }
  const taskId = typeof json.taskId === 'string' ? json.taskId.trim() : '';
  if (!taskId) {
    return fail('create', 'provider_unreadable', 'The provider did not return a task reference.', { ambiguous: true });
  }
  return { ok: true, op: 'create', task_id: taskId };
}

async function opStatus(payload, ctx) {
  if (typeof payload.task_id !== 'string' || !payload.task_id || payload.task_id.length > LIMITS.taskIdChars) {
    return fail('status', 'invalid_request', 'The task reference is not acceptable.');
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(payload.task_id)) {
    return fail('status', 'invalid_request', 'The task reference is not acceptable.');
  }

  const result = await runCli(buildStatusArgs(payload), {
    cli: ctx.cli,
    env: ctx.childEnv,
    cwd: ctx.home,
    timeoutMs: ctx.budget.status,
    spawnFn: ctx.spawnFn,
    nodeBin: ctx.nodeBin,
  });

  if (!result.ok) {
    return fail('status', result.code, result.message);
  }
  if (result.overflow) {
    return fail('status', 'runner_output_too_large', 'The provider returned more data than this runner accepts.');
  }
  if (result.timedOut) {
    return fail('status', 'runner_timeout', 'The provider did not answer in time.');
  }

  const json = interpretCliJson(result.stdout);
  if (!json) {
    const detail = redact(result.stderr || result.stdout, ctx.secret);
    return fail('status', 'provider_unreadable', 'The provider did not return a usable answer.' + (detail ? ' ' + detail : ''));
  }
  if (json.ok === false && typeof json.errorCode === 'string' && json.errorCode && !json.statusLabel) {
    return fail('status', 'provider_error', providerErrorMessage(json));
  }

  const label = typeof json.statusLabel === 'string' && json.statusLabel ? json.statusLabel : deriveStatusLabel(json.status);
  let status = 'processing';
  if (label === 'succeeded') status = 'succeeded';
  else if (label === 'failed') status = 'failed';

  const error = typeof json.errorMsg === 'string' ? redact(json.errorMsg, ctx.secret) : '';
  const downloadUrl = status === 'succeeded' ? extractDownloadUrl(json.result) : '';
  return { ok: true, op: 'status', status, download_url: downloadUrl, error };
}

/**
 * Read-only provider probe: authentication state and the credit balance.
 */
async function opHealth(payload, ctx) {
  const auth = await runCli(buildHealthArgs(), {
    cli: ctx.cli,
    env: ctx.childEnv,
    cwd: ctx.home,
    timeoutMs: ctx.budget.health,
    spawnFn: ctx.spawnFn,
    nodeBin: ctx.nodeBin,
  });

  if (!auth.ok) {
    return fail('health', auth.code, auth.message);
  }
  if (auth.timedOut) {
    return fail('health', 'runner_timeout', 'The provider did not answer in time.');
  }
  if (auth.overflow) {
    return fail('health', 'runner_output_too_large', 'The provider returned more data than this runner accepts.');
  }

  const authJson = interpretCliJson(auth.stdout);
  if (!authJson) {
    const detail = redact(auth.stderr || auth.stdout, ctx.secret);
    return fail('health', 'provider_unreadable', 'The provider did not return a usable answer.' + (detail ? ' ' + detail : ''));
  }
  if (authJson.ok === false && typeof authJson.errorCode === 'string' && authJson.errorCode) {
    return fail('health', 'provider_error', providerErrorMessage(authJson));
  }

  const enabled = authJson.authenticated === true;
  const quota = isPlainObject(authJson.data) && isPlainObject(authJson.data.taskQuota) ? authJson.data.taskQuota : null;
  const taskQuota = {};
  if (quota) {
    for (const key of ['image', 'video']) {
      if (typeof quota[key] === 'number' && Number.isFinite(quota[key])) {
        taskQuota[key] = quota[key];
      }
    }
  }

  // Credits are advisory. A failure here must not fail the health check.
  let creditMessage = '';
  const credits = await runCli(buildCreditsArgs(), {
    cli: ctx.cli,
    env: ctx.childEnv,
    cwd: ctx.home,
    timeoutMs: ctx.budget.health,
    spawnFn: ctx.spawnFn,
    nodeBin: ctx.nodeBin,
  });
  if (credits.ok && !credits.timedOut && !credits.overflow) {
    const creditsJson = interpretCliJson(credits.stdout);
    if (creditsJson && !(creditsJson.ok === false && typeof creditsJson.errorCode === 'string' && creditsJson.errorCode)) {
      creditMessage = 'The account credit balance was read.';
    }
  }

  const message = enabled
    ? 'The Wan credential is configured and the provider accepted it.' + (creditMessage ? ' ' + creditMessage : '')
    : 'The provider did not accept the configured Wan credential.';

  const response = { ok: true, op: 'health', enabled, message };
  if (Object.keys(taskQuota).length) {
    response.task_quota = taskQuota;
  }
  return response;
}

/* -------------------------------------------------------------- dispatcher */

/**
 * Validate the request, then run the matching operation.
 *
 * `deps.spawnFn` exists so the offline tests can drive the runner without a
 * live provider.
 */
async function handle(request, deps) {
  const options = deps || {};
  const env = options.env || process.env;
  const secret = typeof env.WAN_ACCESS_KEY === 'string' ? env.WAN_ACCESS_KEY : '';

  if (!isPlainObject(request)) {
    return fail('unknown', 'invalid_request', 'The request is not a JSON object.');
  }
  const op = request.op;
  if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(OP_FIELDS, op)) {
    return fail('unknown', 'unknown_operation', 'This runner does not support that operation.');
  }

  const allowed = OP_FIELDS[op];
  for (const key of Object.keys(request)) {
    if (!allowed.includes(key)) {
      return fail(op, 'unknown_field', 'The request contained a field this runner does not accept.');
    }
  }

  if (!secret) {
    return fail(op, 'missing_credential', 'The Wan credential is not configured on this server.');
  }

  const cli = typeof env.PPG_WAN_CLI === 'string' && env.PPG_WAN_CLI ? env.PPG_WAN_CLI : DEFAULT_CLI;
  if (!fs.existsSync(cli)) {
    return fail(op, 'runtime_missing', 'The Wan command line runtime is not installed on this server.');
  }

  const nodeBin = typeof env.PPG_WAN_NODE === 'string' && env.PPG_WAN_NODE ? env.PPG_WAN_NODE : process.execPath;

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ppg-wan-'));
  const childEnv = {
    PATH: CHILD_PATH,
    HOME: home,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    WAN_ACCESS_KEY: secret,
    WAN_CONFIG_DIR: path.join(home, 'wan-config'),
    WAN_LANG: 'en',
    WAN_OUTPUT: 'json',
  };
  if (typeof env.WAN_SITE === 'string' && env.WAN_SITE) {
    childEnv.WAN_SITE = env.WAN_SITE;
  }
  // The CLI reads this from its own environment. It is never forwarded from
  // the WordPress process, and the request body can never change it.
  if (typeof env.PPG_WAN_MEDIA_ROOT === 'string' && env.PPG_WAN_MEDIA_ROOT) {
    childEnv.PPG_WAN_MEDIA_ROOT = env.PPG_WAN_MEDIA_ROOT;
  }

  const ctx = {
    cli,
    nodeBin,
    childEnv,
    home,
    secret,
    env,
    budget: Object.assign({}, TIME_BUDGET_MS, options.budget || {}),
    spawnFn: options.spawnFn,
  };

  try {
    if (op === 'create') return await opCreate(request, ctx);
    if (op === 'status') return await opStatus(request, ctx);
    return await opHealth(request, ctx);
  } finally {
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch (error) {
      /* ignore */
    }
  }
}

/* -------------------------------------------------------------------- main */

async function main() {
  const read = await readStdin(LIMITS.inputBytes);
  if (!read.ok) {
    emit(fail('unknown', 'invalid_request', read.message));
    process.exitCode = 1;
    return;
  }
  let request = null;
  try {
    request = JSON.parse(read.data);
  } catch (error) {
    emit(fail('unknown', 'invalid_json', 'The request was not valid JSON.'));
    process.exitCode = 1;
    return;
  }
  const result = await handle(request, {});
  emit(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(() => {
    emit(fail('unknown', 'runner_failed', 'The Wan runtime failed unexpectedly.'));
    process.exitCode = 1;
  });
}

module.exports = {
  ALLOWED_DURATIONS,
  ALLOWED_RESOLUTIONS,
  ALLOWED_IMAGE_EXTENSIONS,
  DEFAULT_CLI,
  LIMITS,
  OP_FIELDS,
  buildCreateArgs,
  buildStatusArgs,
  buildHealthArgs,
  buildCreditsArgs,
  deriveStatusLabel,
  extractDownloadUrl,
  handle,
  interpretCliJson,
  providerErrorMessage,
  redact,
  runCli,
  validateMediaPath,
};

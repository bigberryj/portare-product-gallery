/* Portare setup media: per-product setup pictures, a 15 second image sequence and
   a video area rendered under the product description.

   This area is deliberately independent from the main gallery filmstrip: it owns its
   own DOM, its own state and its own playback registry. Nothing here rewrites the
   authored product copy and nothing here infers folding motion - a sequence is a
   timed presentation of the selected still images.

   Public API (window.PortareSetupMedia):
     init(container)                 initialize every setup root inside container
     destroy(root)                   release one setup root (timers, listeners, media)
     createPreview(data)             build a safe preview element for the admin panel
     buildTimeline(count, options)   deterministic timeline helper (also used by export)
     sampleTimeline(timeline, ms)    frame opacities/scales at a point in time
     validateMediaUrl(url)           media URL guard used by preview and export
     supportsMp4Export()             browser MP4 recording capability report
     exportVideo(options)            record a real 15s MP4 with Canvas + MediaRecorder
*/
(function () {
  'use strict';

  const DURATION = 15000;            // fixed setup sequence / export length
  const MIN_SEQUENCE_IMAGES = 2;
  const MAX_IMAGES = 4;
  const EXPORT_WIDTH = 1280;
  const EXPORT_HEIGHT = 720;
  const EXPORT_FPS = 30;
  // The gentle zoom never reaches the frame edges: the picture is inset by 3%
  // (94% of the stage) and the zoom stops at 1.06 (94% * 1.06 = 99.64%), so a
  // contained diagram is never cropped.
  const ZOOM_MAX = 1.06;
  const FRAME_INSET = 0.94;
  const IMAGE_LOAD_TIMEOUT = 15000;
  const EXPORT_TIMEOUT_MARGIN = 10000;
  const OBSERVER_WINDOW = 60000;
  const FADE_MAX = 700;

  const instances = new Map();       // root element -> instance
  let owner = null;                  // the single active setup playback (any instance)

  /* ---------------------------------------------------------------- helpers */

  function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) { return false; }
  }

  function baseUrl() {
    try { return document.baseURI || 'https://example.invalid/'; } catch (_) { return 'https://example.invalid/'; }
  }

  /** Only http(s) and root relative URLs are accepted for setup media. */
  function validateMediaUrl(url) {
    if (typeof url !== 'string') return false;
    const value = url.trim();
    if (!value || value.length > 2048) return false;
    if (/[\u0000-\u001f\u007f]/.test(value)) return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      let parsed = null;
      try { parsed = new URL(value); } catch (_) { return false; }
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    }
    if (value.charAt(0) === '/') return value.charAt(1) !== '/';
    if (value.charAt(0) === '.' || value.charAt(0) === '?') return true;
    try { new URL(value, baseUrl()); } catch (_) { return false; }
    return true;
  }

  /** JSON that is safe to place inside a script element. */
  function safeJson(value) {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function raf(callback) {
    if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(callback);
    return window.setTimeout(() => callback(now()), 16);
  }

  function caf(handle) {
    if (handle === null || handle === undefined) return;
    if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(handle);
    else window.clearTimeout(handle);
  }

  function now() {
    if (window.performance && typeof window.performance.now === 'function') return window.performance.now();
    return Date.now();
  }

  function stopStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    try { stream.getTracks().forEach(track => { if (track && typeof track.stop === 'function') track.stop(); }); } catch (_) { /* ignore */ }
  }

  /* --------------------------------------------------------------- timeline */

  /**
   * Deterministic timeline for N images over the fixed setup duration.
   * Frame i is visible from start to end; consecutive frames crossfade over the
   * `fade` window that precedes the next frame's start. The last frame holds.
   */
  function buildTimeline(count, options) {
    const opts = options || {};
    const total = clamp(Math.round(Number(count) || 0), 0, MAX_IMAGES);
    const duration = DURATION;
    const reduced = !!opts.reducedMotion;
    const motion = !reduced && !!opts.motion;
    const segment = total > 0 ? duration / total : duration;
    const fade = reduced || total < 2 ? 0 : Math.min(FADE_MAX, Math.max(120, Math.round(segment / 4)));
    const zoomMax = motion ? ZOOM_MAX : 1;
    const frames = [];
    for (let i = 0; i < total; i++) {
      const start = i * segment;
      const end = (i + 1) * segment;
      const fadeOut = i === total - 1 ? null : { start: end - fade, end: end };
      frames.push({ index: i, start: start, end: end, fadeOut: fadeOut });
    }
    return { duration: duration, count: total, segment: segment, fade: fade, motion: motion, zoomMax: zoomMax, frames: frames };
  }

  /** Opacity of one frame at a point in time (0 - 1). */
  function frameOpacity(frame, time, fade) {
    // Consecutive frames overlap by exactly one fade window: the next frame
    // fades in while the current one fades out. The first frame is already
    // fully visible at t=0 so a paused sequence never shows a blank stage.
    const inStart = frame.index === 0 ? 0 : frame.start - fade;
    const inEnd = frame.index === 0 ? 0 : frame.start;
    const outStart = frame.fadeOut ? frame.fadeOut.start : null;
    const outEnd = frame.fadeOut ? frame.fadeOut.end : frame.end;
    if (time < inStart) return 0;
    if (time > outEnd) return 0;
    if (fade <= 0) return time >= frame.start ? 1 : 0;
    let opacity = 1;
    if (time < inEnd) opacity = Math.min(opacity, (time - inStart) / fade);
    if (outStart !== null && time > outStart) opacity = Math.min(opacity, 1 - (time - outStart) / fade);
    return clamp(opacity, 0, 1);
  }

  /** Frame states (opacity + gentle zoom scale) at a point in time. */
  function sampleTimeline(timeline, time) {
    if (!timeline || !timeline.frames) return [];
    const t = clamp(Number(time) || 0, 0, timeline.duration);
    // The zoom is continuous across the whole sequence so it never jumps when
    // the visible frame changes.
    const zoom = timeline.motion ? 1 + (timeline.zoomMax - 1) * (t / timeline.duration) : 1;
    const states = [];
    timeline.frames.forEach(frame => {
      const opacity = frameOpacity(frame, t, timeline.fade);
      if (opacity <= 0) return;
      states.push({ index: frame.index, opacity: opacity, scale: zoom });
    });
    return states;
  }

  /* ------------------------------------------------------------ normalising */

  function normalizeData(data) {
    const raw = data && typeof data === 'object' ? data : {};
    const mode = ['pictures', 'sequence', 'video'].indexOf(raw.mode) >= 0 ? raw.mode : 'pictures';
    const images = (Array.isArray(raw.images) ? raw.images : [])
      .filter(image => image && typeof image === 'object' && validateMediaUrl(image.src))
      .slice(0, MAX_IMAGES)
      .map((image, index) => ({
        id: image.id === undefined || image.id === null ? '' : String(image.id),
        src: String(image.src),
        alt: typeof image.alt === 'string' ? image.alt : ''
      }));
    return {
      mode: mode,
      images: images,
      motion: raw.motion ? 1 : 0,
      duration: DURATION,
      productId: raw.productId === undefined || raw.productId === null ? '' : String(raw.productId),
      heading: typeof raw.heading === 'string' ? raw.heading : '',
      caption: typeof raw.caption === 'string' ? raw.caption : '',
      videoUrl: validateMediaUrl(raw.videoUrl) ? raw.videoUrl : '',
      posterUrl: validateMediaUrl(raw.posterUrl) ? raw.posterUrl : ''
    };
  }

  /* --------------------------------------------------------------- preview */

  function appendImage(parent, image) {
    const element = document.createElement('img');
    element.className = 'ppg-setup-picture';
    element.setAttribute('loading', 'lazy');
    element.setAttribute('decoding', 'async');
    element.alt = image.alt || '';
    if (image.width) element.setAttribute('width', String(image.width));
    if (image.height) element.setAttribute('height', String(image.height));
    element.src = image.src;
    parent.appendChild(element);
    return element;
  }

  /** Build a complete, safe setup section for the admin preview area. */
  function createPreview(data) {
    const payload = normalizeData(data);
    const section = document.createElement('section');
    section.className = 'ppg-setup';
    section.setAttribute('data-ppg-setup', '');
    section.setAttribute('data-mode', payload.mode);
    section.setAttribute('data-motion', String(payload.motion));
    if (payload.productId) section.setAttribute('data-product-id', payload.productId);

    if (payload.heading) {
      const heading = document.createElement('h3');
      heading.className = 'ppg-setup-heading';
      heading.textContent = payload.heading;
      section.appendChild(heading);
    }

    if (payload.mode === 'pictures') {
      const pictures = document.createElement('div');
      pictures.className = 'ppg-setup-pictures';
      payload.images.forEach(image => appendImage(pictures, image));
      section.appendChild(pictures);
    } else if (payload.mode === 'sequence') {
      const stage = document.createElement('div');
      stage.className = 'ppg-setup-stage';
      payload.images.forEach((image, index) => {
        const frame = document.createElement('img');
        frame.className = 'ppg-setup-frame';
        frame.setAttribute('decoding', 'async');
        frame.alt = image.alt || '';
        frame.setAttribute('data-index', String(index));
        frame.src = image.src;
        stage.appendChild(frame);
      });
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'ppg-setup-play';
      play.setAttribute('aria-pressed', 'false');
      play.setAttribute('aria-label', 'Play setup sequence');
      play.textContent = '▶';
      stage.appendChild(play);
      section.appendChild(stage);
    } else {
      if (payload.videoUrl) {
        const video = document.createElement('video');
        video.className = 'ppg-setup-video';
        video.setAttribute('controls', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('preload', 'metadata');
        if (payload.posterUrl) video.setAttribute('poster', payload.posterUrl);
        video.src = payload.videoUrl;
        section.appendChild(video);
      } else {
        const note = document.createElement('p');
        note.className = 'ppg-setup-note';
        note.textContent = 'Choose a setup video to preview it here.';
        section.appendChild(note);
      }
    }

    if (payload.caption) {
      const caption = document.createElement('p');
      caption.className = 'ppg-setup-caption';
      caption.textContent = payload.caption;
      section.appendChild(caption);
    }

    const script = document.createElement('script');
    script.type = 'application/json';
    script.className = 'ppg-setup-data';
    script.textContent = safeJson({
      mode: payload.mode,
      images: payload.images.map(image => ({ id: image.id, src: image.src, alt: image.alt })),
      motion: payload.motion,
      duration: DURATION,
      productId: payload.productId
    });
    section.appendChild(script);
    return section;
  }

  /* ---------------------------------------------------------------- player */

  function createInstance(root, data) {
    const motion = data.motion ? 1 : 0;
    const frames = Array.prototype.slice.call(root.querySelectorAll('.ppg-setup-stage img.ppg-setup-frame'));
    const playButton = root.querySelector('.ppg-setup-play');
    const video = root.querySelector('video.ppg-setup-video');
    const listeners = [];
    const instance = {
      root: root,
      data: data,
      frames: frames,
      video: video,
      destroyed: false,
      playing: false,
      timeline: buildTimeline(frames.length, { motion: motion, reducedMotion: prefersReducedMotion() }),
      reduced: prefersReducedMotion(),
      elapsed: 0,
      resumeAt: 0,
      startedAt: null,
      handle: null
    };

    function on(target, event, callback, options) {
      target.addEventListener(event, callback, options);
      listeners.push(() => target.removeEventListener(event, callback, options));
    }

    function updateButton() {
      if (!playButton) return;
      playButton.setAttribute('aria-pressed', String(instance.playing));
      playButton.setAttribute('aria-label', instance.playing ? 'Pause setup sequence' : 'Play setup sequence');
      playButton.setAttribute('data-playing', String(instance.playing));
    }

    function apply(time) {
      const states = sampleTimeline(instance.timeline, time);
      frames.forEach((frame, index) => {
        const state = states.find(item => item.index === index);
        const opacity = state ? state.opacity : 0;
        frame.style.opacity = String(opacity);
        frame.style.setProperty('--ppg-setup-zoom', state ? String(state.scale) : '1');
        frame.style.zIndex = String(index);
        if (opacity > 0) frame.removeAttribute('aria-hidden');
        else frame.setAttribute('aria-hidden', 'true');
      });
    }

    function tick(timestamp) {
      if (instance.destroyed) return;
      instance.handle = raf(tick);
      if (instance.startedAt === null) instance.startedAt = timestamp - instance.resumeAt;
      const time = timestamp - instance.startedAt;
      if (time >= instance.timeline.duration) {
        instance.elapsed = instance.timeline.duration;
        apply(instance.timeline.duration);
        pause();
        return;
      }
      instance.elapsed = time;
      apply(time);
    }

    function play() {
      if (instance.destroyed || instance.playing) return;
      if (frames.length < MIN_SEQUENCE_IMAGES) return;
      if (instance.elapsed >= instance.timeline.duration) { instance.elapsed = 0; apply(0); }
      claim(instance);
      instance.playing = true;
      instance.resumeAt = instance.elapsed;
      instance.startedAt = null;
      instance.handle = raf(tick);
      updateButton();
    }

    function pause() {
      if (!instance.playing) {
        instance.handle = null;
        return;
      }
      instance.playing = false;
      caf(instance.handle);
      instance.handle = null;
      instance.startedAt = null;
      updateButton();
    }

    function pauseVideo() {
      if (video && typeof video.pause === 'function') {
        try { video.pause(); } catch (_) { /* ignore */ }
      }
    }

    instance.play = play;
    instance.pause = pause;
    instance.pauseAll = function () { pause(); pauseVideo(); };
    instance.destroy = function () {
      if (instance.destroyed) return;
      instance.destroyed = true;
      pause();
      pauseVideo();
      caf(instance.handle);
      instance.handle = null;
      listeners.forEach(remove => remove());
      listeners.length = 0;
      root.classList.remove('ppg-setup-initialized');
      if (owner === instance) owner = null;
      instances.delete(root);
    };

    function mediaFailed() {
      instance.pauseAll();
      if (playButton) playButton.disabled = true;
      let error = root.querySelector('.ppg-setup-load-error');
      if (!error) {
        error = document.createElement('p'); error.className = 'ppg-setup-note ppg-setup-load-error';
        error.setAttribute('role', 'alert'); error.textContent = 'The setup media could not be loaded. Please try again later.';
        root.appendChild(error);
      }
      const gallery = root.closest('[data-ppg]');
      if (gallery) gallery.querySelectorAll('[data-ppg-setup-original]').forEach(original => {
        original.hidden = false; original.style.removeProperty('display');
      });
    }
    root.querySelectorAll('img').forEach(image => {
      on(image, 'error', mediaFailed);
      if (image.complete && image.naturalWidth === 0) mediaFailed();
    });
    if (video) on(video, 'error', mediaFailed);
    if (playButton) {
      on(playButton, 'click', () => { if (instance.playing) pause(); else play(); });
    }
    if (video) {
      on(video, 'play', () => { claim(instance); });
      on(video, 'ended', () => { if (owner === instance) owner = null; });
    }
    try {
      const query = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
      if (query && typeof query.addEventListener === 'function') {
        on(query, 'change', () => {
          instance.reduced = prefersReducedMotion();
          instance.timeline = buildTimeline(frames.length, { motion: motion, reducedMotion: instance.reduced });
          if (!instance.playing) apply(instance.elapsed);
        });
      }
    } catch (_) { /* reduced motion changes are optional */ }

    if (data.mode === 'sequence' && frames.length >= MIN_SEQUENCE_IMAGES) {
      instance.elapsed = 0;
      apply(0);
    } else if (data.mode === 'sequence' && playButton) {
      playButton.disabled = true;
      playButton.setAttribute('aria-disabled', 'true');
      playButton.setAttribute('title', 'A setup sequence needs at least two images.');
    }
    updateButton();
    return instance;
  }

  /** Only one setup area plays at a time - duplicate sections and videos included. */
  function claim(next) {
    owner = next;
    instances.forEach(instance => { if (instance !== next) instance.pauseAll(); });
  }

  function initialize(root) {
    if (!root || instances.has(root)) return null;
    if (typeof root.matches !== 'function' || !root.matches('.ppg-setup[data-ppg-setup]')) return null;
    const dataNode = root.querySelector('script.ppg-setup-data');
    if (!dataNode) return null;
    let parsed = null;
    try { parsed = JSON.parse(dataNode.textContent || 'null'); } catch (_) { return null; }
    if (!parsed || typeof parsed !== 'object') return null;
    const data = normalizeData(parsed);
    const instance = createInstance(root, data);
    if (!instance) return null;
    instances.set(root, instance);
    root.classList.add('ppg-setup-initialized');
    return instance;
  }

  function scan(scope) {
    if (!scope) return;
    if (typeof scope.matches === 'function' && scope.matches('.ppg-setup[data-ppg-setup]')) initialize(scope);
    if (typeof scope.querySelectorAll !== 'function') return;
    scope.querySelectorAll('.ppg-setup[data-ppg-setup]').forEach(initialize);
  }

  /* ---------------------------------------------------------------- export */

  function supportsMp4Export() {
    if (typeof window.MediaRecorder !== 'function') {
      return { supported: false, mimeType: '', reason: 'This browser cannot record video (MediaRecorder is unavailable). Use a current Chrome or Edge browser.' };
    }
    if (typeof window.HTMLCanvasElement === 'undefined' || typeof window.HTMLCanvasElement.prototype.captureStream !== 'function') {
      return { supported: false, mimeType: '', reason: 'This browser cannot capture canvas frames for video export. Use a current Chrome or Edge browser.' };
    }
    const candidates = ['video/mp4;codecs=avc1.42001E', 'video/mp4'];
    for (let i = 0; i < candidates.length; i++) {
      try {
        if (window.MediaRecorder.isTypeSupported(candidates[i])) {
          return { supported: true, mimeType: candidates[i], reason: '' };
        }
      } catch (_) { /* try the next candidate */ }
    }
    return { supported: false, mimeType: '', reason: 'This browser cannot record MP4 video. MP4 recording needs a current Chrome or Edge browser over HTTPS.' };
  }

  function loadExportImages(images, signal) {
    return Promise.all(images.map(image => new Promise((resolve, reject) => {
      const element = new window.Image();
      let settled = false;
      const timer = window.setTimeout(() => finish(new Error('Timed out while loading ' + image.src + '.')), IMAGE_LOAD_TIMEOUT);
      function finish(error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        element.onload = null;
        element.onerror = null;
        if (error) reject(error); else resolve(element);
      }
      element.onload = () => {
        if (element.naturalWidth && element.naturalHeight) finish(null);
        else finish(new Error('An image could not be decoded: ' + image.src));
      };
      element.onerror = () => finish(new Error('An image could not be loaded: ' + image.src));
      element.decoding = 'async';
      element.crossOrigin = 'anonymous';
      element.src = image.src;
      if (signal && signal.aborted) finish(new Error('The recording was cancelled.'));
    })));
  }

  function drawTimeline(context, loaded, timeline, time, width, height) {
    context.save();
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    sampleTimeline(timeline, time).forEach(state => {
      const image = loaded[state.index];
      if (!image) return;
      const naturalWidth = image.naturalWidth || image.width || 1;
      const naturalHeight = image.naturalHeight || image.height || 1;
      // Contain fit on a white background: the whole diagram stays visible and
      // the gentle zoom never pushes it past the frame edges.
      const fit = Math.min(width / naturalWidth, height / naturalHeight) * FRAME_INSET * state.scale;
      const drawWidth = naturalWidth * fit;
      const drawHeight = naturalHeight * fit;
      context.globalAlpha = state.opacity;
      context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    });
    context.globalAlpha = 1;
    context.restore();
  }

  function cancelledError() {
    const error = new Error('The recording was cancelled. Nothing was saved.');
    error.cancelled = true;
    return error;
  }

  // Native recorders may emit a fragmented MP4 with zero-duration init headers.
  // Write the completed presentation duration into the standard movie/track/media
  // headers so WordPress/getID3 can read it without a server-side transcoder.
  async function finalizeMp4(blob, durationMs) {
    if (typeof blob.arrayBuffer !== 'function') return blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const duration = durationMs / 1000;
    let movieScale = 0;
    const children = (start, end) => {
      const result = []; let offset = start;
      while (offset + 8 <= end && result.length < 1000) {
        const size = view.getUint32(offset); const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
        if (size < 8 || offset + size > end) break;
        result.push({type, payload:offset + 8, end:offset + size}); offset += size;
      }
      return result;
    };
    const updateDuration = (atom, scale, mediaHeader) => {
      const p = atom.payload; const version = bytes[p];
      const scaleOffset = p + (version === 1 ? 20 : 12);
      const durationOffset = p + (mediaHeader ? (version === 1 ? 24 : 16) : (version === 1 ? 28 : 20));
      if (version > 1 || durationOffset + (version === 1 ? 8 : 4) > atom.end) return 0;
      if (mediaHeader) scale = view.getUint32(scaleOffset);
      const value = Math.round(duration * scale);
      if (!scale || !Number.isSafeInteger(value) || value < 0) return 0;
      if (version === 1) { view.setUint32(durationOffset, Math.floor(value / 4294967296)); view.setUint32(durationOffset + 4, value % 4294967296); }
      else if (value <= 4294967295) view.setUint32(durationOffset, value);
      return scale;
    };
    const movie = children(0, bytes.length).find(atom => atom.type === 'moov');
    if (movie) {
      const parts = children(movie.payload, movie.end);
      const header = parts.find(atom => atom.type === 'mvhd');
      if (header) movieScale = updateDuration(header, 0, true);
      parts.filter(atom => atom.type === 'trak').forEach(track => {
        const trackParts = children(track.payload, track.end);
        const trackHeader = trackParts.find(atom => atom.type === 'tkhd');
        if (trackHeader && movieScale) updateDuration(trackHeader, movieScale, false);
        const media = trackParts.find(atom => atom.type === 'mdia');
        const mediaHeader = media && children(media.payload, media.end).find(atom => atom.type === 'mdhd');
        if (mediaHeader) updateDuration(mediaHeader, 0, true);
      });
    }
    return new Blob([bytes], {type:'video/mp4'});
  }

  /**
   * Record a real 15 second MP4 with Canvas + MediaRecorder.
   * The promise resolves only after the recorder produced a complete file, so a
   * cancelled or failed recording can never be mistaken for a finished video.
   */
  function exportVideo(options) {
    const opts = options || {};
    const support = supportsMp4Export();
    if (!support.supported) return Promise.reject(new Error(support.reason));
    const images = (Array.isArray(opts.images) ? opts.images : [])
      .filter(image => image && validateMediaUrl(image.src))
      .slice(0, MAX_IMAGES);
    if (images.length < MIN_SEQUENCE_IMAGES) {
      return Promise.reject(new Error('Select at least two setup images before exporting a video.'));
    }
    const width = clamp(opts.width || EXPORT_WIDTH, 320, 1920);
    const height = clamp(opts.height || EXPORT_HEIGHT, 180, 1080);
    const fps = clamp(opts.fps || EXPORT_FPS, 10, 60);
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    const signal = opts.signal || null;
    const reduced = prefersReducedMotion();
    const timeline = buildTimeline(images.length, { motion: !!opts.motion && !reduced, reducedMotion: reduced });
    if (signal && signal.aborted) return Promise.reject(cancelledError());

    const state = { cancelled: false, failure: null, done: false };
    let canvas = null;
    let stream = null;
    let recorder = null;
    let handle = null;
    let watchdog = null;
    let rejectRun = null;
    let settling = false;

    function cleanup() {
      if (handle !== null) { caf(handle); handle = null; }
      if (watchdog !== null) { window.clearTimeout(watchdog); watchdog = null; }
      document.removeEventListener('visibilitychange', onHidden);
      stopStream(stream);
    }

    function fail(reason) {
      if (state.done || settling) return;
      settling = true;
      state.failure = reason instanceof Error ? reason : new Error(String(reason));
      try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (_) { /* ignore */ }
      cleanup();
      // A hidden tab throttles requestAnimationFrame, so the draw loop may never
      // run again: reject here instead of waiting for the next frame.
      if (rejectRun) { const reject = rejectRun; rejectRun = null; reject(state.failure); }
    }

    function onHidden() {
      if (!document.hidden) return;
      // A hidden tab throttles timers and can truncate the recording: fail loudly
      // instead of returning a partial file.
      fail(new Error('The recording stopped because the browser tab was hidden. Keep this tab in the foreground while recording.'));
    }

    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', () => {
        if (state.done) return;
        state.cancelled = true;
        try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (_) { /* ignore */ }
        cleanup();
        // The frame loop may be idle, so reject here rather than waiting for
        // the next animation frame to notice the cancellation.
        if (rejectRun) { const reject = rejectRun; rejectRun = null; reject(cancelledError()); }
      }, { once: true });
    }

    return loadExportImages(images, signal).then(loaded => {
      if (signal && signal.aborted) throw cancelledError();
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (!context) throw new Error('This browser cannot draw the setup images (canvas is unavailable).');
      if (typeof canvas.captureStream !== 'function') throw new Error('This browser cannot capture canvas frames for video export.');

      // Check EVERY frame before recording, not just the first image.
      try {
        loaded.forEach(image => {
          context.drawImage(image, 0, 0, 1, 1);
          context.getImageData(0, 0, 1, 1);
        });
        drawTimeline(context, loaded, timeline, 0, width, height);
      } catch (_) {
        throw new Error('The setup images are not served from this site, so they cannot be recorded. Use images from the Media Library.');
      }

      stream = canvas.captureStream(fps);
      try {
        recorder = new window.MediaRecorder(stream, { mimeType: support.mimeType, videoBitsPerSecond: 4000000 });
      } catch (_) {
        stopStream(stream);
        throw new Error('The browser refused to start the MP4 encoder (' + support.mimeType + ').');
      }
      const chunks = [];
      recorder.ondataavailable = event => { if (event && event.data && event.data.size) chunks.push(event.data); };
      // The recorder settles on either a clean stop or an encoder error, so a
      // broken encoder can never leave the export pending forever.
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = () => {
          const error = new Error('The video encoder failed while recording.');
          fail(error);
          reject(error);
        };
      });

      document.addEventListener('visibilitychange', onHidden);
      watchdog = window.setTimeout(() => fail(new Error('The recording timed out before it finished.')), timeline.duration + EXPORT_TIMEOUT_MARGIN);

      try {
        recorder.start(1000);
      } catch (_) {
        cleanup();
        throw new Error('The browser could not start recording MP4 video.');
      }

      const started = now();
      return new Promise((resolve, reject) => {
        rejectRun = reject;
        const step = () => {
          if (state.cancelled) { rejectRun = null; reject(cancelledError()); return; }
          if (state.failure) { rejectRun = null; reject(state.failure); return; }
          const elapsed = now() - started;
          const time = Math.max(0, Math.min(elapsed, timeline.duration));
          drawTimeline(context, loaded, timeline, time, width, height);
          onProgress(Math.round((time / timeline.duration) * 100));
          if (elapsed >= timeline.duration) { rejectRun = null; resolve(); return; }
          handle = raf(step);
        };
        handle = raf(step);
      }).then(() => {
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) { /* ignore */ }
        return stopped.then(async () => {
          cleanup();
          if (state.cancelled) throw cancelledError();
          if (state.failure) throw state.failure;
          if (!chunks.length) throw new Error('The browser produced no video data. Try a current Chrome or Edge browser over HTTPS.');
          state.done = true;
          return {
            blob: await finalizeMp4(new Blob(chunks, { type: 'video/mp4' }), timeline.duration),
            mimeType: 'video/mp4',
            duration: timeline.duration,
            width: width,
            height: height,
            fps: fps
          };
        });
      });
    }).catch(error => {
      cleanup();
      throw error;
    });
  }

  /* ------------------------------------------------------------ public API */

  function destroy(root) {
    const instance = instances.get(root);
    if (instance) instance.destroy();
  }

  function start() {
    scan(document);
    // Late builder markup is picked up during a bounded observation window.
    const observer = new MutationObserver(records => {
      records.forEach(record => {
        if (record.removedNodes && record.removedNodes.length) {
          instances.forEach((instance, root) => { if (!root.isConnected) instance.destroy(); });
        }
        Array.prototype.forEach.call(record.addedNodes || [], node => {
          if (node && node.nodeType === 1) scan(node);
        });
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), OBSERVER_WINDOW);
    document.addEventListener('ppg:mounted', event => {
      const detail = event && event.detail;
      if (detail && detail.gallery) scan(detail.gallery);
      scan(document);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      instances.forEach(instance => instance.pauseAll());
    });
    window.addEventListener('pagehide', () => { instances.forEach(instance => instance.destroy()); });
  }

  window.PortareSetupMedia = {
    DURATION: DURATION,
    MAX_IMAGES: MAX_IMAGES,
    MIN_SEQUENCE_IMAGES: MIN_SEQUENCE_IMAGES,
    init: function (container) {
      const scope = container || document;
      scan(scope);
      return instances.size;
    },
    destroy: destroy,
    createPreview: createPreview,
    buildTimeline: buildTimeline,
    sampleTimeline: sampleTimeline,
    validateMediaUrl: validateMediaUrl,
    supportsMp4Export: supportsMp4Export,
    exportVideo: exportVideo
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}());

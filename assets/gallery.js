/* Plain browser JS. Description HTML must be sanitized by the PHP renderer. */
(function () {
  'use strict';
  const instances = new Map();
  const blocked = new WeakSet();
  const number = (value, fallback, min, max) => {
    const n = Number(value);
    return value === undefined || value === null || value === '' || !Number.isFinite(n) ? fallback : Math.max(min, Math.min(max, n));
  };
  function initialize(root) {
    if (instances.has(root) || blocked.has(root)) return;
    const query = selector => root.querySelector(selector);
    const stage = query('.ppg-stage');
    let image = query('.ppg-main-image');
    const description = query('.ppg-description');
    const strip = query('.ppg-thumbnails');
    const dataNode = query('.ppg-data');
    if (!stage || !image || !description || !strip || !dataNode) return;
    let data;
    try { data = JSON.parse(dataNode.textContent); } catch (_) { return; }
    if (!Array.isArray(data.slides) || !data.slides.length) return;
    const slides = data.slides;
    const thumbs = Array.from(strip.querySelectorAll('.ppg-thumb'));
    const prev = query('.ppg-prev'), next = query('.ppg-next'), play = query('.ppg-play');
    const stripPrev = query('.ppg-strip-prev'), stripNext = query('.ppg-strip-next');
    const status = query('.ppg-status'), error = query('.ppg-error');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const interval = number(root.dataset.interval, 5000, 1000, 120000);
    const duration = number(root.dataset.duration, 250, 0, 3000);
    const transition = ['fade', 'slide', 'none'].includes(root.dataset.transition) ? root.dataset.transition : 'fade';
    root.style.setProperty('--ppg-duration', duration + 'ms');
    let index = Math.max(0, thumbs.findIndex(button => button.getAttribute('aria-pressed') === 'true'));
    if (index >= slides.length) index = 0;
    let requested = index, token = 0, timer = null, destroyed = false, pending = false;
    let playing = root.dataset.autoplay === '1' && !motion.matches && slides.length > 1;
    let hovered = root.matches(':hover'), focused = root.contains(document.activeElement);
    let pointer = null;
    const listeners = [], animations = new Set(), outgoing = new Set(), loads = new Set();
    function on(target, event, callback, options) {
      target.addEventListener(event, callback, options);
      listeners.push(() => target.removeEventListener(event, callback, options));
    }
    function clearTimer() { if (timer !== null) window.clearTimeout(timer); timer = null; }
    function schedule() {
      clearTimer();
      if (!root.isConnected && !destroyed) { destroy(); return; }
      if (!destroyed && playing && !hovered && !focused && !document.hidden && !pending) {
        timer = window.setTimeout(() => select(index + 1, false), interval);
      }
    }
    function updatePlay() {
      if (!play) return;
      play.setAttribute('aria-label', playing ? 'Pause slideshow' : 'Resume slideshow');
      play.dataset.playing = String(playing);
      play.setAttribute('aria-pressed', String(playing));
      play.disabled = slides.length < 2;
    }
    function stop() { playing = false; updatePlay(); clearTimer(); }
    function frame(img, slide) {
      img.style.setProperty('--ppg-x', number(slide.x, 50, 0, 100) + '%');
      img.style.setProperty('--ppg-y', number(slide.y, 50, 0, 100) + '%');
      // PHP stores zoom as a percentage (100–200); multiplier fixtures also work.
      const rawZoom = number(slide.zoom, 100, 1, 400);
      img.style.setProperty('--ppg-zoom', String(number(rawZoom > 4 ? rawZoom / 100 : rawZoom, 1, 1, 4)));
      img.style.removeProperty('object-position');
      img.style.removeProperty('transform');
    }
    function preload(slide) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        let settled = false;
        const timeout = window.setTimeout(() => finish(new Error('timeout')), 15000);
        const cancel = () => finish(new Error('cancelled'));
        loads.add(cancel);
        function finish(reason) {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          loads.delete(cancel);
          img.onload = img.onerror = null;
          if (reason) reject(reason); else resolve(img);
        }
        img.onload = () => img.naturalWidth ? finish() : finish(new Error('empty image'));
        img.onerror = () => finish(new Error('image error'));
        img.alt = typeof slide.alt === 'string' ? slide.alt : '';
        img.decoding = 'async';
        if (slide.sizes) img.sizes = slide.sizes;
        if (slide.srcset) img.srcset = slide.srcset;
        img.src = slide.src;
        if (img.complete && img.naturalWidth) finish();
      });
    }
    function animate(element, frames, after) {
      if (motion.matches || duration === 0 || typeof element.animate !== 'function') { if (after) after(); return; }
      const animation = element.animate(frames, { duration, easing: 'ease-out' });
      animations.add(animation);
      animation.finished.catch(() => {}).then(() => { animations.delete(animation); if (after) after(); });
    }
    function cleanAnimations() {
      animations.forEach(animation => animation.cancel());
      animations.clear();
      outgoing.forEach(node => node.remove());
      outgoing.clear();
    }
    function reveal(button) {
      if (!button) return;
      const bounds = strip.getBoundingClientRect(), item = button.getBoundingClientRect();
      const delta = item.left < bounds.left ? item.left - bounds.left : item.right > bounds.right ? item.right - bounds.right : 0;
      if (delta) strip.scrollBy({ left: delta, behavior: 'auto' });
    }
    function mark() {
      thumbs.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.index) === index)));
      reveal(thumbs.find(button => Number(button.dataset.index) === index));
    }
    function updateStripArrows() {
      const max = Math.max(0, strip.scrollWidth - strip.clientWidth);
      const offset = Math.abs(strip.scrollLeft);
      if (stripPrev) { stripPrev.hidden = max <= 2; stripPrev.disabled = offset <= 2; }
      if (stripNext) { stripNext.hidden = max <= 2; stripNext.disabled = offset >= max - 2; }
    }
    function scrollStrip(direction) {
      const rtl = window.getComputedStyle(strip).direction === 'rtl';
      strip.scrollBy({left: direction * (rtl ? -1 : 1) * Math.max(44, strip.clientWidth * .8), behavior: motion.matches ? 'auto' : 'smooth'});
      updateStripArrows();
    }
    async function select(target, manual) {
      if (destroyed) return;
      if (manual) stop();
      requested = (target % slides.length + slides.length) % slides.length;
      const selected = requested, myToken = ++token;
      pending = false;
      clearTimer();
      loads.forEach(cancel => cancel());
      if (selected === index) { root.removeAttribute('aria-busy'); schedule(); return; }
      pending = true;
      root.setAttribute('aria-busy', 'true');
      try {
        const slide = slides[selected];
        if (!slide || typeof slide.src !== 'string' || !slide.src) throw new Error('missing source');
        const replacement = await preload(slide);
        if (destroyed || myToken !== token) return;
        cleanAnimations();
        replacement.className = 'ppg-main-image';
        frame(replacement, slide);
        replacement.width = number(slide.width, replacement.naturalWidth, 1, 30000);
        replacement.height = number(slide.height, replacement.naturalHeight || 1, 1, 30000);
        const old = image;
        old.classList.replace('ppg-main-image', 'ppg-outgoing-image');
        old.setAttribute('aria-hidden', 'true');
        outgoing.add(old);
        stage.appendChild(replacement);
        image = replacement;
        const removeOld = () => { old.remove(); outgoing.delete(old); };
        if (transition === 'none') removeOld();
        else animate(image, transition === 'slide' ? [{ opacity: 0, translate: '18px 0' }, { opacity: 1, translate: '0 0' }] : [{ opacity: 0 }, { opacity: 1 }], removeOld);
        // Only this server-sanitized local JSON field is allowed into the HTML sink.
        description.innerHTML = typeof slide.description === 'string' && slide.description.trim() ? slide.description : (typeof data.defaultDescription === 'string' ? data.defaultDescription : '');
        if (root.dataset.textFade !== '0') animate(description, [{ opacity: 0 }, { opacity: 1 }]);
        index = selected;
        mark();
        if (error) { error.hidden = true; error.textContent = ''; }
        if (status && manual) status.textContent = 'Image ' + (index + 1) + ' of ' + slides.length;
      } catch (_) {
        if (destroyed || myToken !== token) return;
        requested = index;
        if (error) { error.textContent = 'This image could not be loaded. The previous image is still shown. Choose another image or try again.'; error.hidden = false; }
      } finally {
        if (!destroyed && myToken === token) { pending = false; root.removeAttribute('aria-busy'); schedule(); }
      }
    }
    thumbs.forEach(button => on(button, 'click', () => select(Number(button.dataset.index), true)));
    on(strip, 'keydown', event => {
      const button = event.target.closest('.ppg-thumb');
      if (!button || !strip.contains(button)) return;
      let target = Number(button.dataset.index);
      if (event.key === 'ArrowRight') target++;
      else if (event.key === 'ArrowLeft') target--;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = slides.length - 1;
      else return;
      event.preventDefault();
      target = (target + slides.length) % slides.length;
      const dest = thumbs.find(item => Number(item.dataset.index) === target);
      if (dest) dest.focus({ preventScroll: true });
      reveal(dest);
      select(target, true);
    });
    if (prev) { prev.disabled = slides.length < 2; on(prev, 'click', () => select(requested - 1, true)); }
    if (next) { next.disabled = slides.length < 2; on(next, 'click', () => select(requested + 1, true)); }
    if (stripPrev) on(stripPrev, 'click', () => scrollStrip(-1));
    if (stripNext) on(stripNext, 'click', () => scrollStrip(1));
    on(strip, 'scroll', updateStripArrows, {passive: true});
    let stripObserver = null;
    if (typeof ResizeObserver === 'function') { stripObserver = new ResizeObserver(updateStripArrows); stripObserver.observe(strip); }
    else on(window, 'resize', updateStripArrows);
    if (play) on(play, 'click', () => { playing = !playing && slides.length > 1; updatePlay(); schedule(); });
    on(root, 'mouseenter', () => { hovered = true; schedule(); });
    on(root, 'mouseleave', () => { hovered = false; schedule(); });
    on(root, 'focusin', () => { focused = true; schedule(); });
    on(root, 'focusout', event => { focused = root.contains(event.relatedTarget); schedule(); });
    on(document, 'visibilitychange', schedule);
    on(motion, 'change', () => { if (motion.matches) { stop(); cleanAnimations(); } });
    on(stage, 'pointerdown', event => { if (event.isPrimary !== false) pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; });
    on(stage, 'pointerup', event => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      pointer = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) select(requested + (dx < 0 ? 1 : -1), true);
    });
    on(stage, 'pointercancel', () => { pointer = null; });
    function destroy() {
      destroyed = true; token++; clearTimer(); loads.forEach(cancel => cancel()); cleanAnimations();
      listeners.forEach(remove => remove());
      if (stripObserver) stripObserver.disconnect();
      root.classList.remove('ppg-initialized'); root.removeAttribute('aria-busy'); instances.delete(root);
    }
    instances.set(root, { destroy });
    frame(image, slides[index]);
    root.classList.add('ppg-initialized');
    updatePlay(); mark(); updateStripArrows(); schedule();
  }
  function scan(scope) {
    if (scope.matches && scope.matches('.ppg[data-ppg]')) initialize(scope);
    if (scope.querySelectorAll) scope.querySelectorAll('.ppg[data-ppg]').forEach(initialize);
  }
  function start() {
    scan(document);
    // Brizy inserts markup lazily. Bound observation, scan added subtrees only.
    const observer = new MutationObserver(records => {
      records.forEach(record => {
        record.addedNodes.forEach(node => { if (node.nodeType === 1) scan(node); });
        const root = record.target.closest && record.target.closest('.ppg[data-ppg]');
        if (root) initialize(root);
      });
      instances.forEach((instance, root) => { if (!root.isConnected) instance.destroy(); });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 60000);
    // Removed galleries after the observation window still release their timers.
    onPageHide();
  }
  function onPageHide() {
    window.addEventListener('pagehide', () => instances.forEach(instance => instance.destroy()), { once: true });
    window.addEventListener('pageshow', event => { if (event.persisted) scan(document); });
  }
  window.PortareProductGallery = {
    init: scope => {
      scope = scope || document;
      if (scope.matches && scope.matches('.ppg[data-ppg]')) blocked.delete(scope);
      if (scope.querySelectorAll) scope.querySelectorAll('.ppg[data-ppg]').forEach(root => blocked.delete(root));
      scan(scope);
    },
    destroy: root => { blocked.add(root); const instance = instances.get(root); if (instance) instance.destroy(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}());

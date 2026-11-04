/* Portare product editor: Wan AI motion generation.
 *
 * The provider credential stays on the server: this file only sends the ids
 * of the setup images the operator selected, the render settings and the
 * operator's optional prompt to the plugin's authenticated AJAX endpoints.
 *
 * A generated clip never changes the product on its own. It is shown in a
 * preview and the operator has to press "Use this video" before the setup
 * video field, its label and the media mode are touched. The product is
 * published by the regular product Update, exactly like a hand picked video.
 *
 * An ambiguous render (unknown status, expired session, transport failure) is
 * never resubmitted: the job is recovered and only polled, so a paid render
 * can not be started twice by accident.
 */
(function () {
  'use strict';

  const POLL_INTERVAL_MS = 5000;
  const POLL_TIMEOUT_MS = 15 * 60 * 1000;
  const ALLOWED_DURATIONS = ['5', '10', '15'];
  const DEFAULT_DURATION = '5';
  const ALLOWED_RESOLUTIONS = ['480P', '720P'];
  const DEFAULT_RESOLUTION = '720P';

  function ready(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  function positiveInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  ready(function () {
    const panel = document.querySelector('.ppg-setup-admin');
    if (!panel) return;
    const block = panel.querySelector('.ppg-setup-ai');
    if (!block) return;

    const enabled = block.getAttribute('data-ai-enabled') === '1';
    const provider = (block.getAttribute('data-ai-provider') || 'Wan').trim() || 'Wan';
    const reason = (block.getAttribute('data-ai-reason') || '').trim();
    const generateUrl = block.getAttribute('data-ai-generate-url') || '';
    const statusUrl = block.getAttribute('data-ai-status-url') || '';
    const nonce = block.getAttribute('data-ai-nonce') || '';
    const productId = panel.getAttribute('data-product-id') || '';
    const minImages = positiveInt(block.getAttribute('data-ai-min-images'), 2);
    // The setup list is a pool of up to four images; Wan consumes exactly
    // two selected frames, not merely the first two entries in that pool.
    const maxImages = 4;
    const pollIntervalMs = positiveInt(block.getAttribute('data-ai-poll-interval'), POLL_INTERVAL_MS);
    const pollTimeoutMs = positiveInt(block.getAttribute('data-ai-poll-timeout'), POLL_TIMEOUT_MS);

    const list = panel.querySelector('.ppg-setup-list');
    const firstField = block.querySelector('#ppg_setup_ai_first_frame');
    const lastField = block.querySelector('#ppg_setup_ai_last_frame');
    const promptField = block.querySelector('#ppg_setup_ai_prompt');
    const durationField = block.querySelector('#ppg_setup_ai_duration');
    const resolutionField = block.querySelector('#ppg_setup_ai_resolution');
    const consentField = block.querySelector('#ppg_setup_ai_consent');
    const generateButton = block.querySelector('.ppg-setup-ai-generate');
    const resumeButton = block.querySelector('.ppg-setup-ai-resume');
    const statusNode = block.querySelector('.ppg-setup-ai-status');
    // The AI block owns its own error line: the shared panel error belongs to
    // the export workflow and is cleared by unrelated mode changes.
    const errorNode = block.querySelector('.ppg-setup-ai-error') || panel.querySelector('.ppg-setup-admin-error');
    const resultNode = block.querySelector('.ppg-setup-ai-result');
    const previewNode = block.querySelector('.ppg-setup-ai-preview');
    const useButton = block.querySelector('.ppg-setup-ai-use-video');
    const videoField = panel.querySelector('#ppg_setup_video_id');
    const videoLabel = panel.querySelector('.ppg-setup-video-label');
    const modeField = panel.querySelector('#ppg_setup_mode');

    /* -------------------------------------------------------------- state */

    let requestSeq = 0;
    let busy = false;
    let renderActive = false;
    let framesTouched = false;
    let pendingResult = null;

    /* ----------------------------------------------------------- messages */

    function setStatus(message) {
      if (!statusNode) return;
      statusNode.textContent = message || '';
      statusNode.hidden = !message;
    }

    function setError(message) {
      if (!errorNode) return;
      errorNode.textContent = message || '';
      errorNode.hidden = !message;
    }

    function clearMessages() {
      setStatus('');
      setError('');
    }

    function refreshButtons() {
      if (generateButton) generateButton.disabled = !enabled || busy || renderActive;
      if (resumeButton) {
        resumeButton.disabled = busy || !statusUrl || !nonce || !productId;
        resumeButton.hidden = !enabled;
      }
    }

    /* -------------------------------------------------------------- frames */

    /** Attachment ids of the current setup images, in list order. */
    function frameIds() {
      if (!list) return [];
      const ids = [];
      Array.prototype.forEach.call(list.querySelectorAll('li.ppg-setup-image'), item => {
        const id = parseInt(item.getAttribute('data-id') || '0', 10);
        if (id > 0 && ids.indexOf(id) === -1) ids.push(id);
      });
      // The server accepts a bounded number of images; offering more would
      // only produce a request it rejects.
      return ids.slice(0, maxImages);
    }

    function fillSelect(field, ids) {
      if (!field) return;
      const previous = field.value;
      while (field.firstChild) field.removeChild(field.firstChild);
      ids.forEach(id => {
        const option = document.createElement('option');
        option.value = String(id);
        option.textContent = 'Image #' + id;
        field.appendChild(option);
      });
      field.value = ids.indexOf(parseInt(previous, 10)) !== -1 ? previous : '';
    }

    /**
     * Rebuild the frame selectors from the live setup list.
     *
     * Until the operator picks a frame by hand the selectors follow the list:
     * the first image is the first frame and the last image is the last frame,
     * so adding or reordering images keeps the defaults meaningful.
     */
    function syncFrames() {
      const ids = frameIds();
      fillSelect(firstField, ids);
      fillSelect(lastField, ids);
      if (!ids.length) { framesTouched = false; return; }
      if (!framesTouched) {
        if (firstField) firstField.value = String(ids[0]);
        if (lastField) lastField.value = String(ids.length > 1 ? ids[ids.length - 1] : ids[0]);
        return;
      }
      if (firstField && ids.indexOf(parseInt(firstField.value, 10)) === -1) firstField.value = String(ids[0]);
      if (lastField && ids.indexOf(parseInt(lastField.value, 10)) === -1) {
        lastField.value = String(ids.length > 1 ? ids[ids.length - 1] : ids[0]);
      }
    }

    function selectedFrames() {
      const first = parseInt(firstField ? firstField.value : '', 10);
      const last = parseInt(lastField ? lastField.value : '', 10);
      return { first: first > 0 ? first : 0, last: last > 0 ? last : 0 };
    }

    /* ------------------------------------------------------------ settings */

    function selectedDuration() {
      const value = durationField ? durationField.value : '';
      return ALLOWED_DURATIONS.indexOf(value) === -1 ? DEFAULT_DURATION : value;
    }

    function selectedResolution() {
      const value = resolutionField ? resolutionField.value : '';
      return ALLOWED_RESOLUTIONS.indexOf(value) === -1 ? DEFAULT_RESOLUTION : value;
    }

    /* ----------------------------------------------------------- transport */

    function readPayload(response) {
      if (response && typeof response.text === 'function') {
        return response.text().then(text => {
          if (!text) return null;
          try { return JSON.parse(text); } catch (_) { return null; }
        });
      }
      if (response && typeof response.json === 'function') {
        return response.json().catch(() => null);
      }
      return Promise.resolve(null);
    }

    function post(url, fields) {
      const body = new URLSearchParams();
      Object.keys(fields).forEach(key => {
        const value = fields[key];
        if (value === undefined || value === null) return;
        if (Array.isArray(value)) { value.forEach(item => body.append(key, String(item))); }
        else { body.append(key, String(value)); }
      });
      const controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
      const timeout = controller ? window.setTimeout(() => controller.abort(), 210000) : null;
      return window.fetch(url, {
        signal: controller ? controller.signal : undefined,
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body.toString()
      }).then(response => readPayload(response).then(payload => ({
        ok: !!(response && response.ok),
        status: response ? response.status : 0,
        payload: payload
      }))).finally(() => { if (timeout !== null) window.clearTimeout(timeout); });
    }

    /**
     * The body of a response, merged from both places the backend may use.
     *
     * WordPress wraps the payload in `data`, while a bare endpoint may answer
     * with the fields at the top level. Both are read so a contract change
     * never silently empties a message.
     */
    function payloadData(payload) {
      if (!payload || typeof payload !== 'object') return null;
      const nested = payload.data && typeof payload.data === 'object' ? payload.data : null;
      const merged = {};
      if (nested) {
        Object.keys(nested).forEach(key => { merged[key] = nested[key]; });
      }
      Object.keys(payload).forEach(key => {
        if (key === 'data' || key === 'success') return;
        if (merged[key] === undefined) merged[key] = payload[key];
      });
      return Object.keys(merged).length ? merged : null;
    }

    /**
     * True when the response reports success.
     *
     * The WordPress envelope is `{"success":true,"data":{...}}`. A bare body
     * that carries a render status without an explicit success flag is also
     * accepted, but only when it carries no error code.
     */
    function payloadOk(result) {
      if (!result || !result.ok || !result.payload || typeof result.payload !== 'object') return false;
      if (result.payload.success === true) return true;
      if (result.payload.success === false) return false;
      const data = payloadData(result.payload);
      if (!data) return false;
      if (typeof data.code === 'string' && data.code) return false;
      return typeof data.status === 'string' || typeof data.job_id === 'string';
    }

    function messageFrom(result, fallback) {
      const data = payloadData(result ? result.payload : null);
      if (data && typeof data.message === 'string' && data.message) return data.message;
      if (result && result.payload && typeof result.payload.message === 'string' && result.payload.message) {
        return result.payload.message;
      }
      return fallback;
    }

    function codeFrom(result) {
      const data = payloadData(result ? result.payload : null);
      if (data && typeof data.code === 'string') return data.code;
      if (result && result.payload && typeof result.payload.code === 'string') return result.payload.code;
      return '';
    }

    function jobIdFrom(result) {
      const data = payloadData(result ? result.payload : null);
      if (data && typeof data.job_id === 'string') return data.job_id;
      if (result && result.payload && typeof result.payload.job_id === 'string') return result.payload.job_id;
      return '';
    }

    /* -------------------------------------------------------------- result */

    /** Show a finished clip for review. Nothing in the product is changed. */
    function showResult(attachmentId, url) {
      pendingResult = { id: String(attachmentId || ''), url: url || '' };
      if (resultNode) resultNode.hidden = false;
      if (previewNode) {
        while (previewNode.firstChild) previewNode.removeChild(previewNode.firstChild);
        if (pendingResult.url) {
          const video = document.createElement('video');
          video.className = 'ppg-setup-ai-video';
          video.setAttribute('controls', '');
          video.setAttribute('playsinline', '');
          video.setAttribute('preload', 'metadata');
          video.setAttribute('src', pendingResult.url);
          const previewUrl = pendingResult.url;
          video.addEventListener('error', () => {
            if (!pendingResult || pendingResult.url !== previewUrl) return;
            if (useButton) useButton.disabled = true;
            setError('The generated video could not be played. Check the saved media or Resume before using this clip.');
          });
          previewNode.appendChild(video);
        }
      }
      const label = block.querySelector('.ppg-setup-ai-result-label');
      if (label) {
        label.textContent = pendingResult.url
          ? 'Generated clip: Media Library video #' + pendingResult.id
          : 'Generated clip: Media Library video #' + pendingResult.id + ' (no preview address was returned)';
      }
      if (useButton) { useButton.hidden = false; useButton.disabled = false; }
    }

    function clearResult() {
      pendingResult = null;
      if (resultNode) resultNode.hidden = true;
      if (previewNode) { while (previewNode.firstChild) previewNode.removeChild(previewNode.firstChild); }
      if (useButton) { useButton.hidden = true; useButton.disabled = true; }
    }

    /**
     * The only place where the product setup fields are changed.
     *
     * The regular setup admin script reads those fields when it renders the
     * preview, so the change and input events are dispatched to keep it in
     * sync. The product itself is published by the normal product Update.
     */
    function useGeneratedVideo() {
      if (!pendingResult || !pendingResult.id) {
        setError('There is no generated clip to use yet.');
        return;
      }
      const id = pendingResult.id;
      const url = pendingResult.url;
      if (videoField) {
        videoField.value = id;
        if (url) videoField.setAttribute('data-url', url);
      }
      if (videoLabel) videoLabel.textContent = 'Video #' + id;
      if (modeField) modeField.value = 'video';
      notifyChanged(videoField);
      notifyChanged(modeField);
      notifyChanged(videoLabel);
      setStatus('Video #' + id + ' is selected for this product. Update the product to publish it.');
    }

    function notifyChanged(node) {
      if (!node || typeof node.dispatchEvent !== 'function') return;
      const view = node.ownerDocument && node.ownerDocument.defaultView;
      if (!view) return;
      try {
        node.dispatchEvent(new view.Event('change', { bubbles: true }));
        node.dispatchEvent(new view.Event('input', { bubbles: true }));
      } catch (_) { /* the value is already set */ }
    }

    /* ------------------------------------------------------------- polling */

    function nextSeq() {
      requestSeq += 1;
      return requestSeq;
    }

    function poll(jobId, startedAt, seq) {
      if (seq !== requestSeq) return;
      if (Date.now() - startedAt > pollTimeoutMs) {
        // The render may still be running: offer the resume path, never a
        // second paid render.
        renderActive = true;
        setStatus(provider + ' is still rendering this clip. Press Resume to check the latest job; starting another render would spend more credits.');
        refreshButtons();
        return;
      }
      requestStatus(seq, jobId, true, false, startedAt);
    }

    function requestStatus(seq, jobId, allowFallback, quiet, startedAt) {
      const start = typeof startedAt === 'number' ? startedAt : Date.now();
      return post(statusUrl, {
        action: 'ppg_setup_ai_status',
        product_id: productId,
        nonce: nonce,
        job_id: jobId || ''
      }).then(result => {
        if (seq !== requestSeq) return;
        if (!payloadOk(result)) {
          const code = codeFrom(result);
          if (allowFallback && (code === 'unknown_job' || code === 'invalid_job')) {
            // The remembered job is gone: ask the server for the latest one.
            return requestStatus(seq, '', false, quiet, start);
          }
          statusFailed(result, jobId, quiet);
          return;
        }
        handleStatus(payloadData(result.payload) || {}, jobId, seq, start, quiet);
      }).catch(error => {
        if (seq !== requestSeq) return;
        statusFailed(null, jobId, quiet, error && error.message ? error.message : '');
      });
    }

    /** A status read that failed: never resubmit, offer the resume path. */
    function statusFailed(result, jobId, quiet, transportMessage) {
      const message = transportMessage || messageFrom(result, 'The render status could not be read.');
      // A failed recovery read cannot establish that no paid job exists.
      renderActive = true;
      if (quiet) setStatus(message);
      else setError(message);
      refreshButtons();
    }

    function handleStatus(data, jobId, seq, startedAt, quiet) {
      const status = typeof data.status === 'string' ? data.status : '';
      const knownJob = jobId || (typeof data.job_id === 'string' ? data.job_id : '');

      if (status === 'succeeded') {
        renderActive = false;
        if (data.attachment_id) showResult(data.attachment_id, data.url || '');
        setStatus('The generated clip is ready. Review the preview and press "Use this video" to select it, then update the product to publish it.');
        refreshButtons();
        return;
      }

      if (status === 'failed') {
        renderActive = false;
        const reason = data.message || (provider + ' could not render this clip.');
        if (quiet) setStatus(reason);
        else { setError(reason); setStatus(''); }
        refreshButtons();
        return;
      }

      if (status === 'idle') {
        renderActive = false;
        if (!quiet) setStatus('There is no ' + provider + ' render for this product to resume.');
        refreshButtons();
        return;
      }

      if (status === 'unknown') {
        // The render may or may not have started: never start it again.
        renderActive = true;
        setStatus('The result of the last render request is not known. Do not start another render; press Resume to check the latest job.');
        refreshButtons();
        return;
      }

      // queued or processing
      renderActive = true;
      setStatus(data.message || (provider + ' is still rendering the setup clip.'));
      refreshButtons();
      window.setTimeout(() => poll(knownJob, startedAt, seq), pollIntervalMs);
    }

    /* ------------------------------------------------------------ generate */

    function startGeneration() {
      clearMessages();
      if (!enabled) {
        setError(reason || ('AI motion generation is not configured on this server, so no ' + provider + ' render can be started.'));
        return;
      }
      if (!generateUrl || !statusUrl || !nonce || !productId) {
        setError('The AI motion controls are not configured for this product. Reload the product page and try again.');
        return;
      }
      if (busy) {
        setError('A render request is already being sent for this product.');
        return;
      }
      if (renderActive) {
        setStatus('A ' + provider + ' render is already running for this product. Press Resume to check it.');
        return;
      }
      if (!consentField || !consentField.checked) {
        setError('Approve the request first: it spends paid ' + provider + ' credits and sends the selected setup images to the external ' + provider + ' service.');
        return;
      }

      syncFrames();
      const frames = selectedFrames();
      const ids = frameIds();
      if (ids.length < minImages) {
        setError('Select at least ' + minImages + ' setup images before starting a ' + provider + ' render.');
        return;
      }
      if (!frames.first || !frames.last) {
        setError('Choose the first and the last setup image for the ' + provider + ' render.');
        return;
      }
      if (frames.first === frames.last) {
        setError('The first frame and the last frame must be different setup images.');
        return;
      }

      const prompt = promptField && promptField.value ? promptField.value.trim() : '';
      const seq = nextSeq();
      const startedAt = Date.now();
      busy = true;
      consentField.checked = false; // A new render needs fresh approval.
      clearResult();
      refreshButtons();
      setStatus('Sending the render request to ' + provider + '.');

      post(generateUrl, {
        action: 'ppg_setup_ai_generate',
        product_id: productId,
        nonce: nonce,
        consent: '1',
        first_frame_id: frames.first,
        last_frame_id: frames.last,
        prompt: prompt,
        duration: selectedDuration(),
        resolution: selectedResolution()
      }).then(result => {
        if (seq !== requestSeq) return;
        if (!payloadOk(result)) {
          const failedJob = jobIdFrom(result);
          const code = codeFrom(result);
          const safePreflightErrors = ['invalid_product', 'forbidden', 'invalid_nonce', 'consent_required', 'invalid_frames', 'invalid_duration', 'invalid_resolution', 'provider_not_configured', 'job_not_stored', 'runtime_missing', 'provider_error'];
          renderActive = !!failedJob || safePreflightErrors.indexOf(code) === -1;
          const reason = messageFrom(result, 'The ' + provider + ' render could not be started.');
          setError(failedJob
            ? reason + ' A job was started, so press Resume instead of starting another render.'
            : reason);
          setStatus('');
          return;
        }
        const data = payloadData(result.payload) || {};
        const jobId = typeof data.job_id === 'string' ? data.job_id : '';
        const status = typeof data.status === 'string' ? data.status : '';
        if (status === 'succeeded') {
          renderActive = false;
          if (data.attachment_id) showResult(data.attachment_id, data.url || '');
          setStatus('The generated clip is ready. Review the preview and press "Use this video" to select it, then update the product to publish it.');
          return;
        }
        if (status === 'failed') {
          renderActive = false;
          setError(data.message || (provider + ' could not render this clip.'));
          setStatus('');
          return;
        }
        if (status === 'unknown') {
          renderActive = true;
          setStatus('The result of the render request is not known. Do not start another render; press Resume to check the latest job.');
          return;
        }
        renderActive = true;
        setStatus(data.message || (provider + ' is rendering the setup clip.'));
        window.setTimeout(() => poll(jobId, startedAt, seq), pollIntervalMs);
      }).catch(error => {
        if (seq !== requestSeq) return;
        // The request may well have reached the provider: never resubmit.
        renderActive = true;
        setError((error && error.message ? error.message : 'The ' + provider + ' render could not be started.') +
          ' The request may still be running, so press Resume instead of starting a new render.');
        setStatus('');
      }).finally(() => {
        busy = false;
        refreshButtons();
      });
    }

    /* -------------------------------------------------------------- resume */

    function resumeGeneration() {
      clearMessages();
      if (!statusUrl || !nonce || !productId) {
        setError('The AI motion controls are not configured for this product. Reload the product page and try again.');
        return;
      }
      if (busy) {
        setError('A request is already being sent for this product.');
        return;
      }
      // A blank job id asks the server for the latest job of this product
      // and user, so a closed tab does not lose the render.
      const seq = nextSeq();
      busy = true;
      refreshButtons();
      setStatus('Checking the latest ' + provider + ' render for this product.');
      requestStatus(seq, '', true, false, Date.now()).then(() => {
        if (seq !== requestSeq) return;
        busy = false;
        refreshButtons();
      });
    }

    /* -------------------------------------------------------------- wiring */

    [generateButton, resumeButton, useButton].forEach(button => {
      if (button) button.setAttribute('type', 'button');
    });

    if (generateButton) generateButton.addEventListener('click', startGeneration);
    if (resumeButton) resumeButton.addEventListener('click', resumeGeneration);
    if (useButton) useButton.addEventListener('click', useGeneratedVideo);

    [firstField, lastField].forEach(field => {
      if (!field) return;
      field.addEventListener('change', () => { framesTouched = true; });
    });

    // Enter inside this block must not submit the product form. A textarea
    // keeps its own newline behaviour.
    block.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      const target = event.target;
      if (target && target.tagName === 'TEXTAREA') return;
      event.preventDefault();
    });

    if (list && typeof MutationObserver === 'function') {
      const observer = new MutationObserver(() => syncFrames());
      observer.observe(list, { childList: true, subtree: false });
    }

    syncFrames();
    clearResult();
    refreshButtons();

    // Automatic recovery: read the latest job for this product and user. No
    // render is ever started from here.
    if (enabled && statusUrl && nonce && productId) {
      const seq = nextSeq();
      requestStatus(seq, '', true, true, Date.now());
    }
  });
}());

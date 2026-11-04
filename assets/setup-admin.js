/* Portare product editor: Product Setup media.
 *
 * Owns only the Product Setup panel. It never submits the product form, never
 * writes product metadata on its own and never deletes Media Library files.
 * Removing a setup image only removes this product's association.
 *
 * Depends on window.PortareSetupMedia (assets/setup.js) for the shared preview
 * renderer, the deterministic timeline and the browser-native MP4 recorder.
 */
(function () {
  'use strict';

  const MAX_IMAGES = 4;
  const MIN_SEQUENCE_IMAGES = 2;
  const EXPORT_FILENAME = 'generated.mp4';

  // Both files live in the same asset directory. If setup.js was not enqueued
  // on this screen, load it from the sibling path instead of failing silently.
  const ownScript = document.currentScript && document.currentScript.src ? document.currentScript.src : '';
  const coreUrl = ownScript ? ownScript.replace(/setup-admin\.js(\?.*)?$/, 'setup.js$1') : '';

  function loadCore() {
    if (window.PortareSetupMedia) return Promise.resolve(window.PortareSetupMedia);
    if (!coreUrl) return Promise.reject(new Error('The setup player script (setup.js) is not available.'));
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = coreUrl;
      script.async = false;
      const timer = window.setTimeout(() => {
        script.remove();
        reject(new Error('The setup player script (setup.js) could not be loaded.'));
      }, 10000);
      script.onload = () => {
        window.clearTimeout(timer);
        if (window.PortareSetupMedia) resolve(window.PortareSetupMedia);
        else reject(new Error('The setup player script (setup.js) did not expose its API.'));
      };
      script.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('The setup player script (setup.js) could not be loaded.'));
      };
      document.head.appendChild(script);
    });
  }

  function ready(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  ready(function () {
    const panel = document.querySelector('.ppg-setup-admin');
    if (!panel) return;

    const media = () => window.PortareSetupMedia || null;
    const productId = panel.getAttribute('data-product-id') || '';
    const uploadUrl = panel.getAttribute('data-upload-url') || '';
    const uploadNonce = panel.getAttribute('data-upload-nonce') || '';

    const list = panel.querySelector('.ppg-setup-list');
    const statusNode = panel.querySelector('.ppg-setup-admin-status');
    const errorNode = panel.querySelector('.ppg-setup-admin-error');
    const previewNode = panel.querySelector('.ppg-setup-preview');
    const previewButton = panel.querySelector('.ppg-setup-preview-button');
    const exportButton = panel.querySelector('.ppg-setup-export');
    const exportCancel = panel.querySelector('.ppg-setup-export-cancel');
    const downloadLink = panel.querySelector('a.ppg-setup-download');
    const useVideoButton = panel.querySelector('.ppg-setup-use-video');
    const addImagesButton = panel.querySelector('.ppg-setup-add-images');
    const pickVideoButton = panel.querySelector('.ppg-setup-pick-video');
    const clearVideoButton = panel.querySelector('.ppg-setup-clear-video');
    const pickPosterButton = panel.querySelector('.ppg-setup-pick-poster');
    const clearPosterButton = panel.querySelector('.ppg-setup-clear-poster');
    const videoLabel = panel.querySelector('.ppg-setup-video-label');
    const posterLabel = panel.querySelector('.ppg-setup-poster-label');

    const field = id => panel.querySelector('#' + id);
    const enabledField = field('ppg_setup_enabled');
    const modeField = field('ppg_setup_mode');
    const headingField = field('ppg_setup_heading');
    const captionField = field('ppg_setup_caption');
    const motionField = field('ppg_setup_motion');
    const videoField = field('ppg_setup_video_id');
    const posterField = field('ppg_setup_poster_id');
    const replaceField = field('ppg_setup_replace_illustrations');

    // Nothing in this panel may submit the product form.
    [exportButton, exportCancel, useVideoButton, previewButton, addImagesButton, pickVideoButton, clearVideoButton, pickPosterButton, clearPosterButton].forEach(button => {
      if (button) button.setAttribute('type', 'button');
    });
    // Progress and errors must be announced, not only coloured.
    if (statusNode && !statusNode.getAttribute('aria-live')) {
      statusNode.setAttribute('role', 'status');
      statusNode.setAttribute('aria-live', 'polite');
    }
    if (errorNode && !errorNode.getAttribute('aria-live')) {
      errorNode.setAttribute('role', 'alert');
      errorNode.setAttribute('aria-live', 'assertive');
    }

    let generatedBlob = null;
    let generatedUrl = '';
    let recording = false;
    let abortController = null;

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

    function revokeGeneratedUrl() {
      if (!generatedUrl) return;
      try { URL.revokeObjectURL(generatedUrl); } catch (_) { /* ignore */ }
      generatedUrl = '';
    }

    function resetGenerated() {
      revokeGeneratedUrl();
      generatedBlob = null;
      if (downloadLink) {
        downloadLink.removeAttribute('href');
        downloadLink.removeAttribute('download');
        downloadLink.hidden = true;
      }
      if (useVideoButton) {
        useVideoButton.hidden = true;
        useVideoButton.disabled = true;
      }
    }

    /* ------------------------------------------------------------ selection */

    function listItems() {
      if (!list) return [];
      return Array.prototype.slice.call(list.querySelectorAll('li.ppg-setup-image'));
    }

    function itemData(item) {
      const id = item.getAttribute('data-id') || '';
      const hidden = item.querySelector('input[name="ppg_setup[images][]"]');
      return {
        id: id,
        value: hidden ? hidden.value : id,
        src: item.getAttribute('data-src') || '',
        alt: item.getAttribute('data-alt') || ''
      };
    }

    function selectedImages() {
      return listItems()
        .map(itemData)
        .filter(image => image.src)
        .slice(0, MAX_IMAGES);
    }

    function syncOrderButtons() {
      const items = listItems();
      items.forEach((item, index) => {
        const up = item.querySelector('.ppg-setup-image-up');
        const down = item.querySelector('.ppg-setup-image-down');
        if (up) up.disabled = index === 0;
        if (down) down.disabled = index === items.length - 1;
      });
      if (addImagesButton) {
        const full = items.length >= MAX_IMAGES;
        addImagesButton.disabled = full;
        addImagesButton.setAttribute('aria-disabled', String(full));
        if (full) addImagesButton.setAttribute('title', 'A setup sequence supports up to ' + MAX_IMAGES + ' images.');
        else addImagesButton.removeAttribute('title');
      }
    }

    // Rows can arrive from PHP, from the media library or from another script:
    // keep the order controls correct whenever the list changes.
    if (list && typeof MutationObserver === 'function') {
      const listObserver = new MutationObserver(() => syncOrderButtons());
      listObserver.observe(list, { childList: true });
    }

    function setThumb(item, src) {
      const thumb = item.querySelector('img');
      if (!thumb) return;
      if (src) {
        thumb.src = src;
        thumb.hidden = false;
      } else {
        thumb.removeAttribute('src');
        thumb.hidden = true;
      }
    }

    function buildItem(image) {
      // Clone the PHP template so a new row has exactly the same markup.
      const template = document.getElementById('ppg-setup-image-template');
      let item = null;
      if (template && template.content && template.content.firstElementChild) {
        item = template.content.firstElementChild.cloneNode(true);
      }
      if (!item) {
        const existing = listItems()[0];
        if (existing) item = existing.cloneNode(true);
      }
      if (!item) {
        item = document.createElement('li');
      }
      item.className = 'ppg-setup-image';
      item.setAttribute('data-id', image.id);
      item.setAttribute('data-src', image.src || '');
      item.setAttribute('data-alt', image.alt || '');
      const hidden = item.querySelector('input[name="ppg_setup[images][]"]');
      if (hidden) hidden.value = image.id;
      const label = item.querySelector('.ppg-setup-image-label');
      if (label) label.textContent = 'Image #' + image.id;
      setThumb(item, image.thumb || '');
      return item;
    }

    /** Pick the stored image size the PHP renderer uses for a row. */
    function storedSize(data) {
      if (data && data.url) return data.url;
      const sizes = (data && data.sizes) || {};
      const large = sizes.large && sizes.large.url;
      if (large) return large;
      const medium = sizes.medium && sizes.medium.url;
      if (medium) return medium;
      const thumbnail = sizes.thumbnail && sizes.thumbnail.url;
      if (thumbnail) return thumbnail;
      return (data && data.url) || '';
    }

    function thumbnailSize(data) {
      const sizes = (data && data.sizes) || {};
      const thumbnail = sizes.thumbnail && sizes.thumbnail.url;
      if (thumbnail) return thumbnail;
      const medium = sizes.medium && sizes.medium.url;
      if (medium) return medium;
      return (data && data.url) || '';
    }

    function appendImages(models) {
      if (!list) return;
      const existing = {};
      listItems().forEach(item => { existing[item.getAttribute('data-id')] = true; });
      let added = 0;
      let skipped = 0;
      models.forEach(model => {
        const data = model && typeof model.toJSON === 'function' ? model.toJSON() : model;
        if (!data || (data.type && data.type !== 'image')) return;
        const id = String(data.id || '');
        if (!id || existing[id]) { skipped++; return; }
        if (listItems().length >= MAX_IMAGES) { skipped++; return; }
        existing[id] = true;
        list.appendChild(buildItem({
          id: id,
          src: storedSize(data),
          alt: (data && data.alt) || '',
          thumb: thumbnailSize(data)
        }));
        added++;
      });
      syncOrderButtons();
      if (skipped && listItems().length >= MAX_IMAGES) {
        setError('A setup sequence supports up to ' + MAX_IMAGES + ' images. Duplicates and extra images were skipped.');
      } else if (skipped) {
        setStatus(skipped + ' duplicate image(s) skipped.');
      }
    }

    function mediaFrame(options, onSelect) {
      if (!window.wp || typeof window.wp.media !== 'function') {
        setError('The WordPress media library is unavailable in this screen.');
        return;
      }
      const frame = window.wp.media(options);
      frame.on('select', () => {
        const selection = frame.state().get('selection');
        const models = [];
        if (selection && typeof selection.each === 'function') {
          selection.each(model => models.push(model));
        } else if (selection && typeof selection.toJSON === 'function') {
          models.push(selection);
        }
        onSelect(models);
      });
      frame.open();
    }

    /* -------------------------------------------------------------- preview */

    function currentData() {
      const images = selectedImages().map(image => ({ id: image.id, src: image.src, alt: image.alt }));
      const mode = modeField && modeField.value ? modeField.value : 'pictures';
      const videoId = videoField ? videoField.value : '';
      const posterId = posterField ? posterField.value : '';
      const videoUrl = videoField ? (videoField.getAttribute('data-url') || '') : '';
      const posterUrl = posterField ? (posterField.getAttribute('data-url') || '') : '';
      const data = {
        mode: mode,
        images: images,
        motion: motionField && motionField.checked ? 1 : 0,
        duration: (media() && media().DURATION) || 15000,
        productId: productId,
        heading: headingField ? headingField.value : '',
        caption: captionField ? captionField.value : ''
      };
      if (mode === 'video') {
        data.videoUrl = videoUrl;
        data.posterUrl = posterUrl;
        if (!videoId && !videoUrl) data.mode = 'pictures';
      }
      return data;
    }

    function clearPreview() {
      if (!previewNode) return;
      while (previewNode.firstChild) previewNode.removeChild(previewNode.firstChild);
    }

    function renderPreview() {
      const api = media();
      if (!api) {
        setError('The setup player script (setup.js) is not loaded, so the preview is unavailable.');
        return;
      }
      clearPreview();
      const data = currentData();
      const element = api.createPreview(data);
      previewNode.appendChild(element);
      if (data.mode === 'sequence') {
        try { api.init(element); } catch (_) { /* preview is best effort */ }
      }
      setStatus('Preview updated.');
    }

    /* --------------------------------------------------------------- export */

    function exportCapability() {
      const api = media();
      if (!api) return { supported: false, pending: true, reason: 'The setup player script (setup.js) is still loading, so video export is unavailable for now.' };
      return api.supportsMp4Export();
    }

    function syncExportAvailability() {
      const capability = exportCapability();
      if (exportButton) {
        exportButton.disabled = !capability.supported;
        if (capability.supported) exportButton.removeAttribute('title');
        else exportButton.setAttribute('title', capability.reason);
      }
      // While the core is still loading the reason is temporary and is not
      // shown as an error; a real failure is reported once loading settles.
      if (!capability.supported && !capability.pending) setError(capability.reason);
      return capability;
    }

    // The core player may still be loading (or may not be enqueued at all).
    loadCore().then(() => {
      syncExportAvailability();
    }).catch(error => {
      setError(error && error.message ? error.message : 'The setup player script (setup.js) is not available.');
      if (exportButton) {
        exportButton.disabled = true;
        exportButton.setAttribute('title', 'The setup player script (setup.js) is not available.');
      }
    });

    function setRecordingState(active) {
      recording = active;
      if (exportButton) exportButton.disabled = active || !exportCapability().supported;
      if (exportCancel) exportCancel.disabled = !active;
    }

    function stopRecording() {
      if (abortController) {
        try { abortController.abort(); } catch (_) { /* ignore */ }
        abortController = null;
      }
      setRecordingState(false);
    }

    function showGenerated(result) {
      generatedBlob = result.blob;
      revokeGeneratedUrl();
      generatedUrl = URL.createObjectURL(result.blob);
      if (downloadLink) {
        downloadLink.setAttribute('href', generatedUrl);
        downloadLink.setAttribute('download', EXPORT_FILENAME);
        downloadLink.hidden = false;
        downloadLink.textContent = 'Download ' + EXPORT_FILENAME;
      }
      if (useVideoButton) {
        useVideoButton.hidden = false;
        useVideoButton.disabled = false;
      }
      if (previewNode) {
        const previous = previewNode.querySelector('.ppg-setup-preview-video');
        if (previous) previous.remove();
        const holder = document.createElement('div');
        holder.className = 'ppg-setup-preview-video';
        const video = document.createElement('video');
        video.className = 'ppg-setup-video';
        video.setAttribute('controls', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('preload', 'metadata');
        video.src = generatedUrl;
        const caption = document.createElement('p');
        caption.className = 'ppg-setup-caption';
        caption.textContent = 'Recorded ' + Math.round(result.duration / 1000) + ' second setup video (' + result.width + 'x' + result.height + ').';
        holder.appendChild(video);
        holder.appendChild(caption);
        previewNode.appendChild(holder);
      }
    }

    function runExport() {
      const api = media();
      clearMessages();
      if (!api) { setError('The setup player script (setup.js) is not loaded, so video export is unavailable.'); return; }
      const capability = exportCapability();
      if (!capability.supported) { setError(capability.reason); return; }
      const images = selectedImages().map(image => ({ id: image.id, src: image.src, alt: image.alt }));
      if (images.length < MIN_SEQUENCE_IMAGES) {
        setError('Select at least ' + MIN_SEQUENCE_IMAGES + ' setup images before exporting a video.');
        return;
      }
      resetGenerated();
      setRecordingState(true);
      abortController = typeof AbortController === 'function' ? new AbortController() : null;
      setStatus('Recording the setup video. Keep this tab in the foreground.');
      const motion = motionField && motionField.checked;
      api.exportVideo({
        images: images,
        motion: motion,
        signal: abortController ? abortController.signal : null,
        onProgress: percent => setStatus('Recording the setup video: ' + percent + '%')
      }).then(result => {
        setRecordingState(false);
        abortController = null;
        showGenerated(result);
        setStatus('Video recorded. Download it or add it to the Media Library.');
      }).catch(error => {
        setRecordingState(false);
        abortController = null;
        resetGenerated();
        const message = error && error.message ? error.message : 'The setup video could not be recorded.';
        setError(message);
        setStatus('');
      });
    }

    /* --------------------------------------------------------------- upload */

    function uploadGenerated() {
      clearMessages();
      if (!generatedBlob) { setError('Record the setup video before adding it to the Media Library.'); return; }
      if (!uploadUrl) { setError('The upload endpoint is not configured for this product.'); return; }
      if (!uploadNonce) { setError('The upload security token is missing. Reload the product page and try again.'); return; }
      if (!productId) { setError('The product could not be identified for the upload.'); return; }
      const form = new FormData();
      form.append('action', 'ppg_setup_upload');
      form.append('product_id', productId);
      form.append('nonce', uploadNonce);
      form.append('setup_video', generatedBlob, EXPORT_FILENAME);
      setStatus('Uploading the recorded video to the Media Library.');
      if (useVideoButton) useVideoButton.disabled = true;
      window.fetch(uploadUrl, { method: 'POST', body: form, credentials: 'same-origin' })
        .then(response => response.json().then(payload => ({ ok: response.ok, payload: payload })))
        .then(result => {
          const payload = result.payload || {};
          if (!result.ok || !payload.success || !payload.data || !payload.data.id) {
            const reason = (payload.data && payload.data.message) || payload.message || 'The Media Library rejected the video.';
            throw new Error(reason);
          }
          const id = String(payload.data.id);
          const url = payload.data.url || '';
          if (videoField) {
            videoField.value = id;
            if (url) videoField.setAttribute('data-url', url);
          }
          if (videoLabel) videoLabel.textContent = url ? 'Video #' + id : 'Video #' + id;
          if (modeField) modeField.value = 'video';
          if (useVideoButton) useVideoButton.disabled = false;
          setStatus('Video #' + id + ' added to the Media Library. Update the product to publish the setup video.');
        })
        .catch(error => {
          if (useVideoButton) useVideoButton.disabled = false;
          setError(error && error.message ? error.message : 'The recorded video could not be uploaded.');
          setStatus('');
        });
    }

    /* -------------------------------------------------------------- wiring */

    if (addImagesButton) {
      addImagesButton.addEventListener('click', () => {
        clearMessages();
        mediaFrame({ title: 'Append setup images', button: { text: 'Add images' }, library: { type: 'image' }, multiple: true }, appendImages);
      });
    }

    if (list) {
      list.addEventListener('click', event => {
        const button = event.target.closest ? event.target.closest('button') : null;
        if (!button || !list.contains(button)) return;
        const item = button.closest('li.ppg-setup-image');
        if (!item) return;
        if (button.classList.contains('ppg-setup-image-up')) {
          const previous = item.previousElementSibling;
          if (previous) list.insertBefore(item, previous);
        } else if (button.classList.contains('ppg-setup-image-down')) {
          const next = item.nextElementSibling;
          if (next) list.insertBefore(next, item);
        } else if (button.classList.contains('ppg-setup-image-remove')) {
          item.remove();
        } else {
          return;
        }
        syncOrderButtons();
        setStatus('Setup image order updated.');
      });
    }

    if (pickVideoButton) {
      pickVideoButton.addEventListener('click', () => {
        clearMessages();
        mediaFrame({ title: 'Choose a setup video', button: { text: 'Use this video' }, library: { type: 'video' }, multiple: false }, models => {
          const model = models[0];
          if (!model) return;
          const data = model && typeof model.toJSON === 'function' ? model.toJSON() : model;
          const id = String((data && data.id) || '');
          const url = (data && data.url) || '';
          if (!id) return;
          if (videoField) {
            videoField.value = id;
            if (url) videoField.setAttribute('data-url', url);
          }
          if (videoLabel) videoLabel.textContent = 'Video #' + id;
          if (modeField) modeField.value = 'video';
          setStatus('Video #' + id + ' selected. Update the product to publish it.');
        });
      });
    }

    if (clearVideoButton) {
      clearVideoButton.addEventListener('click', () => {
        clearMessages();
        if (videoField) {
          videoField.value = '';
          videoField.setAttribute('data-url', '');
        }
        if (videoLabel) videoLabel.textContent = '';
        setStatus('Setup video cleared. Update the product to publish the change.');
      });
    }

    if (pickPosterButton) {
      pickPosterButton.addEventListener('click', () => {
        clearMessages();
        mediaFrame({ title: 'Choose a setup video poster image', button: { text: 'Use this image' }, library: { type: 'image' }, multiple: false }, models => {
          const model = models[0];
          if (!model) return;
          const data = model && typeof model.toJSON === 'function' ? model.toJSON() : model;
          const id = String((data && data.id) || '');
          const sizes = (data && data.sizes) || {};
          const url = (sizes.thumbnail && sizes.thumbnail.url) || (data && data.url) || '';
          if (!id) return;
          if (posterField) {
            posterField.value = id;
            if (url) posterField.setAttribute('data-url', url);
          }
          if (posterLabel) posterLabel.textContent = 'Poster #' + id;
          setStatus('Poster image selected. Update the product to publish it.');
        });
      });
    }

    if (clearPosterButton) {
      clearPosterButton.addEventListener('click', () => {
        clearMessages();
        if (posterField) {
          posterField.value = '';
          posterField.setAttribute('data-url', '');
        }
        if (posterLabel) posterLabel.textContent = '';
        setStatus('Poster image cleared. Update the product to publish the change.');
      });
    }

    if (previewButton) {
      previewButton.addEventListener('click', renderPreview);
    }

    if (exportButton) {
      exportButton.addEventListener('click', runExport);
    }

    if (exportCancel) {
      exportCancel.addEventListener('click', () => {
        if (!recording) return;
        stopRecording();
        resetGenerated();
        setError('The recording was cancelled. Nothing was saved.');
        setStatus('');
      });
    }

    if (useVideoButton) {
      useVideoButton.addEventListener('click', uploadGenerated);
    }

    if (modeField) {
      modeField.addEventListener('change', () => {
        clearMessages();
        syncExportAvailability();
      });
    }

    window.addEventListener('pagehide', () => {
      stopRecording();
      revokeGeneratedUrl();
    });
    window.addEventListener('beforeunload', () => {
      stopRecording();
      revokeGeneratedUrl();
    });

    syncOrderButtons();
    syncExportAvailability();
    if (enabledField && enabledField.checked && listItems().length) {
      setStatus('Setup media is selected. Update the product to publish it.');
    }
  });
}());

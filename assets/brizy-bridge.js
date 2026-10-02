/* Reversible frontend enhancement: never edits Brizy's saved content. */
(() => {
  'use strict';
  const mount = (finalAttempt = false) => {
    const source = document.querySelector('template[data-ppg-brizy]');
    if (!source || source.dataset.mounted === '1') return;
    // A placed shortcode or standard WooCommerce hook always wins.
    if (document.querySelector('[data-ppg]')) { source.dataset.mounted = '1'; return; }
    const titles = [...document.querySelectorAll('.brz .brz-wp-title-content')];
    const candidates = titles.map(title => {
      const row = title.closest('.brz-row:not(.brz-row--inner)');
      if (!row || !row.querySelector('.brz-wp-post-content')) return null;
      const columns = [...row.children].filter(el => el.classList.contains('brz-columns'));
      if (columns.length !== 2) return null;
      const copy = columns.find(col => col.contains(title));
      const media = columns.find(col => col !== copy);
      const mediaItems = media && media.querySelector('.brz-column__items');
      // Do not hide unknown rich content, additional feature cards or embeds.
      if (!mediaItems || mediaItems.children.length !== 1 || !mediaItems.querySelector('.brz-image')) return null;
      const mediaWrapper = mediaItems.firstElementChild;
      const image = mediaWrapper.firstElementChild;
      const picture = image && image.firstElementChild;
      if (!mediaWrapper.classList.contains('brz-wrapper') || mediaWrapper.children.length !== 1 ||
          !image.classList.contains('brz-image') || image.children.length !== 1 ||
          !picture || picture.tagName !== 'PICTURE' || mediaWrapper.textContent.trim() ||
          picture.querySelectorAll('img').length !== 1 ||
          [...picture.children].some(el => !['SOURCE', 'IMG'].includes(el.tagName))) return null;
      const description = copy.querySelector('.brz-wp-post-content');
      if (!description || description.closest('.brz-row') !== row) return null;
      const outer = row.parentElement;
      if (!outer.classList.contains('brz-row__container')) return null;
      return {row, outer, copy, title, description};
    }).filter(Boolean);
    if (candidates.length !== 1) {
      if (finalAttempt && document.querySelector('.brz') && !document.querySelector('.ppg-mount-notice')) {
        const note = document.createElement('p');
        note.className = 'ppg-mount-notice'; note.setAttribute('role', 'status');
        note.setAttribute('data-ppg-bridge-notice', '1');
        note.textContent = 'The product gallery could not be placed automatically in this layout. The original product information has been kept.';
        const main = document.querySelector('main') || document.querySelector('.brz');
        main.append(note);
      }
      return;
    }
    const target = candidates[0];
    const fragment = source.content.cloneNode(true);
    const gallery = fragment.querySelector('[data-ppg]');
    if (!gallery || !gallery.querySelector('.ppg-copy')) return;
    const preserved = document.createElement('div'); preserved.className = 'ppg-preserved';
    const items = target.copy.querySelector('.brz-column__items');
    const titleWrapper = target.title.closest('.brz-wrapper');
    const descriptionWrapper = target.description.closest('.brz-wrapper');
    // Preserve supplemental icon rows/links exactly as authored.
    [...items.children].filter(el => el !== titleWrapper && el !== descriptionWrapper).forEach(el => preserved.append(el));
    if (preserved.childNodes.length) gallery.querySelector('.ppg-copy').append(preserved);
    gallery.classList.add('ppg-brizy-mounted');
    document.querySelectorAll('[data-ppg-bridge-notice]').forEach(note => note.remove());
    target.outer.before(fragment);
    target.outer.hidden = true;
    target.outer.setAttribute('data-ppg-original', '1');
    // Enforce hidden against builder display declarations, narrowly scoped.
    target.outer.style.setProperty('display', 'none', 'important');
    source.dataset.mounted = '1';
    if (window.PortareProductGallery) window.PortareProductGallery.init(gallery);
    document.dispatchEvent(new CustomEvent('ppg:mounted', {detail: {gallery}}));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount(), {once:true});
  else mount();
  // Brizy can hydrate late; bounded retries don't observe the entire page forever.
  let attempts = 0;
  const timer = window.setInterval(() => {
    mount(attempts >= 19);
    const source = document.querySelector('template[data-ppg-brizy]');
    if (++attempts >= 20 || !source || source.dataset.mounted === '1') window.clearInterval(timer);
  }, 250);
})();

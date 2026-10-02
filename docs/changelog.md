# Changelog

## 0.1.2 — 2026-10-02
- Replaced bottom Previous/Play/Next toolbar with small semi-transparent SVG arrows over each side of the main image and thumbnail strip.
- Added independent per-product main-image and thumbnail-arrow toggles (default on for legacy products).
- Thumbnail arrows scroll the strip only, hide when it fits, and disable at boundaries; responsive resize observation is cleaned up on teardown.
- Autoplay pause/resume is a discreet image overlay and is absent when autoplay is off.

## 0.1.1 — 2026-10-02
- Final staging verification: editor/media picker, per-image rich text, product controls, appearance settings, quote modal, arbitrary-page shortcode and desktop/mobile Brizy integration.
- Fixed featured focal-point retention, quote-off suppression and late-shortcode stylesheet loading.
- Brizy media eligibility rejects extra authored content; bounded retries clean up stale notices.
- Added 44px thumbnail touch targets and compact side-by-side retained icons on mobile.
- Main product description and all 16 template metadata hashes remain identical to the baseline.

## 0.1.0 — 2026-10-02
- WooCommerce gallery shortcode and per-product automatic mode.
- Per-image rich descriptions, scrolling thumbnail strip, reorder/framing controls.
- Per-product text side, quote-modal button/alignment and autoplay speed/off.
- Scoped typography/appearance/transition settings and responsive accessible frontend.
- Runtime-only Brizy bridge retains supplemental icons and surrounding template content.
- Retention-only uninstall, nonce/capability/KSES validation, unit/browser/WP integration tests.

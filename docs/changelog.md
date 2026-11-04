# Changelog

## 0.4.0 — Wan integration candidate, 2026-11-03
- Replaced the MiniMax-only prototype with a Wan member-CLI adapter and explicit first/last-frame controls.
- Added preview plus explicit Use this video, per-render paid/image-transfer consent and resume rather than automatic resubmission.
- Added pinned Node/Wan staging image inputs, restricted finished-media egress and private backup/content-snapshot tooling.
- Release verification and remaining live-provider gates are recorded in evidence; this candidate entry is not a claim of a completed paid render.

## 0.3.0 — 2026-11-02 (prototype, no verified generated clip)
- Added an optional motion-prompt/provider scaffold. The available MiniMax key did not establish a usable video-generation path; no real generated clip was proven.
- The provider credential stays server-side; every call is nonce and capability checked and needs explicit per-request consent before images are sent.
- Renders are tracked as jobs written before the paid call, rate limited, and validated (container, MIME, size, duration, frame size) before entering the Media Library as a draft.
- Generated clips publish only through a normal product Update.

## 0.2.0 — 2026-11-02
- Added isolated per-product Product Setup area: ordered pictures,15-second image sequences, uploaded videos and optional posters beneath gallery copy.
- Added local browser MP4 export/download and explicit authenticated save-to-Media-Library workflow; normal product Update controls publication.
- Added visible media/export/upload errors, playback coordination and reduced-motion/lifecycle handling.
- Preserved authored Brizy content by default; optional conservative runtime setup-row replacement only. Added metadata contract and reversible rollout notes.
- Added native fragmented-MP4 duration compatibility, normalized fallback metadata, and wrapped-row preservation regression coverage.
- AI-inferred folding motion is intentionally deferred; no paid API calls or external image transfer. The optional motion prompt is specified but not yet implemented.
- Shared Brizy template 11378 was re-saved by Brizy during the staging QA product Update (one duplicate section now hidden on desktop); compiled markup is otherwise identical and the plugin writes product metadata only.


## 0.1.4 — 2026-11-02
- Filmstrip uses uncropped medium-large responsive image families instead of 150px square thumbnails.
- Added filmstrip-specific responsive sizes while keeping lazy loading, async decoding, the existing crop, four-slot layout and controls.
- No media regeneration, stored-data changes or Brizy content edits.

## 0.1.3 — 2026-11-02
- Added a product-specific, read-only shortcode and Copy shortcode button at the top of the product editor’s Portare Gallery tab.
- Added accessible copy feedback, clipboard fallback/manual-copy guidance and manual-placement instructions.
- No frontend placement, stored settings, product content or Brizy template changes.

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

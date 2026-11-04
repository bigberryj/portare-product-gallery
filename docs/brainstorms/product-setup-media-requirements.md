# Product Setup Media — draft requirements

Status: implemented as a 0.2.0 staging candidate and exercised through real editor/export/upload/playback tests. Final independent review pending. True-motion generation and paid-provider use remain explicitly deferred.

## Goal
Add a per-product setup-media area beneath the description, in the position occupied by the folding illustrations in the operator's screenshot. Keep it separate from the main image gallery and thumbnail filmstrip.

## Requested modes
- Static setup pictures: select/order images from the Media Library; support the current illustration-style presentation.
- Animated image sequence: select 2–4 images and preview a 15-second sequence using fades and optional gentle pan/zoom. This is a presentation of existing pictures, not inferred folding motion.
- Video export: generate a downloadable 15-second video of the selected image sequence, preview before use, and allow the export to be selected for the setup-media panel.
- Uploaded video/animation: choose a prepared setup video, poster and accessible playback controls.
- Actual setup-motion generation: requested and NOT YET IMPLEMENTED. Distinct from the sequence/export modes. Requires a separately validated generation/animation approach and review for physically accurate product setup. Never silently substitute a slideshow and label it folding animation. No paid generation or third-party image transfer without explicit approval.
- Optional AI motion prompt: required for the actual motion generator. Let the operator describe the desired setup action, movement order, camera behavior and constraints; a blank prompt uses an appropriate default. Example: “Show the table unfolding from its folded position to fully open, following the uploaded setup steps. Keep the camera fixed and preserve the product’s shape and proportions.” This prompt control and its generation integration are NOT YET IMPLEMENTED. Generated motion must remain a draft for preview/review and explicit selection before normal product Update publishes it.

## Controls and presentation
- Controls live under Product data > Portare Gallery, in a dedicated Product Setup section.
- Per-product show/hide, media mode, heading/caption, image order, preview, replacement/removal of associations without Media Library deletion.
- Play/pause and reduced-motion handling. Prevent simultaneous playback from duplicate gallery instances.
- Preserve existing authored setup illustrations until a replacement has been intentionally selected and saved. Do not rewrite Brizy templates or unrelated product content.
- Scope replacement conservatively; unclear preserved-content targeting must not hide authored blocks.
- Keep the panel compact below the product copy and responsive on phones. Do not add setup images to the main filmstrip automatically.

## Constraints and open decisions
- Local inspection found ffmpeg/ffprobe on the development machine; neither executable was found on the current Railway web container PATH. Video export needs an explicit rendering/deployment solution; do not assume the web host can encode MP4 today.
- Prefer the low-cost deterministic sequence/export for immediately useful functionality. Actual folding motion needs user-reviewed reference movement or a validated optional generator; no guarantee of mechanical accuracy from a few stills.
- Confirm the true-motion approach and any third-party/cost permissions before enabling it. A draft must never be published automatically.
- Future implementation needs metadata documentation, preservation snapshots, focused editor/browser tests, real exported-file duration/playback verification and a staging-only rollout.

## Existing integration references
- `includes/class-ppg-admin.php`: product tab controls and nonce/capability-checked saving.
- `includes/class-ppg.php`: gallery rendering and normalized product metadata.
- `assets/brizy-bridge.js`: conservative runtime integration and retained authored supplemental content.
- `docs/schema.md`: current product/gallery storage contract.

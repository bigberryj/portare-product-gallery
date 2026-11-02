# Security

## Setup-media trust boundaries (0.2.0)
- Product setup writes require their own product-scoped nonce plus `edit_post` and product/autosave/revision guards. Image/video selections validate real attachment type/MIME, dedupe and cap; no arbitrary remote URL fetch or SVG/HTML rendering.
- Generated upload requires authentication, `edit_post` on that product, `upload_files`, export nonce and rate limiting. Verify actual bytes/size, MP4 file signature/MIME, readable video metadata and bounded duration/dimensions before admitting it to the library. Do not trust file extension or client Content-Type; generated filenames are server-owned.
- These are intentionally **public product media**, stored through WordPress Media Library using core upload validation, not private invoices/receipts. Customer/private attachments must not use this path. No custom executable upload types, filesystem path inputs or arbitrary command execution.
- Browser canvas renders only validated raster media and catches missing/CORS-tainted images. Capability/recording/interruption failures cannot produce a false successful MP4. Recording occurs locally; no photos go to an AI provider.
- UI previews use text/DOM construction, server text/URLs/attributes escape, embedded JSON uses HEX flags. Playback/export cleanup handles removal/cancel/visibility. No automatic publication or attachment deletion when associations change.


- Product save requires valid product-scoped nonce, `edit_post` capability and product type, and rejects autosaves/revisions.
- Settings writes use the WordPress Settings API with `manage_options`.
- Attachment IDs are strictly positive decimal integers, verified as images and deduplicated; submitted rows are capped at 100.
- Rich text uses a narrow WordPress KSES allowlist without script, style, events, images or arbitrary classes. Link protocols are filtered by WordPress.
- Typography/CSS settings use fixed font stacks, strict six-digit colors, enumerated modes and finite bounded numbers. Unknown fields are discarded.
- Public rendering rejects unpublished, password-protected and non-product IDs. Output attributes/URLs/text are escaped and JSON uses all HEX flags.
- No arbitrary remote URL import, public write endpoint, external telemetry, AI-provider calls or embedded secrets. Generated setup-video uploads are authenticated, nonce/capability-checked and validated as described below.
- Gallery removal deletes associations only. Deactivation/uninstall preserve authored metadata and settings.
- QA authentication uses short-lived staging-only sessions stored outside the repository; tokens are revoked after testing and never included in release evidence.

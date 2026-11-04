# Security

## Wan motion trust boundaries (0.4.0 candidate)
- Server-only `WAN_ACCESS_KEY` / protected `PPG_WAN_ACCESS_KEY`; Railway's runtime helper must propagate it to the actual web worker. No credentials in browser markup, responses, job options, source or release artifacts.
- Authenticated product-scoped nonce/capability checks protect generation and recovery. Frames are two distinct allowlisted local raster attachments selected from the product's setup image pool; IDs, actual content and file bounds must validate before external transfer.
- **Each render needs explicit paid-credit + external-image-transfer consent.** No generation on load, no automatic retry after an uncertain outcome. Exact credit cost and mechanical accuracy are not guaranteed.
- Plain-text prompt max500characters, fixed duration5/10/15seconds and resolution480P/720P. These become JSON/argv values, never a shell command. The PHP transport and fixed Node runner are not an arbitrary command API.
- Persist intent before submission, preserve uncertain paid jobs for recovery, exclude concurrent submission for the product, and serialize/idempotently recover imports. Concurrency/persistence tests and independent review are release gates, not properties established merely by a happy-path mock.
- The child environment excludes database/Railway/mail secrets. Private working directories and credentials must be cleaned up, with bounded process time/output and termination restricted to processes this request spawned. Never execute or evade a locally blocked Wan bundle to run a test; fixture transports do not prove live provider access.
- Finished-media downloads use bounded HTTPS GETs to approved official CDN suffixes (`alicdn.com`, `aliyuncs.com`, `wanxai.com`, `wan.video`) with hostname-label boundaries, TLS/public-IP validation, no credentials and no non443ports. Each redirect needs fresh validation; WordPress automatic redirects stay disabled. Staging's general outbound integration block remains enabled; the narrowly marked media exception is not general API egress.
- Imported files need a real MP4 signature/MIME and readable finite duration/dimensions; ceiling25MiB, duration2–17seconds, each dimension at most1280pixels. This is separate from the still-export endpoint's14–17second/1280×720 policy. Rejected temporary bytes are cleaned up.
- Imported media are **public WordPress attachments**, not private drafts. Import/preview do not change product selection; only explicit Use stages the fields, followed by normal product Update. Disassociation/uninstall do not delete shared media.
- Show actionable, bounded errors without raw provider stderr, credentials, authorization headers, local secret paths or signed download queries. Network/parse/timeouts are not proof that the provider rejected a paid task.
- No real paid result or provider authentication is implied by offline suites. See release evidence for exactly what ran and which credential/live-result gates remain open.

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
- No arbitrary remote URL import, public write endpoint, external telemetry or embedded secrets; optional explicitly approved Wan generation is the external-provider exception. Generated setup-video uploads are authenticated, nonce/capability-checked and validated as described below.
- Gallery removal deletes associations only. Deactivation/uninstall preserve authored metadata and settings.
- QA authentication uses short-lived staging-only sessions stored outside the repository; tokens are revoked after testing and never included in release evidence.

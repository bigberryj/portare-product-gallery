# Integration surfaces

## Product Setup
- `PPG_Setup::config($id)`, `sanitize($raw)`, `render($id)`, `panel($id)`, `save($id)`: isolated setup controls and media rendering.
- `window.PortareSetupMedia.init(container)` / `destroy(root)`: independent setup-player lifecycle.
- Setup `.ppg-setup-data` contains only escaped local presentation data and fixed15000ms timing; it is not a write interface.
- Authenticated `POST wp-admin/admin-ajax.php`, multipart fields `action=ppg_setup_upload`, `product_id`, `nonce` for `ppg_setup_export_{id}`, file `setup_video`.
- Success envelope `{success:true,data:{id,url}}` describes the new public Media Library attachment. It does **not** update the product selection; normal nonce-checked Update persists `_ppg_setup`.
- Reject missing/unauthorized/invalid nonce requests, over25MB files, non-MP4 content, dimensions beyond1280x720 and clips outside14–17seconds. Uploaded prepared videos use the normal Media Library picker; the stricter generator endpoint is for bounded15-second exports.

## Product setup AI motion

All three actions require an authenticated user with `edit_post` on the product plus `upload_files`, and a per-product nonce (`ppg_setup_ai_{product_id}`). The provider credential is read server-side only; it is never emitted into markup or JSON.

- `POST wp-admin/admin-ajax.php`, action `ppg_setup_ai_generate`: start one AI motion render. Fields `product_id`, `nonce`, `consent=1`, `prompt` (optional, max500characters), `first_frame_id`, `last_frame_id`, `duration` (5/10/15) and `resolution` (480P/720P). Frames must be two distinct PNG/JPEG/WebP attachments in the product's setup image list. Durable intent is required before the paid provider call; ambiguous submission outcomes are not automatically resubmitted.
- `POST wp-admin/admin-ajax.php`, action `ppg_setup_ai_status`: poll one render. Fields `product_id`, `nonce`, `job_id`. An absent/blank job ID recovers the current user's latest job on that product; a malformed nonblank ID is rejected rather than treated as recovery. Returns `idle`, a processing/unknown-submission state, `succeeded` (with `attachment_id` and local `url`) or a visible failure reason. Ownership is checked; another user's job is not disclosed.
- Failure codes: `invalid_product` (400), `forbidden` / `invalid_nonce` / `consent_required` (403), `invalid_images` / `invalid_job` (400), `unknown_job` (404), `already_running` (409), `job_failed` (409), `provider_not_configured` (503), `provider_error` (upstream status), `rate_limited` (429).
- `POST` action `ppg_setup_ai_health` is a per-product nonce/capability-checked runtime/authentication check, rate-limited to one per60seconds, not a generation call; it must not be run merely to render the editor's public configuration.
- Imported attachments are ordinary **public** Media Library assets. Import/preview never writes `_ppg_setup`; explicit Use stages fields and normal product Update persists the selection.
- `public_config()` checks configuration/runtime availability without executing Wan. A successful offline test is not proof of provider access or a successful paid render.

## Main gallery

- `[portare_product_gallery]`: render current product context.
- `[portare_product_gallery product_id="10440"]`: render an explicit published, non-password-protected product.
- `PPG::config($id)`, `PPG::render($id)`: normalized config and escaped gallery HTML.
- `window.PortareProductGallery.init(container)`: idempotent late-builder initialization. `destroy(root)` cancels pending work.
- The gallery `.ppg-data` script contains sanitized descriptions and image metadata; it is local render data, not a public write endpoint.
- Quote button delegates to `PQB::button()` / `.pqb-open[data-pqb-product]`. Product options/modal/AJAX submission stay owned by Portare Quote Builder.

No public mutation endpoints. Authenticated generated-video upload uses the bounded admin-AJAX endpoint described below. Product editing uses WooCommerce's normal Update submission with a product-specific nonce. Appearance settings use WordPress options.php / Settings API.

# Integration surfaces

## Product Setup
- `PPG_Setup::config($id)`, `sanitize($raw)`, `render($id)`, `panel($id)`, `save($id)`: isolated setup controls and media rendering.
- `window.PortareSetupMedia.init(container)` / `destroy(root)`: independent setup-player lifecycle.
- Setup `.ppg-setup-data` contains only escaped local presentation data and fixed15000ms timing; it is not a write interface.
- Authenticated `POST wp-admin/admin-ajax.php`, multipart fields `action=ppg_setup_upload`, `product_id`, `nonce` for `ppg_setup_export_{id}`, file `setup_video`.
- Success envelope `{success:true,data:{id,url}}` describes the new public Media Library attachment. It does **not** update the product selection; normal nonce-checked Update persists `_ppg_setup`.
- Reject missing/unauthorized/invalid nonce requests, over25MB files, non-MP4 content, dimensions beyond1280x720 and clips outside14–17seconds. Uploaded prepared videos use the normal Media Library picker; the stricter generator endpoint is for bounded15-second exports.

## Main gallery

- `[portare_product_gallery]`: render current product context.
- `[portare_product_gallery product_id="10440"]`: render an explicit published, non-password-protected product.
- `PPG::config($id)`, `PPG::render($id)`: normalized config and escaped gallery HTML.
- `window.PortareProductGallery.init(container)`: idempotent late-builder initialization. `destroy(root)` cancels pending work.
- The gallery `.ppg-data` script contains sanitized descriptions and image metadata; it is local render data, not a public write endpoint.
- Quote button delegates to `PQB::button()` / `.pqb-open[data-pqb-product]`. Product options/modal/AJAX submission stay owned by Portare Quote Builder.

No public mutation endpoints. Authenticated generated-video upload uses the bounded admin-AJAX endpoint described below. Product editing uses WooCommerce's normal Update submission with a product-specific nonce. Appearance settings use WordPress options.php / Settings API.

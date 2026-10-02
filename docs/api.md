# Integration surfaces

- `[portare_product_gallery]`: render current product context.
- `[portare_product_gallery product_id="10440"]`: render an explicit published, non-password-protected product.
- `PPG::config($id)`, `PPG::render($id)`: normalized config and escaped gallery HTML.
- `window.PortareProductGallery.init(container)`: idempotent late-builder initialization. `destroy(root)` cancels pending work.
- The gallery `.ppg-data` script contains sanitized descriptions and image metadata; it is local render data, not a public write endpoint.
- Quote button delegates to `PQB::button()` / `.pqb-open[data-pqb-product]`. Product options/modal/AJAX submission stay owned by Portare Quote Builder.

No new REST, admin-AJAX or public mutation endpoints. Product editing uses WooCommerce's normal Update submission with a product-specific nonce. Appearance settings use WordPress options.php / Settings API.

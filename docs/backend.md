# Backend integration and test notes

## Usage

Activate alongside WooCommerce. In the classic WooCommerce product editor open **Product data → Portare Gallery**. Save/update the product after selecting images, rich descriptions, alignment, autoplay and placement. Appearance settings live under **Settings → Portare Gallery** and use the WordPress Settings API (`manage_options`).

Shortcode: `[portare_product_gallery]` uses the current product. `[portare_product_gallery product_id="10440"]` resolves only a published, non-password-blocked product. Explicit malformed IDs do not fall back to current context. Explicit shortcodes work even when automatic integration is disabled.

## PHP/renderer boundary

Public methods `PPG::config($id)`, `PPG::render($id)`, and `PPG::should_auto($id)` are available to the separate Brizy bridge. `PPG::register_assets()` runs on `wp_enqueue_scripts` and enqueues gallery assets for enabled/auto product pages, including builder pages that never execute WooCommerce rendering hooks. Shortcode rendering also registers/enqueues these assets.

Standard hooks replace product images at priority 20 and remove title at 5 / excerpt at 20 only for opted-in automatic products. Prices are never emitted by this renderer; existing quote-only site's price policy remains owned by its quote plugin. No global description or content filters are registered. When this gallery owns the quote button it removes only `PQB::single_button` at its actual priority; `PQB::button(['product_id'=>ID])` owns escaped button HTML and existing modal behavior. If PQB is inactive, the gallery does not fabricate a second modal/button. Quote disabled preserves PQB's existing standard summary button.

Brizy integration belongs to a separate parent-agent implementation. This backend never rewrites post_content or Brizy metadata. The root markup, JSON data payload and CSS variables follow the shared plan. Gallery CSS/JS are supplied by a different implementation task and are not authored here.

Featured images are always first; other custom images maintain saved ordering. Thumbnail swaps receive sanitized per-slide descriptions. All dynamic thumbnail controls are buttons, with indexed labels and initial aria-pressed state. The renderer still produces a title/description when no valid images exist.

## Security boundaries

Product saves require a product post, `edit_post`, matching product-specific nonce, editor form marker, and no revision/autosave. Every dynamic row uses one keyed structure, including attachment ID and text; normalization happens before rendering and saving. Attachments must be images. IDs are strictly canonical positive decimal integers, not loosely cast. Flags only accept true/1/"1". Finite numeric bounds and fixed font/color/motion allowlists prevent CSS injection. HTML is sanitized with a restrictive `wp_kses` allowlist on both read and write; script JSON uses all four JSON HEX flags. Title/attributes/URLs are escaped at their output contexts.

## Local verification

`php tests/run-tests.php` runs standalone test doubles (no WordPress/database required). Covers normalization, malformed structures and IDs, 6-image fallback, featured-first custom ordering, rich-text allowlist, title escaping, JSON HEX, public product gating, scoped hooks/PQB suppression, asset enqueue on automatic builder pages, product save authorization/nonce/revision/autosave/type checks, option registration and editor markup.

The KSES double checks plugin allowlist usage and strips disallowed tags; it is NOT a substitute for exercising real WordPress's attribute/protocol sanitizer. Browser/editor media-picker behavior, TinyMCE drag lifecycle, actual WooCommerce/Brizy layouts, responsive thumbs and PQB modal are not browser-tested by this backend task. Live integration verification is owned by the parent task.

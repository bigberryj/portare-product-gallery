# Portare Product Gallery

Price-free, description-led WooCommerce product galleries. Requires WordPress 6.5+, PHP 7.4+, and WooCommerce; quote integration requires Portare Quote Builder.

## Install
Upload the plugin ZIP using **Plugins → Add New → Upload Plugin**, then activate. Alternatively copy this folder to `wp-content/plugins/portare-product-gallery/`. No npm/build step is needed at runtime. Automatic replacement is disabled on products by default.

## Product editor
**Products → Edit product → Product data → Portare Gallery**:
- Enable automatic gallery and choose automatic placement, or use shortcode-only mode.
- Choose text on the left or right, quote-button enabled/disabled and left/center/right alignment.
- Enable/disable automatic rotation and set an interval of 1–120 seconds.
- Independently toggle **Show main image overlay arrows** and **Show thumbnail strip overlay arrows**.
- Add images from the Media Library. New selections append without duplicates.
- Add formatted paragraphs per photograph, reorder with drag or Up/Down, set focal point/zoom, or remove gallery associations. Media Library files are never deleted by this plugin.
- Save using the normal product **Update** button.

The WooCommerce **featured image stays first** and uses the full main product description. Change that primary image in WooCommerce's Product image panel. Additional gallery images may have custom text; blank text falls back to the main description. The featured image is outside the custom gallery association list conceptually; removing it from the custom rows does not remove it from WooCommerce. Removing all custom rows restores the WooCommerce featured + gallery fallback. If there are no images, a readable empty state is shown.

## Shortcode
```
[portare_product_gallery]
[portare_product_gallery product_id="10440"]
```
Use a Brizy shortcode element, a WordPress Shortcode block, or another shortcode-rendering surface. Explicit IDs must be published, non-password-protected WooCommerce products. Shortcodes work independently of the automatic-enable toggle. A manually placed gallery takes precedence over automatic Brizy enhancement.

## Settings
**Settings → Portare Gallery** contains fonts (theme inherit/system/sans/serif), text/title sizes and colors, line height, copy-column width, gap, image ratio/rounding, thumbnail spacing/rounding, accent, fade/slide/no image transition, animation duration, entrance effect and text-fade toggle. Styles are scoped to gallery roots. Quote-button colors remain governed by the existing quote plugin/theme, avoiding competing appearance controls.

## Brizy preservation
On supported Brizy product templates, automatic mode enhances the existing two-column introductory row with a dynamic product title/description and one main image. The saved template, compiled assets and product content are not rewritten. Supplemental icon rows are retained inside the gallery copy column; hero, feature sections, videos, related products and footer remain in place. Disable automatic mode or deactivate the plugin to restore the original frontend layout. JavaScript-disabled visitors retain the original Brizy section.

Detection is deliberately conservative: exactly one eligible row, two columns, dynamic title/content and a single image-only media column. Unsupported layouts remain unchanged and receive a visible placement notice; place a shortcode manually in that case. Brizy editor mode is not enhanced. Standard WooCommerce templates use scoped hooks instead.

## Interaction
Four thumbnail slots on desktop, horizontal scrolling for additional images, swipe and keyboard arrows/Home/End, semi-transparent main-image and thumbnail-strip overlay arrows (no bottom button row). Clicks update both the image and its description after the new image loads. Failed loads retain the last valid content and show an error. Manual selection stops autoplay; hover, focus and hidden tabs pause it. Reduced-motion visitors do not auto-start. Autoplay-enabled products have only a small pause/resume icon over the image. Thumbnail arrows scroll without selecting another image and hide when no overflow exists. Mobile order: title, image, thumbnails, description, quote, retained icons.

## Data retention and removal
No custom tables. Product gallery metadata and appearance options are retained on deactivation/uninstall. Media files, WooCommerce descriptions and Brizy content are never deleted. See `docs/schema.md`.

## Developer checks
```
php tests/run-tests.php
php qa/lint.php
npm ci
npm test
npx playwright install chromium
npm run test:browser
```
`tests/wp-integration.php` is a staging-only WP-CLI test using product 10440, restoring plugin metadata/settings after execution. Never run it on production. Real-site browser verification and release evidence are recorded separately from fixture tests.

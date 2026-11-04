# Portare Product Gallery

Price-free, description-led WooCommerce product galleries. Requires WordPress 6.5+, PHP 7.4+, and WooCommerce; quote integration requires Portare Quote Builder.

## Install
Upload the plugin ZIP using **Plugins → Add New → Upload Plugin**, then activate. Alternatively copy this folder to `wp-content/plugins/portare-product-gallery/`. No npm/build step is needed for the gallery or browser export. Optional Wan generation additionally needs the server runtime described below. Automatic replacement is disabled on products by default.

## Product editor
At the top of the Portare Gallery tab, use the read-only **Gallery shortcode** field and **Copy shortcode** button. The explicit product ID works on any page or elsewhere on the same product page. Choose **Shortcode only** to disable automatic placement without disabling your shortcode. If clipboard access is blocked, select the field and copy manually. No product update is needed to obtain the code.

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

## Product Setup media
In **Products → Edit product → Product data → Portare Gallery → Product Setup**, enable the panel and choose:
- **Pictures**: up to four ordered setup illustrations/photos, separate from the main filmstrip.
- **15-second sequence**: two to four images with fades and optional gentle image movement; Play/Pause is visitor-controlled.
- **Video**: choose a prepared MP4/WebM from the Media Library with an optional poster.

Use **Preview** to check unsaved choices. **Generate 15-second MP4** renders a real video locally in a supported browser—keep the tab in the foreground. Download it, or save it to the Media Library and then click the product's normal **Update** to publish the selection. Video generation is an image presentation, not synthesized folding mechanics. Unsupported recording, missing images, tainted canvas, interrupted recording and upload failures show visible errors rather than pretending to succeed. No outside generator, AI charge, server FFmpeg or new paid service is used.

The setup area is below the description. Existing Brizy artwork stays unchanged by default. Optional replacement applies only to one safely identifiable image-only retained setup row on automatically mounted galleries; ambiguous rows, links and other authored content remain visible. On manually placed shortcodes, separate Brizy blocks outside the gallery are not removed. Replacing/deleting associations never deletes shared Media Library files. AI-inferred motion uses the separately configured Wan workflow below and always needs operator review.

## Settings
**Settings → Portare Gallery** contains fonts (theme inherit/system/sans/serif), text/title sizes and colors, line height, copy-column width, gap, image ratio/rounding, thumbnail spacing/rounding, accent, fade/slide/no image transition, animation duration, entrance effect and text-fade toggle. Styles are scoped to gallery roots. Quote-button colors remain governed by the existing quote plugin/theme, avoiding competing appearance controls.

## Brizy preservation
On supported Brizy product templates, automatic mode enhances the existing two-column introductory row with a dynamic product title/description and one main image. The saved template, compiled assets and product content are not rewritten. Supplemental icon rows are retained inside the gallery copy column; hero, feature sections, videos, related products and footer remain in place. Disable automatic mode or deactivate the plugin to restore the original frontend layout. JavaScript-disabled visitors retain the original Brizy section.

Detection is deliberately conservative: exactly one eligible row, two columns, dynamic title/content and a single image-only media column. Unsupported layouts remain unchanged and receive a visible placement notice; place a shortcode manually in that case. Brizy editor mode is not enhanced. Standard WooCommerce templates use scoped hooks instead.

## Filmstrip image quality
Filmstrip images use the uncropped WordPress medium-large image family with responsive source selection instead of tiny square thumbnails. Lazy loading and asynchronous decoding keep downloads efficient; the visible filmstrip size and cover crop are unchanged. Existing generated image sizes are reused; no thumbnail regeneration is required.

## Interaction
Four thumbnail slots on desktop, horizontal scrolling for additional images, swipe and keyboard arrows/Home/End, semi-transparent main-image and thumbnail-strip overlay arrows (no bottom button row). Clicks update both the image and its description after the new image loads. Failed loads retain the last valid content and show an error. Manual selection stops autoplay; hover, focus and hidden tabs pause it. Reduced-motion visitors do not auto-start. Autoplay-enabled products have only a small pause/resume icon over the image. Thumbnail arrows scroll without selecting another image and hide when no overflow exists. Mobile order: title, image, thumbnails, description, quote, retained icons.

## Data retention and removal
No custom tables. Product gallery metadata and appearance options are retained on deactivation/uninstall. Media files, WooCommerce descriptions and Brizy content are never deleted. See `docs/schema.md`.

## AI motion creator (optional)

**Wan membership/CLI access and usable paid credits are required.** The panel always explains its configuration state. The Wan adapter replaces the unverified MiniMax-only prototype; an old `PPG_AI_VIDEO_KEY` does not enable Wan.

1. The WordPress host needs Node22+ and the pinned `@wan-ai/cli@0.0.3` runtime at the fixed paths in `deploy/wordpress/README.md`. The plugin ZIP alone does not install these system dependencies.
2. Set `WAN_ACCESS_KEY` in the **server's secret environment**, or configure the `PPG_WAN_ACCESS_KEY` PHP constant through your host's protected configuration. Never put the real value in source control, product content, browser JavaScript or chat. Local `wan auth login` does not authenticate Railway.
3. On Railway/OpenLiteSpeed, use the included startup allowlist so the key reaches the web worker through `railway_env()`. A shell environment check alone is insufficient.
4. In the product's setup panel, choose two distinct **First frame / Last frame** images from the setup image list. Use matching viewpoints where possible. Enter an optional plain-text motion prompt (max500characters), and choose5/10/15seconds and480P/720P.
5. Check the **paid credits + external image transfer** approval box for each render, then select **Generate with Wan**. No render starts on page load. **Resume** checks an existing job without purchasing another.
6. Review the completed preview, press **Use this video**, then save the normal product **Update**. Generation and preview do not change the product's selected video. Imported attachments are ordinary public Media Library assets, not private storage.

Errors are visible. An uncertain submission must not be retried automatically: use Resume and check the account's task history before any new purchase. AI-generated folding is not mechanically guaranteed; reject a clip that invents hinges, changes parts or depicts an unsafe setup sequence. Credit balance is not a count of remaining videos, and no exact render price is inferred from the balance.

See `deploy/wordpress/README.md` for the runtime/credential/deployment instructions, `docs/security.md` for limits and `evidence/` for the actually exercised verification scope.

## Developer checks
```
php tests/run-tests.php
php tests/setup-tests.php
php tests/setup-ai-tests.php
php tests/wan-isolation-tests.php
php qa/lint.php
npm ci
npm test
npx playwright install chromium
npm run test:browser
```
`tests/wp-integration.php` is a staging-only WP-CLI test using product 10440, restoring plugin metadata/settings after execution. Never run it on production. Real-site browser verification and release evidence are recorded separately from fixture tests.

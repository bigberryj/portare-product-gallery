# Architecture

## Product Setup media (0.2.0)
`PPG_Setup` isolates setup metadata normalization, product editor controls, render markup and authenticated generated-video upload. It uses existing WordPress attachment/media APIs; public product pictures/videos are intentionally public assets, not private customer records. New setup assets are independent of `gallery.js` selection and autoplay. The main renderer inserts setup media inside the copy column before the quote button. Root-scoped styles provide phone grid ordering.

Canvas/MediaRecorder performs the15-second MP4 render in the administrator's foreground browser, using same-origin/CORS-allowed raster images. Browser capability and media loads must succeed before recording; errors/cancellation release streams and URLs and do not yield a successful draft. Saving to the library is an explicit action, and publishing the selection remains normal product Update. No new server encoding dependency or AI-provider integration exists. Native fragmented MP4 exports receive completed movie/track duration headers for consistent15-second presentation. A bounded ISO-BMFF movie-header reader supplements the older WordPress/getID3 duration reader; size, signature/MIME, dimensions and duration gates still apply. Original setup attachment renditions avoid archived derivative redirect/CORS failures during canvas export.

Optional Brizy illustration replacement is reversible browser DOM behavior only: one image-only inner row in the bridge-owned preserved container, explicit per-product opt-in, valid replacement media. No template/post-content writes; ambiguous rows remain with an explanatory notice.


`PPG` normalizes metadata/settings, renders public products and handles standard WooCommerce automatic hooks. `PPG_Admin` owns product-tab editing, attachment associations and Settings API. `PPG_Brizy` skips standard replacement when a Brizy template is active and emits an inert footer template plus a conservative runtime bridge.

The Brizy bridge inserts the gallery next to the original introductory row, moves supplemental icon rows into a retained container, and hides only the original row in the browser. No product or template content is overwritten. Existing shortcode roots win over the automatic bridge. Unrecognized layouts fail closed, leaving original content visible.

The root-scoped ~5KB stylesheet is enqueued before content to support shortcodes/Brizy modules rendered after wp_head. Gallery JS loads only for automatic products or actual renders. A public idempotent init API handles late builder insertion. Image switching waits for load and uses a request generation token. Description HTML is allowlisted by PHP before entering JSON; JSON HEX escaping prevents script-context breakout.

Quote integration reuses `PQB::button()` and its delegated click handler. This plugin neither creates a new quote modal nor submits prices/quote records. The existing lower Brizy product block remains authored and unchanged.

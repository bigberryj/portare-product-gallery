# Architecture

`PPG` normalizes metadata/settings, renders public products and handles standard WooCommerce automatic hooks. `PPG_Admin` owns product-tab editing, attachment associations and Settings API. `PPG_Brizy` skips standard replacement when a Brizy template is active and emits an inert footer template plus a conservative runtime bridge.

The Brizy bridge inserts the gallery next to the original introductory row, moves supplemental icon rows into a retained container, and hides only the original row in the browser. No product or template content is overwritten. Existing shortcode roots win over the automatic bridge. Unrecognized layouts fail closed, leaving original content visible.

The root-scoped ~5KB stylesheet is enqueued before content to support shortcodes/Brizy modules rendered after wp_head. Gallery JS loads only for automatic products or actual renders. A public idempotent init API handles late builder insertion. Image switching waits for load and uses a request generation token. Description HTML is allowlisted by PHP before entering JSON; JSON HEX escaping prevents script-context breakout.

Quote integration reuses `PQB::button()` and its delegated click handler. This plugin neither creates a new quote modal nor submits prices/quote records. The existing lower Brizy product block remains authored and unchanged.

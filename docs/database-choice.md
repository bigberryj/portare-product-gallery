# Database and data-access choice

Decision: use the existing WordPress database and core metadata/Options APIs. No separate database or ORM is introduced. WooCommerce owns products and attachments; the plugin owns only `_ppg_config`, `_ppg_slides` and `ppg_settings`.

Why: WordPress/WooCommerce already supply access control, escaping, serialization, attachment lookup and save hooks. Custom tables would add migration/backup complexity with no benefit for a small per-product ordered list. Revisit only if galleries require external synchronization or large per-slide analytics. No database credentials are read or stored by this plugin.

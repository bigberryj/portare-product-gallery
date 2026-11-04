# Storage rollout / rollback

v3 (0.2.0) adds `_ppg_setup` to existing WordPress postmeta via core APIs. **Forward:** missing values read as disabled; only a product-specific, nonce-checked Update persists selected setup media. No activation migration, DDL or bulk rewrite. **Reverse:** disable Product Setup or roll plugin files back to 0.1.4; the older plugin ignores `_ppg_setup` and retains its data/media. Never delete shared Media Library attachments during rollback. Before rollback while an editor is open, preserve the latest product metadata rather than restoring an earlier whole-product snapshot.

v2 adds optional `main_arrows` / `thumb_arrows` flags inside `_ppg_config`; absent values default to on and there is no DDL or bulk metadata rewrite. Rollback to v0.1.1 ignores the new flags while keeping all images/text.

v1 adds optional metadata keys to existing WordPress tables through core APIs. There is no DDL migration or new table. Missing/legacy/malformed values normalize to safe defaults on read; activation writes no authored data. Product Update persists normalized config/slides. Settings API persists normalized appearance options.

Forward: activate plugin and opt a selected product into automatic mode, or place a shortcode. Record original selected-product metadata before a rollout. Reverse: disable automatic mode, remove only a newly created shortcode, or deactivate the plugin. This restores original Brizy rendering without touching saved templates. Preserve metadata/options/media by default; no destructive reverse migration is run.

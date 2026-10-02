# Storage rollout / rollback

v1 adds optional metadata keys to existing WordPress tables through core APIs. There is no DDL migration or new table. Missing/legacy/malformed values normalize to safe defaults on read; activation writes no authored data. Product Update persists normalized config/slides. Settings API persists normalized appearance options.

Forward: activate plugin and opt a selected product into automatic mode, or place a shortcode. Record original selected-product metadata before a rollout. Reverse: disable automatic mode, remove only a newly created shortcode, or deactivate the plugin. This restores original Brizy rendering without touching saved templates. Preserve metadata/options/media by default; no destructive reverse migration is run.

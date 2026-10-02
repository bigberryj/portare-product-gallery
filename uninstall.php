<?php
/** Retention is intentional: uninstall never deletes product metadata or media. */
defined('WP_UNINSTALL_PLUGIN') || exit;
// Keep ppg_settings, _ppg_config, and _ppg_slides for reinstallation.

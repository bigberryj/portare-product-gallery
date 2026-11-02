<?php
/** Retention is intentional: uninstall never deletes product metadata or media. */
defined('WP_UNINSTALL_PLUGIN') || exit;
// Keep ppg_settings, _ppg_config, _ppg_slides, _ppg_setup and setup media for reinstallation.

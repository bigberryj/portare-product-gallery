<?php
/** Retention is intentional: uninstall never deletes product metadata or media. */
defined('WP_UNINSTALL_PLUGIN') || exit;
// Keep ppg_settings, _ppg_config, _ppg_slides, _ppg_setup and setup media for reinstallation.
// Retain legacy _ppg_ai_jobs plus Wan _ppg_ai_job_*, _ppg_ai_index_* and
// _ppg_ai_lock_* options: uninstall must not orphan an uncertain paid render.

<?php
/**
 * Plugin Name: Railway Brizy Editor Lock (Staging)
 * Description: Stops a concurrent editor session from locking the operator out of the Brizy builder on staging.
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Brizy stores a single project-wide "edit lock" as `_edit_lock` post meta on
 * the `brizy-project` post and refuses to render an editable canvas when
 * another user holds it. The client then shows:
 *
 *   "You can't make changes. <user> is currently working on this page.
 *    Do you want to take over?"
 *
 * The lock is refreshed by the holder's 30-second heartbeat and expires only
 * after 150 seconds without a refresh, so with two sessions open against the
 * same project the lock flips back and forth and the operator is intermittently
 * locked out of every template -- including on pages they are actively editing.
 *
 * This is an isolated, single-team staging clone, so the builder should never
 * hard-block the operator. Neutralise only the *read* of the lock for the
 * Brizy project post: `wp_check_post_lock()` sees no lock and returns false,
 * so the editor never enters read-only mode. The lock is still written and
 * still observable for debugging; only its ability to gate the canvas is
 * removed. Last-write-wins applies to concurrent edits on the same project.
 *
 * Scoped twice on purpose:
 *   - `staging` environment only, so production keeps the upstream behaviour.
 *   - `brizy-project` post type only, so the normal WordPress post-editing
 *     lock for products and pages is untouched.
 */
add_filter('get_post_metadata', static function ($value, int $objectId, string $metaKey, bool $single) {
    if ('_edit_lock' !== $metaKey || !$single) {
        return $value;
    }

    if (wp_get_environment_type() !== 'staging') {
        return $value;
    }

    if ('brizy-project' !== get_post_type($objectId)) {
        return $value;
    }

    // Returning an empty string makes wp_check_post_lock() bail out early
    // with false, which is exactly "this project is not locked".
    return '';
}, 10, 4);

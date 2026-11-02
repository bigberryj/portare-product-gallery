<?php
/**
 * Focused tests for PPG_Setup (product setup media).
 *
 * Run with: php tests/setup-tests.php
 *
 * These doubles are intentionally narrow and live in this file so the shared
 * qa/wp-stubs.php file stays untouched. Two reasons:
 * - its wp_verify_nonce() is bound to the gallery save action, while the setup
 *   media contract uses its own product-scoped actions
 *   (ppg_setup_save_{id} / ppg_setup_export_{id});
 * - setup media needs attachment MIME/URL, media handling, transient and
 *   upload doubles that the shared stub file does not provide.
 *
 * Covered: normalization, markup injection, invalid IDs and types, sequence
 * counts, disabled/missing media, save nonce and capability guards, and the
 * low level upload validation branches.
 */

define('ABSPATH', __DIR__ . '/');
define('PPG_PLUGIN_FILE', dirname(__DIR__) . '/portare-product-gallery.php');
define('PPG_VERSION', '0.2.0');

/* ------------------------------------------------------------- test state */

function setup_reset_state() {
    $GLOBALS['meta'] = array();
    $GLOBALS['types'] = array(10440 => 'product');
    $GLOBALS['statuses'] = array(10440 => 'publish');
    $GLOBALS['password'] = false;
    $GLOBALS['cap'] = true;
    $GLOBALS['revision'] = false;
    $GLOBALS['autosave'] = false;
    $GLOBALS['attachments'] = array();
    $GLOBALS['transients'] = array();
    $GLOBALS['enqueued'] = array();
    $GLOBALS['registered'] = array();
    $GLOBALS['hooks'] = array();
    $GLOBALS['media_uploads'] = array();
    $GLOBALS['deleted_attachments'] = array();
    $GLOBALS['json'] = array();
    $_POST = array();
    $_FILES = array();
    $_SERVER['CONTENT_LENGTH'] = 0;
}

/** Register a fake attachment: id, mime type, url and alt text. */
function setup_attachment($id, $mime, $alt = '') {
    $GLOBALS['attachments'][$id] = array(
        'mime' => $mime,
        'url' => 'https://example.test/uploads/' . $id . '.bin',
        'alt' => $alt,
    );
    // WordPress stores the alt text in attachment meta.
    $GLOBALS['meta'][$id]['_wp_attachment_image_alt'] = $alt;
}

/* ----------------------------------------------------------- WP doubles */

function get_post_meta($id, $key, $single = true) { return $GLOBALS['meta'][$id][$key] ?? ''; }
function update_post_meta($id, $key, $value) { $GLOBALS['meta'][$id][$key] = $value; }
function get_post_type($id) { return $GLOBALS['types'][$id] ?? 'attachment'; }
function get_post_status($id) { return $GLOBALS['statuses'][$id] ?? 'draft'; }
function post_password_required($id) { return (bool) $GLOBALS['password']; }
function get_post_mime_type($id) { return $GLOBALS['attachments'][$id]['mime'] ?? ''; }
function wp_unslash($v) { return is_array($v) ? array_map('wp_unslash', $v) : (is_string($v) ? stripslashes($v) : $v); }
function current_user_can($cap, $id = 0) { return (bool) $GLOBALS['cap']; }
function wp_is_post_revision($id) { return (bool) $GLOBALS['revision']; }
function wp_is_post_autosave($id) { return (bool) $GLOBALS['autosave']; }
function get_current_user_id() { return 7; }
function esc_attr($v) { return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8'); }
function esc_html($v) { return esc_attr($v); }
function esc_textarea($v) { return esc_attr($v); }
function esc_url($v) { return esc_attr($v); }
function esc_html_e($t, $d = null) { echo esc_html($t); }
function esc_html__($t, $d = null) { return esc_html($t); }
function __($t, $d = null) { return $t; }
function _e($t, $d = null) { echo $t; }
function checked($a, $b, $echo = true) { $s = $a == $b ? 'checked="checked"' : ''; if ($echo) { echo $s; } return $s; }
function selected($a, $b, $echo = true) { $s = $a == $b ? 'selected="selected"' : ''; if ($echo) { echo $s; } return $s; }
function wp_json_encode($value, $flags = 0) { return json_encode($value, $flags); }
function wp_nonce_field($action, $name) { echo '<input type="hidden" name="' . esc_attr($name) . '" value="nonce-' . esc_attr($action) . '">'; }
function wp_create_nonce($action) { return 'nonce-' . $action; }
function wp_verify_nonce($nonce, $action) {
    $allowed = array('ppg_setup_save_10440', 'ppg_setup_export_10440');
    return is_string($nonce) && $nonce === 'valid' && in_array($action, $allowed, true);
}
function wp_get_attachment_url($id) { return $GLOBALS['attachments'][$id]['url'] ?? ''; }
function wp_get_attachment_image_src($id, $size) {
    if (!isset($GLOBALS['attachments'][$id])) { return false; }
    return array($GLOBALS['attachments'][$id]['url'], 1600, 1000);
}
function wp_get_attachment_image($id, $size, $icon = false, $attrs = array()) {
    if (!isset($GLOBALS['attachments'][$id])) { return ''; }
    $alt = $attrs['alt'] ?? '';
    return '<img src="' . esc_url($GLOBALS['attachments'][$id]['url']) . '" alt="' . esc_attr($alt) . '">';
}
function wp_register_style($handle, $src = '', $deps = array(), $ver = false) { $GLOBALS['registered'][$handle] = 'style'; }
function wp_register_script($handle, $src = '', $deps = array(), $ver = false, $in_footer = false) { $GLOBALS['registered'][$handle] = 'script'; }
function wp_enqueue_style($handle) { $GLOBALS['enqueued'][] = 'style:' . $handle; }
function wp_enqueue_script($handle) { $GLOBALS['enqueued'][] = 'script:' . $handle; }
function wp_enqueue_media() { $GLOBALS['enqueued'][] = 'media'; }
function plugins_url($path, $file) { return 'https://example.test/plugins/ppg/' . $path; }
function admin_url($path = '') { return 'https://example.test/wp-admin/' . $path; }
function get_current_screen() { return null; }
function add_action($hook, $cb, $priority = 10, $accepted = 1) { $GLOBALS['hooks'][$hook][$priority][] = $cb; }
function add_filter($hook, $cb, $priority = 10, $accepted = 1) { add_action($hook, $cb, $priority, $accepted); }
function get_transient($key) { return $GLOBALS['transients'][$key] ?? false; }
function set_transient($key, $value, $expiration = 0) { $GLOBALS['transients'][$key] = $value; return true; }
function delete_transient($key) { unset($GLOBALS['transients'][$key]); return true; }
function wp_read_video_metadata($path) { return $GLOBALS['video_meta'][$path] ?? array(); }
function media_handle_upload($file_id, $post_id, $post_data = array(), $overrides = array()) {
    if (($overrides['mimes'] ?? null) !== array('mp4' => 'video/mp4')) { throw new RuntimeException('WordPress MIME map must be extension => MIME'); }
    $GLOBALS['media_uploads'][] = array('file_id' => $file_id, 'post_id' => $post_id, 'name' => $_FILES[$file_id]['name'] ?? '', 'post_data' => $post_data, 'overrides' => $overrides);
    $id = 900 + count($GLOBALS['media_uploads']);
    $mime = $GLOBALS['media_upload_mime'] ?? 'video/mp4';
    setup_attachment($id, $mime);
    return $id;
}
function wp_delete_attachment($id, $force = false) { $GLOBALS['deleted_attachments'][] = $id; unset($GLOBALS['attachments'][$id]); return true; }
function is_wp_error($thing) { return $thing instanceof WP_Error; }
class WP_Error {
    public $code;
    public $message;
    public function __construct($code = '', $message = '') { $this->code = $code; $this->message = $message; }
    public function get_error_message() { return $this->message; }
}
function wp_send_json_success($data = null, $status = 200) { $GLOBALS['json'] = array('success' => true, 'data' => $data, 'status' => $status); throw new Setup_Json_Exit(); }
function wp_send_json_error($data = null, $status = 400) { $GLOBALS['json'] = array('success' => false, 'data' => $data, 'status' => $status); throw new Setup_Json_Exit(); }
class Setup_Json_Exit extends Exception {}

/** Narrow stand-in for the gallery class used by the shared integration. */
class PPG {
    public static function public_product($id) {
        if (get_post_type($id) !== 'product' || get_post_status($id) !== 'publish' || post_password_required($id)) { return false; }
        return true;
    }
}

require __DIR__ . '/../includes/class-ppg-setup.php';

/* ------------------------------------------------------------- assertions */

$count = 0;
function test($condition, $label) {
    global $count;
    $count++;
    if (!$condition) { fwrite(STDERR, "FAIL: $label\n"); exit(1); }
}

/* ---------------------------------------------------------- normalization */

setup_reset_state();
$defaults = PPG_Setup::defaults();
test($defaults['enabled'] === 0, 'default disabled');
test($defaults['mode'] === 'pictures', 'default pictures mode');
test($defaults['replace_illustrations'] === 0, 'default no replacement');
test($defaults['motion'] === 0, 'default no motion');
test($defaults['images'] === array(), 'default no images');
test($defaults['video_id'] === 0 && $defaults['poster_id'] === 0, 'default no media ids');
test(PPG_Setup::sanitize(null) === $defaults, 'non array input normalizes to defaults');
test(PPG_Setup::sanitize('bad') === $defaults, 'string input normalizes to defaults');
test(PPG_Setup::config(10440) === $defaults, 'unset metadata returns defaults');

setup_attachment(11, 'image/jpeg');
setup_attachment(12, 'image/png');
setup_attachment(13, 'image/webp');
setup_attachment(21, 'video/mp4', 'Setup video');
$clean = PPG_Setup::sanitize(array(
    'enabled' => '1',
    'mode' => 'sequence',
    'images' => array('11', 12, '12', '13'),
    'heading' => '  Setup   guide ',
    'caption' => 'Line one',
    'motion' => '1',
    'video_id' => '21',
    'poster_id' => '13',
    'replace_illustrations' => '1',
    'unknown' => 'ignored',
));
test($clean['enabled'] === 1, 'enabled flag normalized');
test($clean['mode'] === 'sequence', 'mode kept');
test($clean['images'] === array(11, 12, 13), 'images deduplicated and ordered');
test($clean['heading'] === 'Setup guide', 'heading whitespace collapsed');
test($clean['caption'] === 'Line one', 'caption stored');
test($clean['motion'] === 1, 'motion flag normalized');
test($clean['video_id'] === 21, 'video attachment accepted');
test($clean['poster_id'] === 13, 'poster attachment accepted');
test($clean['replace_illustrations'] === 1, 'replacement flag normalized');
test(!array_key_exists('unknown', $clean), 'unknown keys discarded');

test(PPG_Setup::sanitize(array('mode' => 'evil'))['mode'] === 'pictures', 'mode allowlist');
test(PPG_Setup::sanitize(array('mode' => array('pictures')))['mode'] === 'pictures', 'structured mode rejected');
foreach (array('yes', 'true', 'on', 2, -1, array(1), null) as $bad) {
    test(PPG_Setup::sanitize(array('enabled' => $bad))['enabled'] === 0, 'strict enabled flag');
    test(PPG_Setup::sanitize(array('motion' => $bad))['motion'] === 0, 'strict motion flag');
    test(PPG_Setup::sanitize(array('replace_illustrations' => $bad))['replace_illustrations'] === 0, 'strict replacement flag');
}
test(PPG_Setup::sanitize(array('enabled' => true))['enabled'] === 1, 'boolean enabled accepted');

setup_attachment(31, 'image/svg+xml');
setup_attachment(32, 'application/pdf');
setup_attachment(33, 'image/gif');
setup_attachment(34, 'image/webp');
setup_attachment(35, 'video/webm');
test(PPG_Setup::sanitize(array('images' => array(31, 32)))['images'] === array(), 'svg and non image attachments rejected');
test(PPG_Setup::sanitize(array('images' => array(33, 34)))['images'] === array(33, 34), 'gif and webp accepted');
test(PPG_Setup::sanitize(array('video_id' => 35))['video_id'] === 35, 'webm video accepted');
test(PPG_Setup::sanitize(array('video_id' => 31))['video_id'] === 0, 'image is not a video');
test(PPG_Setup::sanitize(array('video_id' => 99))['video_id'] === 0, 'unknown video rejected');
test(PPG_Setup::sanitize(array('poster_id' => 35))['poster_id'] === 0, 'video is not a poster');

foreach (array(null, '', '0', '-1', '01', '1.0', '1e2', ' 1', '1 ', '99999999999999999999', array(11), new stdClass(), true) as $bad) {
    test(PPG_Setup::sanitize(array('video_id' => $bad))['video_id'] === 0, 'malformed video id rejected');
    test(PPG_Setup::sanitize(array('poster_id' => $bad))['poster_id'] === 0, 'malformed poster id rejected');
}
test(PPG_Setup::sanitize(array('images' => array(0, -3, 'x', array(11), 11)))['images'] === array(11), 'malformed image ids dropped');
foreach (array(11, 12, 13, 14, 15) as $id) { setup_attachment($id, 'image/jpeg'); }
test(PPG_Setup::sanitize(array('images' => array(11, 12, 13, 14, 15)))['images'] === array(11, 12, 13, 14), 'images capped at four');
test(PPG_Setup::sanitize(array('images' => array(11, 31, 12, 13, 14)))['images'] === array(11, 12, 13, 14), 'cap counts valid attachments only');

$long = PPG_Setup::sanitize(array('heading' => str_repeat('a', 200), 'caption' => str_repeat('b', 900)));
test(strlen($long['heading']) === 120, 'heading length capped');
test(strlen($long['caption']) === 500, 'caption length capped');
test(PPG_Setup::sanitize(array('heading' => array('x')))['heading'] === '', 'structured heading rejected');
test(PPG_Setup::sanitize(array('caption' => 42))['caption'] === '', 'numeric caption rejected');

/* -------------------------------------------------------------- injection */

setup_reset_state();
setup_attachment(11, 'image/jpeg', 'Fold the leg');
setup_attachment(12, 'image/png', '');
$GLOBALS['meta'][10440]['_ppg_setup'] = array(
    'enabled' => 1,
    'mode' => 'pictures',
    'images' => array(11, 12),
    'heading' => '<script>alert(1)</script>Setup',
    'caption' => '"><img src=x onerror=alert(1)>',
);
$html = PPG_Setup::render(10440);
test(strpos($html, '<script>alert(1)</script>') === false, 'heading markup stripped');
test(strpos($html, 'onerror=alert(1)') === false, 'caption markup stripped');
test(strpos($html, '<img src=x') === false, 'no injected image markup');
test(strpos($html, 'Setup') !== false, 'safe heading text kept');
preg_match('/<script class="ppg-setup-data" type="application\/json">(.*?)<\/script>/s', $html, $match);
test(!empty($match), 'setup json script present');
$data = json_decode($match[1], true);
test(is_array($data), 'setup json parses');
test($data['mode'] === 'pictures', 'json mode');
test($data['duration'] === 15000, 'json fixed duration');
test($data['productId'] === 10440, 'json product id');
test($data['motion'] === 0, 'json motion flag');
test(count($data['images']) === 2, 'json image count');
test($data['images'][0]['id'] === 11, 'json image id');
test(strpos($data['images'][0]['src'], 'https://example.test/uploads/') === 0, 'json image src is the local WP url');
test($data['images'][0]['alt'] === 'Fold the leg', 'json image alt');

$GLOBALS['meta'][10440]['_ppg_setup']['heading'] = 'x';
setup_attachment(13, 'image/jpeg', '</script><script>alert(2)</script>');
$GLOBALS['meta'][10440]['_ppg_setup']['images'] = array(13);
$html = PPG_Setup::render(10440);
preg_match('/<script class="ppg-setup-data" type="application\/json">(.*?)<\/script>/s', $html, $match);
test(strpos($match[1], '</script>') === false, 'json hex escapes script context');
test(strpos($html, '<img class="ppg-setup-picture"') !== false, 'picture image markup present');
test(strpos($html, 'onerror') === false, 'no event handler in markup');

/* ------------------------------------------------------------ media modes */

setup_reset_state();
setup_attachment(11, 'image/jpeg');
setup_attachment(12, 'image/png');
setup_attachment(13, 'image/webp');
setup_attachment(21, 'video/mp4');
setup_attachment(22, 'image/jpeg');
$GLOBALS['meta'][10440]['_ppg_setup'] = array('enabled' => 1, 'mode' => 'pictures', 'images' => array(11, 12));
$html = PPG_Setup::render(10440);
test(strpos($html, 'class="ppg-setup"') !== false, 'setup section rendered');
test(strpos($html, 'data-ppg-setup') !== false, 'setup marker attribute');
test(strpos($html, 'data-mode="pictures"') !== false, 'mode attribute');
test(strpos($html, 'data-product-id="10440"') !== false, 'product id attribute');
test(strpos($html, 'data-motion="0"') !== false, 'motion attribute');
test(strpos($html, 'data-replace-illustrations') === false, 'no replacement without opt in');
test(strpos($html, 'ppg-setup-pictures') !== false, 'pictures container');
test(substr_count($html, 'class="ppg-setup-picture"') === 2, 'both pictures rendered');

$GLOBALS['meta'][10440]['_ppg_setup'] = array('enabled' => 1, 'mode' => 'sequence', 'images' => array(11, 12, 13));
$html = PPG_Setup::render(10440);
test(strpos($html, 'ppg-setup-stage') !== false, 'sequence stage rendered');
test(substr_count($html, 'ppg-setup-frame') === 3, 'sequence frames rendered');
test(strpos($html, 'ppg-setup-play') !== false, 'sequence play control rendered');
test(strpos($html, 'data-mode="sequence"') !== false, 'sequence mode attribute');

$GLOBALS['meta'][10440]['_ppg_setup'] = array('enabled' => 1, 'mode' => 'sequence', 'images' => array(11));
$html = PPG_Setup::render(10440);
test(strpos($html, 'ppg-setup-stage') === false, 'single image is not a sequence');
test(strpos($html, 'at least two') !== false, 'sequence count error visible');

$GLOBALS['meta'][10440]['_ppg_setup'] = array('enabled' => 1, 'mode' => 'video', 'video_id' => 21, 'poster_id' => 22);
$html = PPG_Setup::render(10440);
test(strpos($html, '<video class="ppg-setup-video"') !== false, 'video element rendered');
test(strpos($html, 'controls') !== false, 'video controls');
test(strpos($html, 'playsinline') !== false, 'video playsinline');
test(strpos($html, 'preload="metadata"') !== false, 'video preload metadata');
test(strpos($html, 'poster="https://example.test/uploads/22.bin"') !== false, 'video poster applied');
test(strpos($html, 'data-mode="video"') !== false, 'video mode attribute');

/* ------------------------------------------------ disabled and missing media */

setup_reset_state();
setup_attachment(11, 'image/jpeg');
$GLOBALS['meta'][10440]['_ppg_setup'] = array('enabled' => 0, 'mode' => 'pictures', 'images' => array(11));
test(PPG_Setup::render(10440) === '', 'disabled setup renders nothing');

$GLOBALS['meta'][10440]['_ppg_setup'] = array('enabled' => 1, 'mode' => 'pictures', 'images' => array(999));
$html = PPG_Setup::render(10440);
test(strpos($html, 'ppg-setup-error') !== false, 'missing image error visible');
test(strpos($html, 'role="alert"') !== false, 'missing image error is announced');
test(strpos($html, 'no longer available') !== false, 'missing image error text');
test(strpos($html, 'data-replace-illustrations') === false, 'missing media never enables replacement');

$GLOBALS['meta'][10440]['_ppg_setup'] = array('enabled' => 1, 'mode' => 'video', 'video_id' => 888, 'replace_illustrations' => 1);
$html = PPG_Setup::render(10440);
test(strpos($html, 'ppg-setup-error') !== false, 'missing video error visible');
test(strpos($html, '<video') === false, 'missing video not rendered');
test(strpos($html, 'data-replace-illustrations') === false, 'missing video never enables replacement');

$GLOBALS['meta'][10440]['_ppg_setup'] = array('enabled' => 1, 'mode' => 'pictures', 'images' => array(11), 'replace_illustrations' => 1);
$html = PPG_Setup::render(10440);
test(strpos($html, 'data-replace-illustrations="1"') !== false, 'explicit opt in with valid media enables replacement');

$GLOBALS['statuses'][10440] = 'draft';
test(PPG_Setup::render(10440) === '', 'unpublished product renders nothing');
$GLOBALS['statuses'][10440] = 'publish';
$GLOBALS['password'] = true;
test(PPG_Setup::render(10440) === '', 'password protected product renders nothing');
$GLOBALS['password'] = false;

/* ------------------------------------------------------------------ saving */

setup_reset_state();
$valid = array(
    'ppg_setup_present' => '1',
    'ppg_setup_nonce' => 'valid',
    'ppg_setup' => array('enabled' => '1', 'mode' => 'pictures', 'images' => array('11', '12'), 'heading' => 'Guide'),
);
setup_attachment(11, 'image/jpeg');
setup_attachment(12, 'image/png');

$_POST = $valid;
$GLOBALS['cap'] = false;
PPG_Setup::save(10440);
test(empty($GLOBALS['meta'][10440] ?? []), 'save denied without capability');
$GLOBALS['cap'] = true;
$_POST['ppg_setup_nonce'] = 'wrong';
PPG_Setup::save(10440);
test(empty($GLOBALS['meta'][10440] ?? []), 'save denied with wrong nonce');
$_POST['ppg_setup_nonce'] = array('valid');
PPG_Setup::save(10440);
test(empty($GLOBALS['meta'][10440] ?? []), 'save denied with structured nonce');
$_POST = $valid;
$GLOBALS['revision'] = true;
PPG_Setup::save(10440);
test(empty($GLOBALS['meta'][10440] ?? []), 'save denied for revisions');
$GLOBALS['revision'] = false;
$GLOBALS['autosave'] = true;
PPG_Setup::save(10440);
test(empty($GLOBALS['meta'][10440] ?? []), 'save denied for autosaves');
$GLOBALS['autosave'] = false;
$GLOBALS['types'][10440] = 'page';
PPG_Setup::save(10440);
test(empty($GLOBALS['meta'][10440] ?? []), 'save denied for non products');
$GLOBALS['types'][10440] = 'product';
$GLOBALS['meta'][10440]['_ppg_setup'] = array('enabled' => 1, 'mode' => 'pictures', 'images' => array(11), 'heading' => 'Kept', 'caption' => '', 'motion' => 0, 'video_id' => 0, 'poster_id' => 0, 'replace_illustrations' => 0);
$_POST = array('ppg_setup_nonce' => 'valid');
PPG_Setup::save(10440);
test($GLOBALS['meta'][10440]['_ppg_setup']['heading'] === 'Kept', 'save without the setup marker leaves the stored setup untouched');
$_POST['ppg_setup_present'] = '1';
$_POST['ppg_setup'] = array('enabled' => '0');
PPG_Setup::save(10440);
test($GLOBALS['meta'][10440]['_ppg_setup']['heading'] === '', 'a submitted setup panel overwrites the stored setup');

$_POST = $valid;
unset($GLOBALS['meta'][10440]);
PPG_Setup::save(10440);
test(isset($GLOBALS['meta'][10440]['_ppg_setup']), 'valid save stores setup metadata');
test($GLOBALS['meta'][10440]['_ppg_setup']['enabled'] === 1, 'saved enabled flag');
test($GLOBALS['meta'][10440]['_ppg_setup']['images'] === array(11, 12), 'saved image ids');
test($GLOBALS['meta'][10440]['_ppg_setup']['heading'] === 'Guide', 'saved heading');
test(count($GLOBALS['meta'][10440]) === 1, 'only the setup key is written');

$_POST = $valid;
$_POST['ppg_setup'] = 'bad';
PPG_Setup::save(10440);
test($GLOBALS['meta'][10440]['_ppg_setup'] === PPG_Setup::defaults(), 'malformed setup payload normalizes safely');

/* ------------------------------------------------------------- hook wiring */

setup_reset_state();
PPG_Setup::init();
test(isset($GLOBALS['hooks']['wp_ajax_ppg_setup_upload']), 'upload ajax action registered');
test(isset($GLOBALS['hooks']['woocommerce_process_product_meta'][20]), 'save registered at priority 20');
test($GLOBALS['hooks']['woocommerce_process_product_meta'][20][0] === array('PPG_Setup', 'save'), 'save callback wired');
test(isset($GLOBALS['hooks']['admin_enqueue_scripts']), 'admin assets hook registered');

/* ------------------------------------------------------------- admin panel */

setup_reset_state();
setup_attachment(11, 'image/jpeg', 'Fold the leg');
setup_attachment(21, 'video/mp4');
$GLOBALS['meta'][10440]['_ppg_setup'] = array('enabled' => 1, 'mode' => 'pictures', 'images' => array(11), 'video_id' => 21);
ob_start();
PPG_Setup::panel(10440);
$panel = ob_get_clean();
test(strpos($panel, 'class="ppg-setup-admin"') !== false, 'admin wrapper rendered');
test((bool)preg_match('/id="ppg_setup_enabled"[^>]*checked="checked"/', $panel), 'saved enabled flag emitted on reload');
test((bool)preg_match('/option value="pictures"[^>]*selected="selected"/', $panel), 'saved mode emitted on reload');
test(strpos($panel, 'data-product-id="10440"') !== false, 'admin product id attribute');
test(strpos($panel, 'data-upload-url="https://example.test/wp-admin/admin-ajax.php"') !== false, 'admin ajax upload url');
test(strpos($panel, 'data-upload-nonce="nonce-ppg_setup_export_10440"') !== false, 'admin upload nonce');
test(strpos($panel, 'name="ppg_setup_present"') !== false, 'admin setup marker');
test(strpos($panel, 'name="ppg_setup_nonce"') !== false, 'admin own nonce field');
test(strpos($panel, 'name="ppg_setup[enabled]"') !== false, 'admin enabled field');
test(strpos($panel, 'name="ppg_setup[mode]"') !== false, 'admin mode field');
test(strpos($panel, 'name="ppg_setup[heading]"') !== false, 'admin heading field');
test(strpos($panel, 'name="ppg_setup[caption]"') !== false, 'admin caption field');
test(strpos($panel, 'name="ppg_setup[motion]"') !== false, 'admin motion field');
test(strpos($panel, 'name="ppg_setup[video_id]"') !== false, 'admin video id field');
test(strpos($panel, 'name="ppg_setup[poster_id]"') !== false, 'admin poster id field');
test(strpos($panel, 'name="ppg_setup[replace_illustrations]"') !== false, 'admin replacement field');
foreach (array('ppg_setup_enabled', 'ppg_setup_mode', 'ppg_setup_heading', 'ppg_setup_caption', 'ppg_setup_motion', 'ppg_setup_video_id', 'ppg_setup_poster_id', 'ppg_setup_replace_illustrations') as $id) {
    test(strpos($panel, 'id="' . $id . '"') !== false, 'admin field id ' . $id);
}
test(strpos($panel, 'class="ppg-setup-list"') !== false, 'admin image list');
test(strpos($panel, 'class="ppg-setup-image"') !== false, 'admin image row');
test(strpos($panel, 'data-id="11"') !== false, 'admin image row id');
test(strpos($panel, 'data-src="https://example.test/uploads/11.bin"') !== false, 'admin image row src');
test(strpos($panel, 'data-alt="Fold the leg"') !== false, 'admin image row alt');
test(strpos($panel, 'name="ppg_setup[images][]"') !== false, 'admin hidden image id field');
test(strpos($panel, 'ppg-setup-image-up') !== false, 'admin move up control');
test(strpos($panel, 'ppg-setup-image-down') !== false, 'admin move down control');
test(strpos($panel, 'ppg-setup-image-remove') !== false, 'admin remove control');
test(strpos($panel, 'ppg-setup-add-images') !== false, 'admin add images control');
test(strpos($panel, 'ppg-setup-pick-video') !== false, 'admin pick video control');
test(strpos($panel, 'ppg-setup-clear-video') !== false, 'admin clear video control');
test(strpos($panel, 'ppg-setup-pick-poster') !== false, 'admin pick poster control');
test(strpos($panel, 'ppg-setup-clear-poster') !== false, 'admin clear poster control');
test(strpos($panel, 'ppg-setup-video-label') !== false, 'admin video selection label');
test(strpos($panel, 'ppg-setup-poster-label') !== false, 'admin poster selection label');
test(strpos($panel, 'data-url="https://example.test/uploads/21.bin"') !== false, 'admin hidden id carries data url');
test(strpos($panel, 'ppg-setup-preview-button') !== false, 'admin preview button');
test(strpos($panel, 'class="ppg-setup-preview"') !== false, 'admin preview output');
test(strpos($panel, 'ppg-setup-export') !== false, 'admin export control');
test(strpos($panel, 'ppg-setup-export-cancel') !== false, 'admin export cancel control');
test(strpos($panel, 'ppg-setup-use-video') !== false, 'admin use exported video control');
test(strpos($panel, 'class="button ppg-setup-download" href="#" hidden') !== false, 'admin download anchor hidden by default');
test(strpos($panel, 'ppg-setup-use-video" hidden') !== false, 'admin use video button hidden until a recording exists');
test(strpos($panel, 'ppg-setup-export-cancel" disabled') !== false, 'admin export cancel disabled until recording');
test(strpos($panel, 'class="ppg-setup-admin-status" role="status"') !== false, 'admin status region');
test(strpos($panel, 'class="ppg-setup-admin-error" role="alert"') !== false, 'admin error region');
test(substr_count($panel, 'type="submit"') === 0, 'admin panel has no submit button');
test(strpos($panel, '15 second') !== false, 'admin explains the 15 second presentation');
test(strpos($panel, 'not a simulation') !== false, 'admin states it is not folding synthesis');
test(strpos($panel, 'MP4 recording support') !== false, 'admin states MP4 browser requirement');
test(strpos($panel, 'foreground') !== false, 'admin states foreground tab requirement');
test(strpos($panel, 'until you press Update') !== false, 'admin states update requirement');
test(strpos($panel, 'preserved by default') !== false, 'admin states illustrations are retained by default');

/* ---------------------------------------------------------- upload branches */

$dir = sys_get_temp_dir() . '/ppg-setup-test-' . getmypid();
@mkdir($dir, 0700, true);
function setup_fixture($name, $bytes) { global $dir; $path = $dir . '/' . $name; file_put_contents($path, $bytes); return $path; }

$mp4 = setup_fixture('good.mp4', "\x00\x00\x00\x18ftypisom" . str_repeat("\x00", 64));
$plain = setup_fixture('plain.mp4', 'not a video at all');
$quicktime = setup_fixture('qt.mp4', "\x00\x00\x00\x14ftypqt  " . str_repeat("\x00", 64));
$GLOBALS['video_meta'][$mp4] = array('length' => 15.0, 'width' => 1280, 'height' => 720);
$GLOBALS['video_meta'][$plain] = array('length' => 15.0, 'width' => 1280, 'height' => 720);
$GLOBALS['video_meta'][$quicktime] = array('length' => 15.0, 'width' => 1280, 'height' => 720);

$file = array('name' => 'client.mp4', 'type' => 'video/mp4', 'tmp_name' => $mp4, 'error' => UPLOAD_ERR_OK, 'size' => filesize($mp4));
$ok = PPG_Setup::validate_upload($file);
test($ok['ok'] === true, 'valid mp4 accepted');
test($ok['status'] === 200, 'valid upload status');
test($ok['duration'] === 15.0 && $ok['width'] === 1280 && $ok['height'] === 720, 'valid upload metadata read');

$bad = PPG_Setup::validate_upload(array('name' => 'x', 'tmp_name' => $plain, 'error' => UPLOAD_ERR_OK));
test($bad['ok'] === false && $bad['status'] === 415, 'non mp4 rejected with 415');
test($bad['code'] === 'unsupported_type', 'non mp4 error code');
$bad = PPG_Setup::validate_upload(array('name' => 'x', 'tmp_name' => $quicktime, 'error' => UPLOAD_ERR_OK));
test($bad['ok'] === false && $bad['status'] === 415, 'non mp4 mime rejected with 415');
$bad = PPG_Setup::validate_upload(array('name' => 'x', 'tmp_name' => $mp4, 'error' => UPLOAD_ERR_INI_SIZE));
test($bad['ok'] === false && $bad['status'] === 400, 'php upload error rejected with 400');
$bad = PPG_Setup::validate_upload(null);
test($bad['ok'] === false && $bad['status'] === 400, 'missing file rejected with 400');
$bad = PPG_Setup::validate_upload(array('name' => 'x', 'tmp_name' => $dir . '/missing.mp4', 'error' => UPLOAD_ERR_OK));
test($bad['ok'] === false && $bad['status'] === 400, 'missing temp file rejected with 400');

$short = setup_fixture('short.mp4', "\x00\x00\x00\x18ftypisom" . str_repeat("\x00", 64));
$GLOBALS['video_meta'][$short] = array('length' => 5.0, 'width' => 1280, 'height' => 720);
$bad = PPG_Setup::validate_upload(array('name' => 'x', 'tmp_name' => $short, 'error' => UPLOAD_ERR_OK));
test($bad['ok'] === false && $bad['status'] === 415, 'short video rejected with 415');
test($bad['code'] === 'invalid_duration', 'short video error code');
$long = setup_fixture('long.mp4', "\x00\x00\x00\x18ftypisom" . str_repeat("\x00", 64));
$GLOBALS['video_meta'][$long] = array('length' => 40.0, 'width' => 1280, 'height' => 720);
$bad = PPG_Setup::validate_upload(array('name' => 'x', 'tmp_name' => $long, 'error' => UPLOAD_ERR_OK));
test($bad['ok'] === false && $bad['status'] === 415, 'long video rejected with 415');
$wide = setup_fixture('wide.mp4', "\x00\x00\x00\x18ftypisom" . str_repeat("\x00", 64));
$GLOBALS['video_meta'][$wide] = array('length' => 15.0, 'width' => 1920, 'height' => 1080);
$bad = PPG_Setup::validate_upload(array('name' => 'x', 'tmp_name' => $wide, 'error' => UPLOAD_ERR_OK));
test($bad['ok'] === false && $bad['status'] === 415, 'oversized frame rejected with 415');
test($bad['code'] === 'invalid_dimensions', 'oversized frame error code');
$zero = setup_fixture('zero.mp4', "\x00\x00\x00\x18ftypisom" . str_repeat("\x00", 64));
$GLOBALS['video_meta'][$zero] = array('length' => 15.0, 'width' => 0, 'height' => 0);
$bad = PPG_Setup::validate_upload(array('name' => 'x', 'tmp_name' => $zero, 'error' => UPLOAD_ERR_OK));
test($bad['ok'] === false && $bad['status'] === 415, 'zero frame size rejected with 415');
$unreadable = setup_fixture('unreadable.mp4', "\x00\x00\x00\x18ftypisom" . str_repeat("\x00", 64));
$bad = PPG_Setup::validate_upload(array('name' => 'x', 'tmp_name' => $unreadable, 'error' => UPLOAD_ERR_OK));
test($bad['ok'] === false && $bad['status'] === 415, 'unreadable metadata rejected with 415');

$big = setup_fixture('big.mp4', "\x00\x00\x00\x18ftypisom");
$handle = fopen($big, 'r+b');
fseek($handle, 26 * 1024 * 1024 - 1, SEEK_SET);
fwrite($handle, "\x00");
fclose($handle);
$GLOBALS['video_meta'][$big] = array('length' => 15.0, 'width' => 1280, 'height' => 720);
$bad = PPG_Setup::validate_upload(array('name' => 'x', 'tmp_name' => $big, 'error' => UPLOAD_ERR_OK));
test($bad['ok'] === false && $bad['status'] === 413, 'oversized file rejected with 413');
test($bad['code'] === 'file_too_large', 'oversized file error code');

/* ------------------------------------------------------- upload transport */

setup_reset_state();
$GLOBALS['meta'][10440]['_ppg_setup'] = array('enabled' => 1, 'mode' => 'pictures', 'images' => array(11));
setup_attachment(11, 'image/jpeg');
$_POST = array('product_id' => '10440', 'nonce' => 'valid');
$_FILES['setup_video'] = array('name' => 'client.mp4', 'type' => 'video/mp4', 'tmp_name' => $mp4, 'error' => UPLOAD_ERR_OK, 'size' => filesize($mp4));

$GLOBALS['cap'] = false;
$result = PPG_Setup::handle_upload();
test($result['status'] === 403, 'upload denied without capability');
$GLOBALS['cap'] = true;
$_POST['nonce'] = 'wrong';
$result = PPG_Setup::handle_upload();
test($result['status'] === 403, 'upload denied with wrong nonce');
$_POST['nonce'] = 'valid';
$_POST['product_id'] = '999';
$result = PPG_Setup::handle_upload();
test($result['status'] === 400, 'upload denied for an unknown product');
$_POST['product_id'] = '10440';

$_SERVER['CONTENT_LENGTH'] = 30 * 1024 * 1024;
$result = PPG_Setup::handle_upload();
test($result['status'] === 413, 'declared oversize rejected early');
$_SERVER['CONTENT_LENGTH'] = 0;

$GLOBALS['transients']['ppg_setup_upload_7_10440'] = time() + 60;
$result = PPG_Setup::handle_upload();
test($result['status'] === 429, 'repeat upload rate limited');
unset($GLOBALS['transients']['ppg_setup_upload_7_10440']);

$result = PPG_Setup::handle_upload();
test($result['status'] === 200, 'valid upload accepted');
test(isset($result['body']['id']) && $result['body']['id'] > 0, 'upload returns the attachment id');
test(strpos($result['body']['url'], 'https://example.test/uploads/') === 0, 'upload returns the attachment url');
test(count($GLOBALS['media_uploads']) === 1, 'media handling called once');
test($GLOBALS['media_uploads'][0]['post_id'] === 10440, 'upload stored against the product');
test(preg_match('/^ppg-setup-[0-9a-f]{16}\.mp4$/', $GLOBALS['media_uploads'][0]['name']) === 1, 'upload uses a safe random file name');
test($GLOBALS['media_uploads'][0]['name'] !== 'client.mp4', 'client file name is not trusted');
test($GLOBALS['media_uploads'][0]['overrides']['test_form'] === false, 'media handling skips the form check');
test(isset($GLOBALS['transients']['ppg_setup_upload_7_10440']), 'upload lock stored');
test($GLOBALS['meta'][10440]['_ppg_setup']['images'] === array(11), 'upload does not change the product configuration');

$GLOBALS['media_upload_mime'] = 'application/octet-stream';
unset($GLOBALS['transients']['ppg_setup_upload_7_10440']);
$result = PPG_Setup::handle_upload();
test($result['status'] === 415, 'invalid stored attachment rejected');
test(count($GLOBALS['deleted_attachments']) === 1, 'invalid attachment rolled back');
$GLOBALS['media_upload_mime'] = 'video/mp4';

// A rejected file must not leave the user locked out of the upload path.
unset($GLOBALS['transients']['ppg_setup_upload_7_10440']);
$_FILES['setup_video']['tmp_name'] = $short;
$result = PPG_Setup::handle_upload();
test($result['status'] === 415, 'invalid duration rejected through the transport');
test(isset($GLOBALS['transients']['ppg_setup_upload_7_10440']), 'content rejection keeps the upload throttled');
$_FILES['setup_video']['tmp_name'] = $mp4;
unset($GLOBALS['transients']['ppg_setup_upload_7_10440']);
$_FILES['setup_video'] = array('name' => 'client.mp4', 'type' => 'video/mp4', 'tmp_name' => $dir . '/gone.mp4', 'error' => UPLOAD_ERR_OK, 'size' => 10);
$result = PPG_Setup::handle_upload();
test($result['status'] === 400, 'missing upload rejected through the transport');
test(!isset($GLOBALS['transients']['ppg_setup_upload_7_10440']), 'failed request releases the upload lock');
$_FILES['setup_video'] = array('name' => 'client.mp4', 'type' => 'video/mp4', 'tmp_name' => $mp4, 'error' => UPLOAD_ERR_OK, 'size' => filesize($mp4));

try {
    PPG_Setup::ajax_upload();
    test(false, 'ajax transport returns json');
} catch (Setup_Json_Exit $exit) {
    test($GLOBALS['json']['success'] === true, 'ajax transport reports success');
    test(isset($GLOBALS['json']['data']['id'], $GLOBALS['json']['data']['url']), 'ajax transport returns id and url');
    test($GLOBALS['json']['status'] === 200, 'ajax transport success status');
}

foreach (glob($dir . '/*') as $path) { @unlink($path); }
@rmdir($dir);

// Normalize raw getID3 fallback keys to the WordPress metadata contract.
class getid3 { public function analyze($path) { return $GLOBALS['setup_raw_video_meta'] ?? array(); } }
setup_reset_state(); $GLOBALS['setup_video_meta'] = array();
$GLOBALS['setup_raw_video_meta'] = array('playtime_seconds'=>15.125,'video'=>array('resolution_x'=>1280,'resolution_y'=>720));
$metadata_parser = new ReflectionMethod('PPG_Setup','video_metadata');
if (PHP_VERSION_ID < 80100) { $metadata_parser->setAccessible(true); }
$normalized = $metadata_parser->invoke(null,'not-read-by-stub.mp4');
test($normalized['length']===15.125,'getID3 duration normalized');
test($normalized['width']===1280 && $normalized['height']===720,'getID3 dimensions normalized');
unset($GLOBALS['setup_raw_video_meta']);

// Native fragmented MP4 movie-header duration fallback; malformed boxes fail closed.
function setup_mp4_box($type, $payload) { return pack('N', strlen($payload)+8).$type.$payload; }
$parser = new ReflectionMethod('PPG_Setup', 'mp4_duration');
if (PHP_VERSION_ID < 80100) { $parser->setAccessible(true); }
$cases = array(
 array(setup_mp4_box('moov',setup_mp4_box('mvhd',pack('N5',0,0,0,1000,15000))),15.0),
 array(setup_mp4_box('moov',setup_mp4_box('mvhd',pack('N8',0x01000000,0,0,0,0,1000,0,15000))),15.0),
 array(setup_mp4_box('moov',setup_mp4_box('mvhd',pack('N5',0,0,0,0,15000))),0),
 array(setup_mp4_box('mdat','no movie header'),0),
 array(pack('N',4294967295).'moov',0),
 array(pack('N',1).'moov'.pack('NN',1,8),0),
 array(setup_mp4_box('moov',setup_mp4_box('mvhd',pack('N',0x02000000))),0),
 array(setup_mp4_box('moov',setup_mp4_box('mvhd',pack('N3',0,0,0))),0)
);
foreach($cases as $case){$tmp=tempnam(getenv('TMPDIR')?:sys_get_temp_dir(),'ppg-mp4-');try{file_put_contents($tmp,$case[0]);test((float)$parser->invoke(null,$tmp)===(float)$case[1],'bounded MP4 duration parser');}finally{unlink($tmp);}}

echo "PASS: $count assertions\n";

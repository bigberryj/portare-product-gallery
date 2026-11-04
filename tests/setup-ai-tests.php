<?php
/**
 * Focused tests for the Wan-backed AI motion generation adapter.
 *
 * These tests run without WordPress. The provider transport is stubbed through
 * the `ppg_wan_transport` seam, so no paid render is ever started and no
 * network call is made. The assertions cover the trust boundary: consent,
 * capability, nonce, frame validation, strict scalar input, job persistence,
 * locks, provider error mapping, download protections and result validation.
 */
define('ABSPATH', __DIR__ . '/');
define('PPG_VERSION', '0.4.0');
define('PPG_WAN_TEST_TRANSPORT', true);

$GLOBALS['ppg_test_state'] = array(
    'options' => array(),
    'filters' => array(),
    'mime' => array(),
    'urls' => array(),
    'types' => array(),
    'caps' => array(),
    'attached' => array(),
    'nonce_ok' => true,
    'user_id' => 1,
    'runner' => array(),
    'runner_queue' => array(),
    'video_meta' => array('length' => 5, 'width' => 1280, 'height' => 720),
    'sideloaded' => array(),
    'http_queue' => array(),
    'http' => array(),
    'deleted' => array(),
    'media_root' => '',
);

function ppg_test_reset() {
    $GLOBALS['ppg_test_state']['options'] = array();
    $GLOBALS['ppg_test_state']['filters'] = array();
    $GLOBALS['ppg_test_state']['mime'] = array();
    $GLOBALS['ppg_test_state']['urls'] = array();
    $GLOBALS['ppg_test_state']['types'] = array();
    $GLOBALS['ppg_test_state']['caps'] = array();
    $GLOBALS['ppg_test_state']['attached'] = array();
    $GLOBALS['ppg_test_state']['nonce_ok'] = true;
    $GLOBALS['ppg_test_state']['user_id'] = 1;
    $GLOBALS['ppg_test_state']['runner'] = array();
    $GLOBALS['ppg_test_state']['runner_queue'] = array();
    $GLOBALS['ppg_test_state']['video_meta'] = array('length' => 5, 'width' => 1280, 'height' => 720);
    $GLOBALS['ppg_test_state']['sideloaded'] = array();
    $GLOBALS['ppg_test_state']['http_queue'] = array();
    $GLOBALS['ppg_test_state']['http'] = array();
    $GLOBALS['ppg_test_state']['deleted'] = array();
    $_POST = array();

    // The transport seam replaces the local runner call.
    add_filter('ppg_wan_transport', 'ppg_test_transport');
    // Point the runtime paths at files that exist, so the filesystem checks
    // pass without a real provider installation.
    add_filter('ppg_wan_config', 'ppg_test_config');
}
ppg_test_reset();

/* ------------------------------------------------------------- wp stubs */

function get_option($key, $default = false) {
    if (isset($GLOBALS['ppg_test_state']['stale_options']) && array_key_exists($key, $GLOBALS['ppg_test_state']['stale_options'])) { return $GLOBALS['ppg_test_state']['stale_options'][$key]; }
    return $GLOBALS['ppg_test_state']['options'][$key] ?? $default;
}
function wp_cache_delete($key, $group = '') {
    unset($GLOBALS['ppg_test_state']['stale_options'][$key]);
    return true;
}
function add_option($key, $value, $deprecated = '', $autoload = 'yes') {
    if (array_key_exists($key, $GLOBALS['ppg_test_state']['options'])) { return false; }
    $GLOBALS['ppg_test_state']['options'][$key] = $value;
    return true;
}
function update_option($key, $value, $autoload = null) {
    // WordPress returns false when the stored value is unchanged, so the
    // stub behaves the same way.
    $changed = !array_key_exists($key, $GLOBALS['ppg_test_state']['options'])
        || $GLOBALS['ppg_test_state']['options'][$key] !== $value;
    $GLOBALS['ppg_test_state']['options'][$key] = $value;
    return $changed;
}
function delete_option($key) {
    if (!array_key_exists($key, $GLOBALS['ppg_test_state']['options'])) { return false; }
    unset($GLOBALS['ppg_test_state']['options'][$key]);
    return true;
}
function get_current_user_id() { return (int) $GLOBALS['ppg_test_state']['user_id']; }
function current_user_can($cap, $id = null) {
    $caps = $GLOBALS['ppg_test_state']['caps'];
    if (array_key_exists($cap, $caps)) { return (bool) $caps[$cap]; }
    return true;
}
function wp_verify_nonce($nonce, $action) { return $GLOBALS['ppg_test_state']['nonce_ok'] ? 'nonce' : false; }
function wp_create_nonce($action) { return 'test-nonce'; }
function get_post_type($id) { return $GLOBALS['ppg_test_state']['types'][$id] ?? 'attachment'; }
function get_post($id) { return (object) array('ID' => (int) $id, 'post_title' => 'Test Product'); }
function get_post_mime_type($id) { return $GLOBALS['ppg_test_state']['mime'][$id] ?? null; }
function wp_get_attachment_url($id) { return $GLOBALS['ppg_test_state']['urls'][$id] ?? ''; }
function get_attached_file($id) { return $GLOBALS['ppg_test_state']['attached'][$id] ?? ''; }
function wp_strip_all_tags($text, $remove_breaks = false) { return trim(strip_tags((string) $text)); }
function wp_unslash($value) { return is_string($value) ? stripslashes($value) : $value; }
function wp_json_encode($data) { return json_encode($data); }
function admin_url($path = '') { return 'https://example.test/wp-admin/' . $path; }
function sanitize_file_name($name) { return preg_replace('/[^A-Za-z0-9._-]/', '-', (string) $name); }
function wp_generate_password($length = 12, $special = true, $extra = false) { return substr(str_repeat('a1b2c3d4e5f6', 3), 0, $length); }
function is_wp_error($thing) { return $thing instanceof WP_Error; }
class WP_Error { public function __construct(public $code = '', public $message = '') {} public function get_error_message() { return $this->message; } }
function add_filter($tag, $cb, $priority = 10, $args = 1) { $GLOBALS['ppg_test_state']['filters'][$tag][] = $cb; return true; }
function remove_filter($tag, $cb, $priority = 10) { return true; }
function add_action($tag, $callback, $priority = 10, $args = 1) { return true; }
function apply_filters($tag, $value, ...$args) {
    foreach ($GLOBALS['ppg_test_state']['filters'][$tag] ?? array() as $cb) {
        $value = $cb($value, ...$args);
    }
    return $value;
}
function wp_tempnam($prefix) { $path = sys_get_temp_dir() . '/' . $prefix . bin2hex(random_bytes(6)); touch($path); return $path; }
function wp_read_video_metadata($path) { return $GLOBALS['ppg_test_state']['video_meta']; }
function wp_remote_retrieve_response_code($response) { return is_array($response) ? ($response['code'] ?? 0) : 0; }
function wp_remote_retrieve_body($response) { return is_array($response) ? ($response['body'] ?? '') : ''; }
function wp_remote_retrieve_header($response, $header) { return is_array($response) ? ($response['headers'][$header] ?? '') : ''; }
function wp_parse_url($url, $component = -1) { return parse_url($url, $component); }
function wp_delete_attachment($id, $force = false) { $GLOBALS['ppg_test_state']['deleted'][] = $id; return true; }
function wp_send_json_success($data) { echo json_encode(array('success' => true, 'data' => $data)); }
function wp_send_json_error($data, $status = 200) { echo json_encode(array('success' => false, 'data' => $data)); }
function wp_upload_dir($time = null, $create_dir = true) {
    return array('basedir' => $GLOBALS['ppg_test_state']['media_root'], 'baseurl' => 'https://example.test/uploads');
}

/** Stubbed download transport: queue responses, record every request. */
function wp_safe_remote_get($url, $args) {
    $GLOBALS['ppg_test_state']['http'][] = array('url' => $url, 'args' => $args);
    $queue = $GLOBALS['ppg_test_state']['http_queue'];
    if (!$queue) { return array('code' => 500, 'body' => ''); }
    $next = array_shift($GLOBALS['ppg_test_state']['http_queue']);
    if (isset($args['filename']) && !empty($next['body'])) {
        file_put_contents($args['filename'], $next['body']);
    }
    return array('code' => $next['code'] ?? 200, 'body' => '', 'headers' => $next['headers'] ?? array());
}

function media_handle_sideload($file, $post_id, $post_data = array(), $post_data_override = array()) {
    $GLOBALS['ppg_test_state']['sideloaded'][] = array('file' => $file, 'post_id' => $post_id, 'data' => $post_data);
    $id = 9001 + count($GLOBALS['ppg_test_state']['sideloaded']);
    $GLOBALS['ppg_test_state']['mime'][$id] = 'video/mp4';
    return $id;
}

require_once __DIR__ . '/../includes/class-ppg-wan.php';
require_once __DIR__ . '/../includes/class-ppg-setup-ai.php';

/* --------------------------------------------------------------- helpers */

$count = 0;
function test($condition, $label) {
    global $count;
    $count++;
    if (!$condition) {
        echo "FAIL: $label\n";
        exit(1);
    }
}

/** Minimal valid MP4 header for container checks. */
function ppg_test_mp4_bytes() {
    $box = pack('N', 24) . 'ftyp' . 'isom' . pack('N', 0) . 'isom';
    return $box . pack('N', 20) . 'mdat' . 'data';
}

/**
 * The transport seam.
 *
 * It records every request and replays the queued responses, so the tests
 * never start a process and never reach the provider.
 */
function ppg_test_transport($seam, $op, $payload) {
    $GLOBALS['ppg_test_state']['runner'][] = array('op' => $op, 'payload' => $payload);
    if ($op === 'status' && isset($GLOBALS['ppg_test_state']['during_status'])) {
        $callback = $GLOBALS['ppg_test_state']['during_status'];
        unset($GLOBALS['ppg_test_state']['during_status']);
        $callback();
    }
    $queue = $GLOBALS['ppg_test_state']['runner_queue'];
    if (!$queue) {
        return array('ok' => false, 'code' => 'no_response', 'message' => 'The AI provider did not answer.', 'data' => array());
    }
    $next = array_shift($GLOBALS['ppg_test_state']['runner_queue']);
    return array_merge(
        array('ok' => true, 'code' => 'ok', 'message' => '', 'data' => array()),
        $next
    );
}

/** Point the runtime paths at files that exist, so the filesystem checks
 *  pass without a real provider installation.
 *
 *  The node path is the PHP binary itself: it is a real executable file, so
 *  the production executable check is exercised honestly, while the
 *  transport seam keeps every provider call mocked. */
function ppg_test_config($config) {
    $config['node'] = defined('PHP_BINARY') && PHP_BINARY !== '' ? PHP_BINARY : '/usr/bin/php';
    $config['cli'] = __FILE__;
    $config['runner'] = __FILE__;
    return $config;
}

/** Simulate a server with no Wan credential. */
function ppg_test_no_key($config) {
    $config['key'] = '';
    return $config;
}

/** Simulate a server with no Wan runtime installed. */
function ppg_test_no_runtime($config) {
    $config['runner'] = '/nonexistent/wan-runner.cjs';
    return $config;
}

/** Queue the responses the transport seam will replay. */
function ppg_stub_runner($responses) {
    $GLOBALS['ppg_test_state']['runner_queue'] = $responses;
}

/** Create the media root and two real frame files inside it. */
function ppg_seed_media() {
    $root = sys_get_temp_dir() . '/ppg-uploads-' . bin2hex(random_bytes(4));
    mkdir($root, 0700, true);
    $GLOBALS['ppg_test_state']['media_root'] = $root;
    $first = $root . '/first.png';
    $last = $root . '/last.jpg';
    ppg_test_write_png($first);
    ppg_test_write_jpeg($last);
    $GLOBALS['ppg_test_state']['attached'][11] = $first;
    $GLOBALS['ppg_test_state']['attached'][12] = $last;
    return array($first, $last);
}

/** Write a real one pixel PNG, so the frame content checks can run. */
function ppg_test_write_png($path) {
    $image = imagecreatetruecolor(4, 4);
    imagefill($image, 0, 0, imagecolorallocate($image, 10, 20, 30));
    imagepng($image, $path);
    imagedestroy($image);
}

/** Write a real one pixel JPEG, so the frame content checks can run. */
function ppg_test_write_jpeg($path) {
    $image = imagecreatetruecolor(4, 4);
    imagefill($image, 0, 0, imagecolorallocate($image, 40, 50, 60));
    imagejpeg($image, $path, 90);
    imagedestroy($image);
}

/** Seed two readable raster frames. */
function ppg_seed_frames() {
    ppg_seed_media();
    $GLOBALS['ppg_test_state']['types'][11] = 'attachment';
    $GLOBALS['ppg_test_state']['types'][12] = 'attachment';
    $GLOBALS['ppg_test_state']['mime'][11] = 'image/png';
    $GLOBALS['ppg_test_state']['mime'][12] = 'image/jpeg';
    $GLOBALS['ppg_test_state']['urls'][11] = 'https://example.test/11.png';
    $GLOBALS['ppg_test_state']['urls'][12] = 'https://example.test/12.jpg';
}

/** Seed the product used by the request tests. */
function ppg_seed_post() {
    $GLOBALS['ppg_test_state']['types'][55] = 'product';
}

define('PPG_WAN_ACCESS_KEY', 'test-server-only-key');

/* ------------------------------------------------------------ prompt rules */

ppg_test_reset();
test(PPG_Wan::sanitize_prompt('  Show the table unfolding  ') === 'Show the table unfolding', 'prompt trims whitespace');
test(PPG_Wan::sanitize_prompt('<script>alert(1)</script>unfold') === 'alert(1)unfold', 'prompt strips markup');
test(strlen(PPG_Wan::sanitize_prompt(str_repeat('a', 900))) === 500, 'prompt length is bounded');
test(PPG_Wan::sanitize_prompt('') === '', 'empty prompt stays empty');
test(strlen(PPG_Wan::default_prompt()) > 20, 'default prompt exists');
test(PPG_Wan::default_prompt() === PPG_Wan::sanitize_prompt(PPG_Wan::default_prompt()), 'default prompt is prompt-safe');

/* ----------------------------------------------------------- config rules */

ppg_test_reset();
$config = PPG_Wan::config();
test($config['enabled'] === true, 'provider is enabled when the server key exists');
test($config['key'] === 'test-server-only-key', 'server key is read from the constant');
$public = PPG_Wan::public_config();
test($public['enabled'] === true, 'public config reports enabled when the key and runtime are present');
test($public['provider'] === 'Wan', 'public config names the provider');
test($public['reason'] === '', 'an enabled provider has no reason string');
test($public['minImages'] === 2 && $public['maxImages'] === 2, 'the provider needs exactly two frames');
test($public['duration'] === 5, 'the default clip duration is exposed');
test(!array_key_exists('key', $public), 'public config never exposes the credential');
$public_json = json_encode($public);
test(strpos($public_json, 'test-server-only-key') === false, 'the credential never appears in the public config');
test(!preg_match('/secret|password|token/i', $public_json), 'the public config carries no secret-shaped fields');

/* A missing credential and a missing runtime are reported distinctly. */
ppg_test_reset();
add_filter('ppg_wan_config', 'ppg_test_no_key');
$public = PPG_Wan::public_config();
test($public['enabled'] === false, 'a missing credential disables the provider');
test($public['reason'] === 'missing_credential', 'a missing credential is reported as such');
test($public['runtimeReady'] === true, 'the runtime is still reported as ready when only the credential is missing');
ppg_test_reset();
add_filter('ppg_wan_config', 'ppg_test_no_runtime');
$public = PPG_Wan::public_config();
test($public['enabled'] === false, 'a missing runtime disables the provider');
test($public['reason'] === 'runtime_missing', 'a missing runtime is reported as such');
test($public['runtimeReady'] === false, 'the runtime is reported as missing');

/* --------------------------------------------------------- consent guard */

ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '0', 'first_frame_id' => '11', 'last_frame_id' => '12');
$result = PPG_Setup_AI::handle_generate();
test($result['status'] === 403 && $result['code'] === 'consent_required', 'generation without consent is refused');
test(!$GLOBALS['ppg_test_state']['runner'], 'no provider call happens without consent');

ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
$GLOBALS['ppg_test_state']['caps']['edit_post'] = false;
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$result = PPG_Setup_AI::handle_generate();
test($result['status'] === 403 && $result['code'] === 'forbidden', 'generation without capability is refused');

ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
$GLOBALS['ppg_test_state']['nonce_ok'] = false;
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$result = PPG_Setup_AI::handle_generate();
test($result['status'] === 403 && $result['code'] === 'invalid_nonce', 'generation without a valid nonce is refused');

ppg_test_reset();
ppg_seed_frames();
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$result = PPG_Setup_AI::handle_generate();
test($result['status'] === 400 && $result['code'] === 'invalid_product', 'a job for an unknown product is refused');
test(!$GLOBALS['ppg_test_state']['runner'], 'no provider call happens for an unknown product');

/* ---------------------------------------------------------- frame rules */

ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
$frames = PPG_Wan::validate_frames('11', '11');
test($frames['ok'] === false && $frames['code'] === 'invalid_frames', 'the same frame cannot be both first and last');

ppg_test_reset();
ppg_seed_post();
$GLOBALS['ppg_test_state']['types'][11] = 'attachment';
$GLOBALS['ppg_test_state']['mime'][11] = 'image/gif';
$frames = PPG_Wan::validate_frames('11', '12');
test($frames['ok'] === false, 'a non raster frame is refused');

ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
$GLOBALS['ppg_test_state']['types'][11] = 'post';
$frames = PPG_Wan::validate_frames('11', '12');
test($frames['ok'] === false, 'a frame that is not a media library item is refused');

ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
$GLOBALS['ppg_test_state']['caps']['read_post'] = false;
$frames = PPG_Wan::validate_frames('11', '12');
test($frames['ok'] === false && $frames['code'] === 'forbidden', 'a frame the operator cannot read is refused');

ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
$frames = PPG_Wan::validate_frames('11', '12');
test($frames['ok'] === true && $frames['first'] === 11 && $frames['last'] === 12, 'two distinct raster frames are accepted');

/* A frame outside the uploads folder is never handed to the provider. */
ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
$GLOBALS['ppg_test_state']['attached'][11] = '/etc/passwd';
test(PPG_Wan::frame_path(11) === '', 'a frame outside the uploads folder is refused');

/* ------------------------------------------------------ strict scalars */

$duration_error = 0;
test(PPG_Wan::sanitize_duration(null, $duration_error) === 5 && $duration_error === 0, 'the duration defaults to 5');
test(PPG_Wan::sanitize_duration('10', $duration_error) === 10 && $duration_error === 0, 'the duration accepts 10');
test(PPG_Wan::sanitize_duration(15, $duration_error) === 15 && $duration_error === 0, 'the duration accepts 15');
test(PPG_Wan::sanitize_duration(7, $duration_error) === 5 && $duration_error === 1, 'a duration outside the allowlist is refused');
test(PPG_Wan::sanitize_duration('abc', $duration_error) === 5 && $duration_error === 1, 'a non numeric duration is refused');
test(PPG_Wan::sanitize_duration(array(5), $duration_error) === 5 && $duration_error === 1, 'an array duration is refused');

$resolution_error = 0;
test(PPG_Wan::sanitize_resolution(null, $resolution_error) === '720P' && $resolution_error === 0, 'the resolution defaults to 720P');
test(PPG_Wan::sanitize_resolution('480P', $resolution_error) === '480P' && $resolution_error === 0, 'the resolution accepts 480P');
test(PPG_Wan::sanitize_resolution('1080P', $resolution_error) === '720P' && $resolution_error === 1, 'a resolution outside the allowlist is refused');
test(PPG_Wan::sanitize_resolution(array('720P'), $resolution_error) === '720P' && $resolution_error === 1, 'an array resolution is refused');

/* ------------------------------------------------------- job persistence */

ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
ppg_seed_media();
ppg_stub_runner(array(array('ok' => true, 'data' => array('task_id' => 'task-123'))));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12', 'duration' => '10', 'resolution' => '480P');
$result = PPG_Setup_AI::handle_generate();
test($result['status'] === 200, 'a valid request starts a render');
test($result['body']['status'] === 'processing', 'the started render reports processing');
$jobId = $result['body']['job_id'];
test(array_key_exists('attachment_id', $result['body']), 'the success body carries an attachment id');
test(array_key_exists('url', $result['body']), 'the success body carries a url');
test(array_key_exists('message', $result['body']), 'the success body carries a message');
test(!array_key_exists('task_id', $result['body']), 'the success body never carries the provider task reference');
test(!array_key_exists('prompt', $result['body']), 'the success body never carries the prompt');
test(!array_key_exists('first_frame_id', $result['body']), 'the success body never carries the frame ids');
test($result['body']['settings']['duration'] === 10, 'the success body reports the requested duration');
test($result['body']['settings']['resolution'] === '480P', 'the success body reports the requested resolution');
test(PPG_Wan::load_job($jobId) !== null, 'the job row is written before the provider call');
$job = PPG_Wan::load_job($jobId);
test($job['status'] === 'processing', 'the job records the provider task');
test($job['task_id'] === 'task-123', 'the provider task reference is stored');
test($job['prompt'] !== '', 'the sanitised prompt is stored with the job');
test($job['duration'] === 10 && $job['resolution'] === '480P', 'the requested settings are stored with the job');
test(count($GLOBALS['ppg_test_state']['runner']) === 1, 'exactly one provider call is made');
test($GLOBALS['ppg_test_state']['runner'][0]['op'] === 'create', 'the create operation is used');
test($GLOBALS['ppg_test_state']['runner'][0]['payload']['duration'] === 10, 'the duration reaches the provider');
test($GLOBALS['ppg_test_state']['runner'][0]['payload']['resolution'] === '480P', 'the resolution reaches the provider');
test(strpos(json_encode($GLOBALS['ppg_test_state']['runner'][0]['payload']), 'test-server-only-key') === false, 'the credential never reaches the provider payload');

/* A second request while one is running must not start another paid render. */
ppg_stub_runner(array());
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$result = PPG_Setup_AI::handle_generate();
test($result['status'] === 409 && $result['code'] === 'already_running', 'a second render is refused while one is running');
test(count($GLOBALS['ppg_test_state']['runner']) === 1, 'no extra provider call is made for the refused render');

/* --------------------------------------------------- locks are released */

ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
ppg_seed_media();
ppg_stub_runner(array(array('ok' => false, 'code' => 'provider_rejected', 'message' => 'nope')));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
PPG_Setup_AI::handle_generate();
$locks = array_filter(array_keys($GLOBALS['ppg_test_state']['options']), function ($key) { return strpos($key, '_ppg_ai_lock_submit_') === 0; });
test(!$locks, 'the submission lock is released after the request finishes');

/* ----------------------------------------------------------- lock safety */

/* A lock carries an owner token, and only the owner may release it. */
$token = PPG_Wan::acquire_lock(PPG_Wan::SUBMIT_LOCK_PREFIX, 55);
test(is_string($token) && $token !== '', 'acquiring a lock returns an owner token');
test(PPG_Wan::acquire_lock(PPG_Wan::SUBMIT_LOCK_PREFIX, 55) === false, 'a held lock cannot be taken twice');
test(PPG_Wan::release_lock(PPG_Wan::SUBMIT_LOCK_PREFIX, 55, 'not-the-owner') === false, 'a wrong owner token cannot release a lock');
$lockKeys = array_values(array_filter(array_keys($GLOBALS['ppg_test_state']['options']), function ($key) { return strpos($key, '_ppg_ai_lock_submit_') === 0; }));
test(count($lockKeys) === 1, 'the lock is stored under one scoped key');
test(PPG_Wan::release_lock(PPG_Wan::SUBMIT_LOCK_PREFIX, 55, $token) === true, 'the owner releases its own lock');
test(PPG_Wan::acquire_lock(PPG_Wan::SUBMIT_LOCK_PREFIX, 55) !== false, 'the lock can be taken again after it is released');

/* The previous holder of an expired lock cannot release the lock of the
 * newer holder. The stale takeover itself needs a database handle, so the
 * ownership check is what is proven here. */
$old = PPG_Wan::acquire_lock(PPG_Wan::IMPORT_LOCK_PREFIX, 'job_x');
test(is_string($old), 'the import lock is acquired');
$importKeys = array_values(array_filter(array_keys($GLOBALS['ppg_test_state']['options']), function ($key) { return strpos($key, '_ppg_ai_lock_import_') === 0; }));
test(count($importKeys) === 1, 'the import lock is stored under one scoped key');
$GLOBALS['ppg_test_state']['options'][$importKeys[0]] = array('at' => time() - 10, 'owner' => 'someone-else');
test(PPG_Wan::release_lock(PPG_Wan::IMPORT_LOCK_PREFIX, 'job_x', $old) === false, 'the previous holder cannot release a lock it no longer owns');
test(PPG_Wan::release_lock(PPG_Wan::IMPORT_LOCK_PREFIX, 'job_x', 'someone-else') === true, 'the current owner releases its own lock');

/* --------------------------------------------- one render per product */

/* A second operator cannot start a second paid render for the same
 * product while one is in flight. */
ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
ppg_seed_media();
ppg_stub_runner(array(array('ok' => true, 'data' => array('task_id' => 'task-shared'))));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$first = PPG_Setup_AI::handle_generate();
test($first['status'] === 200, 'the first render starts');
$GLOBALS['ppg_test_state']['user_id'] = 2;
ppg_stub_runner(array(array('ok' => true, 'data' => array('task_id' => 'task-second'))));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$second = PPG_Setup_AI::handle_generate();
test($second['status'] === 409 && $second['code'] === 'already_running', 'another user cannot start a second render for the same product');
test(count($GLOBALS['ppg_test_state']['runner']) === 1, 'the refused render never reaches the provider');
$GLOBALS['ppg_test_state']['user_id'] = 1;

/* ------------------------------------------- the job index is durable */

/* The job index points at the job, so a lost render can be recovered. */
ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
ppg_seed_media();
ppg_stub_runner(array(array('ok' => true, 'data' => array('task_id' => 'task-index'))));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$started = PPG_Setup_AI::handle_generate();
$jobId = $started['body']['job_id'];
$index = PPG_Wan::job_index(55);
test(in_array($jobId, $index, true), 'the job index points at the new job');
test($index[0] === $jobId, 'the newest job is first in the index');

/* An active job is never dropped from the index by pruning. */
$activeJob = PPG_Wan::load_job($jobId);
$activeJob['status'] = 'processing';
PPG_Wan::save_job($activeJob);
for ($i = 0; $i < 30; $i++) {
    $finished = $activeJob;
    $finished['id'] = PPG_Wan::job_id();
    $finished['status'] = 'succeeded';
    $finished['updated'] = time();
    PPG_Wan::save_job($finished);
    PPG_Wan::remember_job(55, $finished['id']);
}
PPG_Wan::prune_jobs(55);
$after = PPG_Wan::job_index(55);
test(in_array($jobId, $after, true), 'pruning never drops an in-flight job from the index');
test(count($after) <= PPG_Wan::MAX_JOBS + 1, 'the index stays bounded');

/* The recovery path finds the in-flight job, not an older finished one. */
ppg_stub_runner(array(array('ok' => true, 'data' => array('status' => 'processing'))));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'job_id' => '');
$recovered = PPG_Setup_AI::handle_status();
test($recovered['status'] === 200, 'the recovery path answers');
test($recovered['body']['job_id'] === $jobId, 'the recovery path resumes the in-flight job');

/* ------------------------------------------------- the provider failure */
ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
ppg_seed_media();
ppg_stub_runner(array(array('ok' => false, 'code' => 'provider_rejected', 'message' => 'The Wan account has no usable credit.')));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$result = PPG_Setup_AI::handle_generate();
test($result['status'] === 502 && $result['code'] === 'provider_error', 'a provider failure is reported');
$jobs = array_values(array_filter($GLOBALS['ppg_test_state']['options'], function ($key) { return strpos($key, '_ppg_ai_job_') === 0; }, ARRAY_FILTER_USE_KEY));
test(count($jobs) === 1, 'the failed job row is kept');
$failed = array_shift($jobs);
test($failed['status'] === 'failed', 'a provider failure is recorded on the job');
test(strpos($failed['error'], 'no usable credit') !== false, 'the provider reason is kept on the job');

/* An unknown provider error is never treated as a refusal. The render may
 * already be running, so the job stays unknown and is never resubmitted. */
ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
ppg_seed_media();
ppg_stub_runner(array(array('ok' => false, 'code' => 'provider_error', 'message' => 'upstream returned a gateway error')));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$result = PPG_Setup_AI::handle_generate();
test($result['status'] === 502 && $result['code'] === 'provider_ambiguous', 'an unknown provider error is reported as ambiguous');
$jobs = array_values(array_filter($GLOBALS['ppg_test_state']['options'], function ($key) { return strpos($key, '_ppg_ai_job_') === 0; }, ARRAY_FILTER_USE_KEY));
$uncertain = array_shift($jobs);
test($uncertain['status'] === 'unknown', 'an unknown provider error keeps the job unknown');
test(PPG_Wan::is_active($uncertain), 'an unknown provider error job is still active, so it is not resubmitted');

/* An ambiguous transport failure is never resubmitted automatically. */
ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
ppg_seed_media();
ppg_stub_runner(array(array('ok' => false, 'code' => 'runner_timeout', 'message' => 'The provider did not answer in time.')));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$result = PPG_Setup_AI::handle_generate();
test($result['status'] === 502 && $result['code'] === 'provider_ambiguous', 'an ambiguous provider answer is reported as ambiguous');
$jobs = array_values(array_filter($GLOBALS['ppg_test_state']['options'], function ($key) { return strpos($key, '_ppg_ai_job_') === 0; }, ARRAY_FILTER_USE_KEY));
$ambiguous = array_shift($jobs);
test($ambiguous['status'] === 'unknown', 'an ambiguous submission is kept as unknown');
test(PPG_Wan::is_active($ambiguous), 'an unknown job is still active, so it is not resubmitted');

/* Every post-submission uncertainty keeps the job unknown. */
foreach (array('provider_unreadable', 'runner_output_too_large', 'runner_failed', 'no_response', 'unreadable_response', 'some_new_code') as $code) {
    ppg_test_reset();
    ppg_seed_post();
    ppg_seed_frames();
    ppg_seed_media();
    ppg_stub_runner(array(array('ok' => false, 'code' => $code, 'message' => 'uncertain outcome')));
    $_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
    $result = PPG_Setup_AI::handle_generate();
    test($result['code'] === 'provider_ambiguous', 'the failure code ' . $code . ' is treated as ambiguous');
    $rows = array_values(array_filter($GLOBALS['ppg_test_state']['options'], function ($key) { return strpos($key, '_ppg_ai_job_') === 0; }, ARRAY_FILTER_USE_KEY));
    test(array_shift($rows)['status'] === 'unknown', 'the failure code ' . $code . ' keeps the job unknown');
}

/* ---------------------------------------------------------- status polling */

ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
ppg_seed_media();
ppg_stub_runner(array(array('ok' => true, 'data' => array('task_id' => 'task-abc'))));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$started = PPG_Setup_AI::handle_generate();
$jobId = $started['body']['job_id'];

ppg_stub_runner(array(array('ok' => true, 'data' => array('status' => 'processing'))));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'job_id' => $jobId);
$result = PPG_Setup_AI::handle_status();
test($result['status'] === 200 && $result['body']['status'] === 'processing', 'a rendering job reports processing');
$calls = $GLOBALS['ppg_test_state']['runner'];
$last = end($calls);
test($last['op'] === 'status', 'the status operation is used');
test($last['payload']['task_id'] === 'task-abc', 'the stored task reference is polled');

ppg_stub_runner(array(array('ok' => true, 'data' => array('status' => 'failed', 'error' => 'content policy'))));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'job_id' => $jobId);
$result = PPG_Setup_AI::handle_status();
test($result['status'] === 200 && $result['body']['status'] === 'failed', 'a failed render reports the failed state');
test(strpos($result['body']['message'], 'content policy') !== false, 'the provider failure reason is surfaced');
test(array_key_exists('attachment_id', $result['body']), 'a failed status body still carries an attachment id');

ppg_test_reset();
ppg_seed_post();
$_POST = array('product_id' => '55', 'nonce' => 'n', 'job_id' => 'job_0000000000000000');
$result = PPG_Setup_AI::handle_status();
test($result['status'] === 404, 'an unknown job is refused');
$_POST = array('product_id' => '55', 'nonce' => 'n', 'job_id' => 'not-a-job-id');
$result = PPG_Setup_AI::handle_status();
test($result['status'] === 400 && $result['code'] === 'invalid_job_id', 'a malformed job id is refused');
test($result['body']['code'] === 'invalid_job_id', 'the malformed job id refusal carries its code');

/* A job belonging to another user is not visible. */
ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
ppg_seed_media();
ppg_stub_runner(array(array('ok' => true, 'data' => array('task_id' => 'task-abc'))));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$started = PPG_Setup_AI::handle_generate();
$jobId = $started['body']['job_id'];
$GLOBALS['ppg_test_state']['user_id'] = 2;
$_POST = array('product_id' => '55', 'nonce' => 'n', 'job_id' => $jobId);
$result = PPG_Setup_AI::handle_status();
test($result['status'] === 404, 'another user cannot read the job');

/* Recovery: a blank job id resumes the newest job of this user. */
$GLOBALS['ppg_test_state']['user_id'] = 1;
$_POST = array('product_id' => '55', 'nonce' => 'n', 'job_id' => '');
ppg_stub_runner(array(array('ok' => true, 'data' => array('status' => 'processing'))));
$result = PPG_Setup_AI::handle_status();
test($result['status'] === 200 && $result['body']['job_id'] === $jobId, 'a blank job id resumes the newest job of this user');

/* A blank job id for a user with no job reports the idle state. */
ppg_test_reset();
ppg_seed_post();
$_POST = array('product_id' => '55', 'nonce' => 'n', 'job_id' => '');
$result = PPG_Setup_AI::handle_status();
test($result['status'] === 200 && $result['body']['status'] === 'idle', 'a blank job id with no stored job reports idle');

/* --------------------------------------------------- duplicate imports */

ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
ppg_seed_media();
ppg_stub_runner(array(array('ok' => true, 'data' => array('task_id' => 'task-dup'))));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$started = PPG_Setup_AI::handle_generate();
$jobId = $started['body']['job_id'];
ppg_stub_runner(array(array('ok' => true, 'data' => array('status' => 'succeeded', 'download_url' => 'https://x.oss-cn-x.aliyuncs.com/out/clip.mp4'))));
$GLOBALS['ppg_test_state']['http_queue'] = array(array('code' => 200, 'body' => ppg_test_mp4_bytes()));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'job_id' => $jobId);
$result = PPG_Setup_AI::handle_status();
test($result['status'] === 200 && $result['body']['status'] === 'succeeded', 'a finished render reports success');
test(count($GLOBALS['ppg_test_state']['sideloaded']) === 1, 'the finished clip is imported once');
test($result['body']['attachment_id'] > 0, 'the finished clip reports its attachment');
test(!array_key_exists('task_id', $result['body']), 'the finished body never carries the provider task reference');
test(!array_key_exists('download_url', $result['body']), 'the finished body never carries the provider download url');

/* A second poll of a finished job must not import the clip again. */
ppg_stub_runner(array());
$_POST = array('product_id' => '55', 'nonce' => 'n', 'job_id' => $jobId);
$result = PPG_Setup_AI::handle_status();
test(count($GLOBALS['ppg_test_state']['sideloaded']) === 1, 'a repeated poll does not import the clip twice');
test($result['body']['status'] === 'succeeded', 'a repeated poll still reports the finished clip');

/* Two requests that both saw the finished provider state import the clip
 * only once: the second request reads the stored job again inside the lock
 * and finds the stored attachment. */
ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
ppg_seed_media();
ppg_stub_runner(array(array('ok' => true, 'data' => array('task_id' => 'task-race'))));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
$race = PPG_Setup_AI::handle_generate();
$raceJob = $race['body']['job_id'];
ppg_stub_runner(array(array('ok' => true, 'data' => array('status' => 'succeeded', 'download_url' => 'https://x.oss-cn-x.aliyuncs.com/out/clip.mp4'))));
$GLOBALS['ppg_test_state']['http_queue'] = array(array('code' => 200, 'body' => ppg_test_mp4_bytes()));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'job_id' => $raceJob);
$import = PPG_Setup_AI::handle_status();
test($import['body']['status'] === 'succeeded', 'the first import succeeds');
test(count($GLOBALS['ppg_test_state']['sideloaded']) === 1, 'the clip is imported once');
/* The stored job is already finished, so a second request that read the
 * provider state before the first import finished imports nothing. */
$stored = PPG_Wan::load_job($raceJob);
test($stored['status'] === 'succeeded', 'the finished state is stored on the job');
ppg_stub_runner(array(array('ok' => true, 'data' => array('status' => 'succeeded', 'download_url' => 'https://x.oss-cn-x.aliyuncs.com/out/clip.mp4'))));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'job_id' => $raceJob);
$again = PPG_Setup_AI::handle_status();
test(count($GLOBALS['ppg_test_state']['sideloaded']) === 1, 'a second import of the same job does not happen');
test($again['body']['status'] === 'succeeded', 'the second request still reports the finished clip');

/* The download request is bounded and marked for the staging allowlist. */
$last = end($GLOBALS['ppg_test_state']['http']);
test($last['args']['redirection'] === 0, 'the download does not follow redirects automatically');
test($last['args']['reject_unsafe_urls'] === true, 'the download refuses unsafe urls');
test($last['args']['limit_response_size'] === PPG_Wan::MAX_BYTES + 1, 'the download body is bounded');
test($last['args']['ppg_wan_download'] === true, 'the download carries the staging allowlist marker');
test($last['args']['sslverify'] === true, 'the download verifies the certificate');

/* ------------------------------------------------- download protections */

test(PPG_Wan::is_allowed_download_url('https://x.oss-cn-x.aliyuncs.com/out/clip.mp4') === true, 'an allowed Wan delivery host is accepted');
test(PPG_Wan::is_allowed_download_url('http://x.oss-cn-x.aliyuncs.com/out/clip.mp4') === false, 'a plain http download is refused');
test(PPG_Wan::is_allowed_download_url('https://evil.example.com/clip.mp4') === false, 'a foreign host is refused');
test(PPG_Wan::is_allowed_download_url('https://aliyuncs.com.evil.example/clip.mp4') === false, 'a host that only ends with the suffix text is refused');
test(PPG_Wan::is_allowed_download_url('https://x.wan.video/clip.mp4') === true, 'the wan video suffix is accepted');
test(PPG_Wan::is_allowed_download_url('https://x.wanxai.com/clip.mp4') === true, 'the wanxai suffix is accepted');
test(PPG_Wan::is_allowed_download_url('') === false, 'an empty download url is refused');
test(PPG_Wan::is_allowed_download_url('https://x.wan.video:8443/clip.mp4') === false, 'a non standard port is refused');
test(PPG_Wan::is_allowed_download_url('https://x.wan.video:443/clip.mp4') === true, 'the standard https port is accepted');

/* ------------------------------------------------------------ strict ids */

test(PPG_Wan::positive_id('11') === 11, 'a digit string is accepted');
test(PPG_Wan::positive_id(11) === 11, 'an integer is accepted');
test(PPG_Wan::positive_id('11abc') === 0, 'trailing junk is refused');
test(PPG_Wan::positive_id('11.5') === 0, 'a decimal string is refused');
test(PPG_Wan::positive_id(11.5) === 0, 'a float is refused');
test(PPG_Wan::positive_id(true) === 0, 'a boolean is refused');
test(PPG_Wan::positive_id(false) === 0, 'a false boolean is refused');
test(PPG_Wan::positive_id(array(11)) === 0, 'an array is refused');
test(PPG_Wan::positive_id('-1') === 0, 'a negative number is refused');
test(PPG_Wan::positive_id('0') === 0, 'zero is refused');
test(PPG_Wan::positive_id('9223372036854775808') === 0, 'a value that overflows an integer is refused');
test(PPG_Wan::positive_id('9223372036854775807') === PHP_INT_MAX, 'the largest integer is accepted');

/* ------------------------------------------------- result validation */

ppg_test_reset();
$tmp = sys_get_temp_dir() . '/ppg-test-' . bin2hex(random_bytes(4)) . '.mp4';
file_put_contents($tmp, ppg_test_mp4_bytes());
$checked = PPG_Wan::validate_video_file($tmp);
test($checked['ok'] === true, 'a valid MP4 container is accepted');
unlink($tmp);

$tmp = sys_get_temp_dir() . '/ppg-test-' . bin2hex(random_bytes(4)) . '.bin';
file_put_contents($tmp, 'not a video at all');
$checked = PPG_Wan::validate_video_file($tmp);
test($checked['ok'] === false, 'a non-MP4 file is rejected');
unlink($tmp);

/* A file that is not really a video is refused, even with a valid MP4
 * header, because the file type reader is the proof. */
$tmp = sys_get_temp_dir() . '/ppg-test-' . bin2hex(random_bytes(4)) . '.mp4';
file_put_contents($tmp, pack('N', 24) . 'ftyp' . str_repeat('Z', 64));
$checked = PPG_Wan::validate_video_file($tmp);
test($checked['ok'] === false, 'a file that is not really a video is rejected');
unlink($tmp);

/* The frame content is checked, not only the attachment MIME field. */
ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
$notAnImage = $GLOBALS['ppg_test_state']['media_root'] . '/first.png';
file_put_contents($notAnImage, 'this is not an image');
$frames = PPG_Wan::validate_frames('11', '12');
test($frames['ok'] === false && $frames['code'] === 'invalid_frames', 'a frame whose bytes are not an image is refused');

/* A frame whose real type differs from its recorded type is refused. */
ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
$jpegAsPng = $GLOBALS['ppg_test_state']['media_root'] . '/first.png';
copy($GLOBALS['ppg_test_state']['attached'][12], $jpegAsPng);
$frames = PPG_Wan::validate_frames('11', '12');
test($frames['ok'] === false && $frames['code'] === 'invalid_frames', 'a frame that does not match its recorded type is refused');

$GLOBALS['ppg_test_state']['video_meta'] = array('length' => 60, 'width' => 1280, 'height' => 720);
$tmp = sys_get_temp_dir() . '/ppg-test-' . bin2hex(random_bytes(4)) . '.mp4';
file_put_contents($tmp, ppg_test_mp4_bytes());
$checked = PPG_Wan::validate_video_file($tmp);
test($checked['ok'] === false, 'a clip outside the duration window is rejected');
unlink($tmp);

$GLOBALS['ppg_test_state']['video_meta'] = array('length' => 5, 'width' => 4096, 'height' => 2160);
$tmp = sys_get_temp_dir() . '/ppg-test-' . bin2hex(random_bytes(4)) . '.mp4';
file_put_contents($tmp, ppg_test_mp4_bytes());
$checked = PPG_Wan::validate_video_file($tmp);
test($checked['ok'] === false, 'an oversized frame is rejected');
unlink($tmp);

$GLOBALS['ppg_test_state']['video_meta'] = array('length' => 5, 'width' => 1280, 'height' => 720);

/* A download from a refused host never reaches the transport. */
ppg_test_reset();
$GLOBALS['ppg_test_state']['http_queue'] = array(array('code' => 200, 'body' => ppg_test_mp4_bytes()));
$stored = PPG_Wan::store_generated_video('https://evil.example.com/clip.mp4', 55);
test($stored['ok'] === false, 'a refused host is not downloaded');
test(!$GLOBALS['ppg_test_state']['http'], 'no request is made for a refused host');

/* A redirect to a refused host is not followed. */
ppg_test_reset();
$GLOBALS['ppg_test_state']['http_queue'] = array(
    array('code' => 302, 'headers' => array('location' => 'https://evil.example.com/clip.mp4')),
);
$stored = PPG_Wan::store_generated_video('https://x.oss-cn-x.aliyuncs.com/out/clip.mp4', 55);
test($stored['ok'] === false, 'a redirect to a refused host is not followed');
test(count($GLOBALS['ppg_test_state']['http']) === 1, 'the redirect is not requested');

/* ---------------------------------------------------------- no metadata */

ppg_test_reset();
ppg_seed_post();
ppg_seed_frames();
ppg_seed_media();
ppg_stub_runner(array(array('ok' => true, 'data' => array('task_id' => 'task-meta'))));
$_POST = array('product_id' => '55', 'nonce' => 'n', 'consent' => '1', 'first_frame_id' => '11', 'last_frame_id' => '12');
PPG_Setup_AI::handle_generate();
test(!isset($GLOBALS['ppg_test_state']['meta']), 'generation writes no product metadata');

/* -------------------------------------------------------------- health */

/* The health probe needs a product, the per-product nonce and the edit
 * capability, exactly like the other endpoints. */
ppg_test_reset();
ppg_seed_post();
ppg_stub_runner(array(array('ok' => true, 'data' => array('enabled' => true, 'message' => 'ok'))));
$_POST = array('product_id' => '55', 'nonce' => 'n');
$result = PPG_Setup_AI::handle_health();
test($result['status'] === 200 && $result['body']['enabled'] === true, 'a guarded health probe answers');

ppg_test_reset();
ppg_seed_post();
$_POST = array('product_id' => '55', 'nonce' => 'n');
$GLOBALS['ppg_test_state']['nonce_ok'] = false;
$result = PPG_Setup_AI::handle_health();
test($result['status'] === 403 && $result['code'] === 'invalid_nonce', 'the health probe needs a valid nonce');

ppg_test_reset();
ppg_seed_post();
$_POST = array('nonce' => 'n');
$result = PPG_Setup_AI::handle_health();
test($result['status'] === 400 && $result['code'] === 'invalid_product', 'the health probe needs a product');

ppg_test_reset();
ppg_seed_post();
$_POST = array('product_id' => '55', 'nonce' => 'n');
$GLOBALS['ppg_test_state']['caps']['edit_post'] = false;
$result = PPG_Setup_AI::handle_health();
test($result['status'] === 403 && $result['code'] === 'forbidden', 'the health probe needs the edit capability');

/* Repeated probes are rate bounded. */
ppg_test_reset();
ppg_seed_post();
ppg_stub_runner(array(
    array('ok' => true, 'data' => array('enabled' => true, 'message' => 'ok')),
    array('ok' => true, 'data' => array('enabled' => true, 'message' => 'ok')),
));
$_POST = array('product_id' => '55', 'nonce' => 'n');
$firstProbe = PPG_Setup_AI::handle_health();
$secondProbe = PPG_Setup_AI::handle_health();
test($firstProbe['status'] === 200, 'the first health probe answers');
test($secondProbe['status'] === 429 && $secondProbe['code'] === 'too_many_health_checks', 'a repeated health probe is rate bounded');

/* A waiting import request must not reuse its stale request-local cache. */
ppg_test_reset();
$cache_id = 'job_0123456789abcdef';
$cache_key = PPG_Wan::job_key($cache_id);
$GLOBALS['ppg_test_state']['options'][$cache_key] = array('id' => $cache_id, 'status' => 'succeeded', 'attachment_id' => 777);
$GLOBALS['ppg_test_state']['stale_options'][$cache_key] = array('id' => $cache_id, 'status' => 'processing', 'attachment_id' => 0);
$fresh = PPG_Wan::load_job($cache_id);
test($fresh['status'] === 'succeeded' && $fresh['attachment_id'] === 777, 'job reload discards stale request-local object cache after a competing import');

/* Overlapping status calls serialize before provider read/write, not just import. */
ppg_test_reset(); ppg_seed_post(); ppg_seed_frames(); ppg_seed_media();
ppg_stub_runner(array(array('ok'=>true,'data'=>array('task_id'=>'task-status-race'))));
$_POST=array('product_id'=>'55','nonce'=>'n','consent'=>'1','first_frame_id'=>'11','last_frame_id'=>'12');
$status_started=PPG_Setup_AI::handle_generate();
$_POST=array('product_id'=>'55','nonce'=>'n','job_id'=>$status_started['body']['job_id']);
ppg_stub_runner(array(array('ok'=>true,'data'=>array('status'=>'processing'))));
$before_calls=count($GLOBALS['ppg_test_state']['runner']);
$GLOBALS['ppg_test_state']['during_status']=static function(){ $GLOBALS['ppg_test_state']['nested_status']=PPG_Setup_AI::handle_status(); };
$outer_status=PPG_Setup_AI::handle_status();
test($outer_status['status']===200 && $outer_status['body']['status']==='processing','outer status poll completes with the same in-flight state');
test($GLOBALS['ppg_test_state']['nested_status']['body']['status']==='processing','overlapping status call waits instead of changing the job');
test(count($GLOBALS['ppg_test_state']['runner'])===$before_calls+1,'overlapping status cannot make a second provider call or stale state write');
$released_token=PPG_Wan::acquire_lock(PPG_Wan::IMPORT_LOCK_PREFIX,$status_started['body']['job_id']);
test(is_string($released_token),'status lock is released through finally after a nonterminal result');
PPG_Wan::release_lock(PPG_Wan::IMPORT_LOCK_PREFIX,$status_started['body']['job_id'],$released_token);

/* --------------------------------------------------------------- echo pass */

echo "PASS: $count assertions\n";

<?php
/**
 * Wan provider adapter for the Portare product setup AI feature.
 *
 * This class owns everything that touches the Wan command line runtime:
 *
 * - The credential is read server side only, from a PHP constant, the site's
 *   runtime environment helper, or the process environment. It is never sent
 *   to the browser and never placed in a process argument vector.
 * - The CLI is executed through a fixed runner script. The runner receives
 *   structured JSON on stdin, builds a fixed argument vector, and returns one
 *   JSON object on stdout. No shell is involved at any point.
 * - The result bytes are downloaded over HTTPS with an explicit host
 *   allowlist, a bounded body size and no automatic redirect following. The
 *   bytes are then validated (container signature, sniffed MIME, real
 *   duration and frame size) before they are allowed into the Media Library.
 * - Nothing here publishes product metadata. A generated clip is a draft
 *   attachment until an operator selects it and saves the product normally.
 *
 * @package PortareProductGallery
 */

defined('ABSPATH') || exit;

class PPG_Wan {
    /** Job rows live one per job, so concurrent writes cannot lose a row. */
    const JOB_OPTION_PREFIX = '_ppg_ai_job_';

    /**
     * Job index, one option per product.
     *
     * The index holds only job ids. The job rows themselves are separate
     * options, so two products writing their index cannot lose a job row.
     */
    const JOB_INDEX_PREFIX = '_ppg_ai_index_';

    /** Lock keys. add_option() only succeeds when the key is absent. */
    const SUBMIT_LOCK_PREFIX = '_ppg_ai_lock_submit_';
    const IMPORT_LOCK_PREFIX = '_ppg_ai_lock_import_';

    /** Maximum number of retained job ids per product and user. */
    const MAX_JOBS = 20;

    /** How long a finished job row is kept, in seconds. */
    const JOB_TTL = 3600;

    /**
     * Maximum number of jobs that may still be in flight for one product.
     *
     * One product may only have one paid render in flight at a time, across
     * every user. A second request is refused instead of buying a second
     * render for the same product.
     */
    const MAX_ACTIVE_JOBS = 1;

    /** Lock lifetime for the short submission lock, in seconds. */
    const LOCK_TTL = 300;

    /**
     * Lock lifetime for the import lock, in seconds.
     *
     * An import can follow up to four download hops of 120 seconds each, so
     * this lease is longer than the worst case import. A lock is never
     * reclaimed while its holder may still be running.
     */
    const IMPORT_LOCK_TTL = 1800;

    /** Maximum size of one frame image, in bytes. */
    const MAX_FRAME_BYTES = 20971520; // 20 MB.

    /** Maximum accepted frame width and height, in pixels. */
    const MAX_FRAME_WIDTH = 4096;
    const MAX_FRAME_HEIGHT = 4096;

    /** Meta key that correlates a stored attachment with the job that made it. */
    const ATTACHMENT_JOB_META = '_ppg_ai_job_id';

    /** Clip durations the plugin offers. */
    const DURATIONS = array(5, 10, 15);

    /** Clip resolutions the plugin offers. */
    const RESOLUTIONS = array('480P', '720P');

    /** Default clip duration when the request does not choose one. */
    const DEFAULT_DURATION = 5;

    /** Default clip resolution when the request does not choose one. */
    const DEFAULT_RESOLUTION = '720P';

    /** Raster frames only. */
    const IMAGE_MIMES = array('image/png', 'image/jpeg', 'image/webp');

    const MAX_PROMPT = 500;

    /** Maximum size of a generated clip, in bytes. */
    const MAX_BYTES = 26214400; // 25 MB.

    /** Accepted clip duration window, in seconds. */
    const MIN_DURATION = 2;
    const MAX_DURATION = 17;

    /** Accepted frame size window. 720P is 1280x720, so allow a square bound. */
    const MAX_WIDTH = 1280;
    const MAX_HEIGHT = 1280;

    /** Maximum number of redirects followed by hand, one at a time. */
    const MAX_REDIRECTS = 3;

    /**
     * Hosts allowed to serve the generated clip.
     *
     * The staging environment blocks outbound HTTP by default and permits
     * only these Wan delivery suffixes. The list is deliberately narrow: it
     * is a download allowlist, not a general egress allowance.
     */
    const DOWNLOAD_HOST_SUFFIXES = array(
        '.alicdn.com',
        '.aliyuncs.com',
        '.wanxai.com',
        '.wan.video',
    );

    /** Runtime locations. */
    const NODE_BINARY = '/usr/local/bin/node';
    const CLI_ENTRY = '/opt/portare-wan/node_modules/@wan-ai/cli/dist/index.js';

    /**
     * Provider region used when the site does not configure one.
     *
     * The runner executes the CLI with an isolated HOME, so the CLI cannot
     * read a region from a user configuration file. The region therefore has
     * to be passed explicitly, and this account renders against the
     * international endpoint. A site that serves the Chinese region can set
     * WAN_SITE (or the PPG_WAN_SITE constant) to "cn".
     */
    const DEFAULT_SITE = 'intl';

    /* ------------------------------------------------------------- config */

    /**
     * Provider configuration.
     *
     * Precedence for the credential: PHP constant, the site's own runtime
     * environment helper, then the process environment. The credential is
     * never returned to the browser.
     *
     * @return array
     */
    public static function config() {
        $key = '';
        if (defined('PPG_WAN_ACCESS_KEY') && is_string(PPG_WAN_ACCESS_KEY)) {
            $key = PPG_WAN_ACCESS_KEY;
        }
        if ($key === '' && function_exists('railway_env')) {
            $fromRuntime = railway_env('WAN_ACCESS_KEY');
            if (is_string($fromRuntime)) { $key = $fromRuntime; }
        }
        if ($key === '' && function_exists('getenv')) {
            $fromEnv = getenv('WAN_ACCESS_KEY');
            if (is_string($fromEnv)) { $key = $fromEnv; }
        }

        $site = '';
        if (defined('PPG_WAN_SITE') && is_string(PPG_WAN_SITE)) { $site = PPG_WAN_SITE; }
        if ($site === '' && function_exists('railway_env')) {
            $fromRuntime = railway_env('WAN_SITE');
            if (is_string($fromRuntime)) { $site = $fromRuntime; }
        }
        if ($site === '' && function_exists('getenv')) {
            $fromEnv = getenv('WAN_SITE');
            if (is_string($fromEnv)) { $site = $fromEnv; }
        }
        $site = strtolower(trim($site));
        if ($site !== 'cn' && $site !== 'intl') { $site = self::DEFAULT_SITE; }

        $config = array(
            'key' => trim($key),
            'site' => $site,
            'node' => self::NODE_BINARY,
            'cli' => self::CLI_ENTRY,
            'runner' => self::runner_path(),
            'media_root' => self::media_root(),
        );
        if (function_exists('apply_filters')) {
            $filtered = apply_filters('ppg_wan_config', $config);
            if (is_array($filtered)) { $config = array_merge($config, $filtered); }
        }
        $config['key'] = is_string($config['key']) ? trim($config['key']) : '';
        $config['site'] = in_array($config['site'], array('cn', 'intl'), true) ? $config['site'] : self::DEFAULT_SITE;
        $config['enabled'] = $config['key'] !== '';
        return $config;
    }

    /**
     * Non-secret configuration for the editor UI.
     *
     * The credential is never included. A disabled state is reported with a
     * reason that distinguishes a missing credential from a missing runtime.
     *
     * @return array
     */
    public static function public_config() {
        $config = self::config();
        $runtime = self::runtime_status();
        $hasKey = $config['key'] !== '';
        $ready = $hasKey && $runtime['ready'];
        $reason = '';
        $message = '';
        if (!$hasKey) {
            $reason = 'missing_credential';
            $message = 'AI motion generation is not configured on this site. The Wan access key is missing.';
        } elseif (!$runtime['ready']) {
            $reason = $runtime['reason'];
            $message = 'AI motion generation is not configured on this site. The Wan runtime is not installed.';
        }
        return array(
            'enabled' => (bool) $ready,
            'provider' => 'Wan',
            'message' => $message,
            'reason' => $reason,
            'duration' => self::DEFAULT_DURATION,
            'durations' => self::DURATIONS,
            'resolutions' => self::RESOLUTIONS,
            'minImages' => 2,
            'maxImages' => 2,
            'maxPrompt' => self::MAX_PROMPT,
            'runtimeReady' => (bool) $runtime['ready'],
        );
    }

    /**
     * Runtime availability, checked on the filesystem only.
     *
     * No process is started and no provider call is made, so a disabled site
     * still renders its admin screen normally.
     *
     * @return array{ready:bool,reason:string}
     */
    public static function runtime_status() {
        if (!function_exists('is_file')) {
            return array('ready' => false, 'reason' => 'runtime_not_configured');
        }
        if (!function_exists('proc_open')) {
            return array('ready' => false, 'reason' => 'proc_open_missing');
        }
        $config = self::config();
        if (!is_string($config['runner']) || !is_file($config['runner'])) {
            return array('ready' => false, 'reason' => 'runtime_missing');
        }
        if (!is_string($config['cli']) || !is_file($config['cli'])) {
            return array('ready' => false, 'reason' => 'cli_missing');
        }
        if (!is_string($config['node']) || !is_file($config['node'])) {
            return array('ready' => false, 'reason' => 'node_missing');
        }
        if (function_exists('is_executable') && !is_executable($config['node'])) {
            return array('ready' => false, 'reason' => 'node_missing');
        }
        return array('ready' => true, 'reason' => '');
    }

    /** Absolute path of the runner script inside the plugin. */
    public static function runner_path() {
        if (defined('PPG_PLUGIN_DIR') && is_string(PPG_PLUGIN_DIR)) {
            return PPG_PLUGIN_DIR . 'runtime/wan-runner.cjs';
        }
        return dirname(__DIR__) . '/runtime/wan-runner.cjs';
    }

    /**
     * Absolute path of the uploads directory.
     *
     * The runner refuses any frame path outside this directory, so a request
     * cannot ask the provider to read an arbitrary file on the server.
     */
    public static function media_root() {
        if (!function_exists('wp_upload_dir')) { return ''; }
        $uploads = wp_upload_dir(null, false);
        if (!is_array($uploads) || empty($uploads['basedir'])) { return ''; }
        $base = (string) $uploads['basedir'];
        $real = @realpath($base);
        return $real === false ? rtrim($base, '/') : $real;
    }

    /* ------------------------------------------------------------- runner */

    /**
     * Run one operation through the runner script.
     *
     * @param string $op      One of create, status, health.
     * @param array  $payload Operation fields.
     * @return array{ok:bool,code:string,message:string,data:array}
     */
    public static function run($op, array $payload) {
        // Test transport seam. It is inert unless the constant is defined,
        // so a production request always reaches the local runner.
        if (defined('PPG_WAN_TEST_TRANSPORT') && function_exists('apply_filters')) {
            $seam = apply_filters('ppg_wan_transport', null, (string) $op, $payload);
            if (is_array($seam) && array_key_exists('ok', $seam)) {
                return array_merge(
                    array('ok' => false, 'code' => 'provider_error', 'message' => '', 'data' => array()),
                    $seam
                );
            }
        }

        $config = self::config();
        if ($config['key'] === '') {
            return self::failure('not_configured', 'AI motion generation is not configured on this site.');
        }
        $runtime = self::runtime_status();
        if (!$runtime['ready']) {
            return self::failure('runtime_missing', 'The AI provider runtime is not installed on this server.');
        }

        $request = array_merge(array('op' => (string) $op), $payload);
        $body = wp_json_encode($request);
        if (!is_string($body)) {
            return self::failure('invalid_request', 'The provider request could not be prepared.');
        }

        $result = self::invoke_runner($config, $body);
        if (!$result['ok']) {
            return self::failure($result['code'], $result['message']);
        }
        $decoded = json_decode($result['stdout'], true);
        if (!is_array($decoded)) {
            return self::failure('unreadable_response', 'The AI provider did not return a usable answer.');
        }
        if (empty($decoded['ok'])) {
            $error = isset($decoded['error']) && is_array($decoded['error']) ? $decoded['error'] : array();
            $code = isset($error['code']) && is_string($error['code']) ? $error['code'] : 'provider_unreadable';
            $message = isset($error['message']) && is_string($error['message']) ? $error['message'] : 'The AI provider rejected the request.';
            // The runner marks an outcome as ambiguous when the provider may
            // already have accepted the request. That flag wins over the
            // code, so an unknown failure is never treated as a refusal.
            $ambiguous = array_key_exists('ambiguous', $error) ? (bool) $error['ambiguous'] : self::is_ambiguous_failure($code);
            $failure = self::failure($code, self::scrub($message, $config['key']));
            $failure['ambiguous'] = $ambiguous;
            return $failure;
        }
        $data = $decoded;
        unset($data['ok'], $data['op']);
        return array('ok' => true, 'code' => 'ok', 'message' => '', 'data' => $data);
    }

    /**
     * Execute the runner and capture its single JSON response line.
     *
     * The child receives an explicit, minimal environment. The WordPress
     * process environment is deliberately not inherited.
     *
     * stdout and stderr are drained together under one monotonic deadline, so
     * a chatty child can never block the reader, and the total time is
     * bounded no matter which pipe is busy. On the deadline only the process
     * this call started is terminated.
     *
     * @param array  $config Provider configuration.
     * @param string $body   JSON request.
     * @return array{ok:bool,code:string,message:string,stdout:string}
     */
    private static function invoke_runner(array $config, $body) {
        if (!function_exists('proc_open')) {
            return array('ok' => false, 'code' => 'runtime_missing', 'message' => 'This server cannot run the AI provider runtime.', 'stdout' => '');
        }

        $home = self::make_temp_dir();
        $descriptors = array(
            0 => array('pipe', 'r'),
            1 => array('pipe', 'w'),
            2 => array('pipe', 'w'),
        );
        $env = array(
            'PATH' => '/usr/local/bin:/usr/bin:/bin',
            'HOME' => $home,
            'LANG' => 'C.UTF-8',
            'LC_ALL' => 'C.UTF-8',
            'WAN_ACCESS_KEY' => $config['key'],
            'PPG_WAN_CLI' => $config['cli'],
            'PPG_WAN_NODE' => $config['node'],
            'PPG_WAN_MEDIA_ROOT' => $config['media_root'],
            'WAN_OUTPUT' => 'json',
        );
        if ($config['site'] !== '') { $env['WAN_SITE'] = $config['site']; }

        $command = array($config['node'], $config['runner']);
        $pipes = array();
        $process = @proc_open($command, $descriptors, $pipes, null, $env);
        if (!is_resource($process)) {
            self::remove_temp_dir($home);
            return array('ok' => false, 'code' => 'runtime_missing', 'message' => 'The AI provider runtime could not be started.', 'stdout' => '');
        }

        if (isset($pipes[0]) && is_resource($pipes[0])) {
            @fwrite($pipes[0], $body);
            @fclose($pipes[0]);
        }

        $drained = self::drain_both($pipes, 1048576, 65536, 240);
        $stdout = trim($drained['stdout']);
        $stderr = $drained['stderr'];

        if ($drained['timed_out']) {
            // Only the process this call started is terminated. The runner
            // kills its own child group, so nothing else is touched.
            self::close_owned_process($process, true);
            self::remove_temp_dir($home);
            return array(
                'ok' => false,
                'code' => 'runner_timeout',
                'message' => 'The AI provider did not answer in time.',
                'stdout' => '',
            );
        }

        self::close_owned_process($process, false);
        self::remove_temp_dir($home);

        if ($stdout === '') {
            $detail = self::scrub(trim($stderr), $config['key']);
            return array(
                'ok' => false,
                'code' => 'no_response',
                'message' => 'The AI provider did not answer. ' . $detail,
                'stdout' => '',
            );
        }
        return array('ok' => true, 'code' => 'ok', 'message' => '', 'stdout' => $stdout);
    }

    /** Reap only our runner, escalating if it ignores graceful termination. */
    private static function close_owned_process($process, $terminate) {
        if ($terminate) { @proc_terminate($process, 15); }
        $deadline = self::monotonic_seconds() + 1.0;
        do {
            $state = @proc_get_status($process);
            if (!is_array($state) || empty($state['running'])) { break; }
            usleep(20000);
        } while (self::monotonic_seconds() < $deadline);
        if (is_array($state) && !empty($state['running'])) {
            @proc_terminate($process, 15);
            usleep(100000);
            $state = @proc_get_status($process);
            if (is_array($state) && !empty($state['running'])) { @proc_terminate($process, 9); }
        }
        @proc_close($process);
    }

    /**
     * Read both pipes at once under one monotonic deadline.
     *
     * The deadline is measured with the monotonic clock, so a wall clock
     * change cannot extend or shorten the budget. Each pipe has its own byte
     * ceiling, and the total output is capped as well.
     *
     * @param array $pipes    Pipe resources from proc_open().
     * @param int   $max_out  Maximum stdout bytes.
     * @param int   $max_err  Maximum stderr bytes.
     * @param int   $limit    Deadline in seconds.
     * @return array{stdout:string,stderr:string,timed_out:bool}
     */
    private static function drain_both($pipes, $max_out, $max_err, $limit) {
        $stdout = '';
        $stderr = '';
        $timed_out = false;

        $open = array();
        foreach (array(1, 2) as $index) {
            if (isset($pipes[$index]) && is_resource($pipes[$index])) {
                stream_set_blocking($pipes[$index], false);
                $open[$index] = $pipes[$index];
            }
        }

        $start = self::monotonic_seconds();
        $deadline = $start + max(1, (int) $limit);

        while ($open) {
            $remaining = $deadline - self::monotonic_seconds();
            if ($remaining <= 0) { $timed_out = true; break; }
            $read = array_values($open);
            $write = null;
            $except = null;
            $seconds = (int) floor($remaining);
            $micro = (int) (($remaining - $seconds) * 1000000);
            $ready = @stream_select($read, $write, $except, $seconds, $micro);
            if ($ready === false) { break; }
            if ($ready === 0) { continue; }
            foreach ($read as $pipe) {
                $index = array_search($pipe, $open, true);
                if ($index === false) { continue; }
                $chunk = @fread($pipe, 65536);
                if ($chunk === false || $chunk === '') {
                    if (feof($pipe)) {
                        @fclose($pipe);
                        unset($open[$index]);
                    }
                    continue;
                }
                if ($index === 1) {
                    if (strlen($stdout) + strlen($chunk) > $max_out) {
                        $stdout .= substr($chunk, 0, max(0, $max_out - strlen($stdout)));
                    } else {
                        $stdout .= $chunk;
                    }
                } else {
                    if (strlen($stderr) + strlen($chunk) > $max_err) {
                        $stderr .= substr($chunk, 0, max(0, $max_err - strlen($stderr)));
                    } else {
                        $stderr .= $chunk;
                    }
                }
            }
        }

        foreach ($open as $pipe) { @fclose($pipe); }
        return array('stdout' => $stdout, 'stderr' => $stderr, 'timed_out' => $timed_out);
    }

    /**
     * A monotonic time source in seconds.
     *
     * hrtime() is used when it is available, because the wall clock can jump
     * and would shorten or extend a timeout unpredictably.
     *
     * @return float
     */
    private static function monotonic_seconds() {
        if (function_exists('hrtime')) {
            $ns = hrtime(true);
            if (is_int($ns) || is_float($ns)) { return ((float) $ns) / 1000000000; }
        }
        return microtime(true);
    }

    /** A private scratch directory for one runner process. */
    private static function make_temp_dir() {
        $base = function_exists('wp_tempnam') ? wp_tempnam('ppg-wan-') : tempnam(sys_get_temp_dir(), 'ppg-wan-');
        $dir = is_string($base) && $base !== '' ? dirname($base) : sys_get_temp_dir();
        if (is_string($base) && $base !== '') { @unlink($base); }
        $dir = rtrim($dir, '/') . '/ppg-wan-' . bin2hex(random_bytes(8));
        @mkdir($dir, 0700, true);
        return $dir;
    }

    /** Remove a scratch directory and everything in it. */
    private static function remove_temp_dir($dir) {
        if (!is_string($dir) || $dir === '' || !is_dir($dir)) { return; }
        $entries = @scandir($dir);
        if (is_array($entries)) {
            foreach ($entries as $entry) {
                if ($entry === '.' || $entry === '..') { continue; }
                $path = $dir . '/' . $entry;
                if (is_dir($path)) { self::remove_temp_dir($path); } else { @unlink($path); }
            }
        }
        @rmdir($dir);
    }

    /** Remove the credential from a message before it reaches an operator. */
    public static function scrub($message, $key = '') {
        $text = is_string($message) ? $message : '';
        if (is_string($key) && $key !== '') {
            $text = str_replace($key, '[redacted]', $text);
        }
        $text = preg_replace('/Bearer\s+[A-Za-z0-9._~+\/=:-]+/', 'Bearer [redacted]', $text);
        $text = preg_replace('/wan-sk\.[A-Za-z0-9._-]+/', 'wan-sk.[redacted]', $text);
        $text = preg_replace('/(https?:\/\/[^\s?"\'<>]*)\?[^\s"\'<>]*/', '$1?[redacted]', $text);
        if (strlen($text) > 600) { $text = substr($text, 0, 600) . '…'; }
        return $text;
    }

    /**
     * Is this failure code an outcome the caller cannot classify?
     *
     * A failure is only certain when it happened before the provider could
     * have accepted the request, or when the provider itself rejected the
     * request with a definite reason. Everything else is ambiguous: the
     * render may be running, so it must never be paid for twice.
     *
     * @param string $code Failure code.
     * @return bool
     */
    public static function is_ambiguous_failure($code) {
        $code = is_string($code) ? $code : '';
        // Failures that happen before the provider is contacted.
        $pre_submission = array(
            'not_configured',
            'runtime_missing',
            'runtime_not_configured',
            'proc_open_missing',
            'invalid_request',
            'invalid_media',
            'media_root_missing',
            'unknown_operation',
            'unknown_field',
            'missing_credential',
            'runner_spawn_failed',
        );
        if (in_array($code, $pre_submission, true)) { return false; }
        // A definite rejection by the provider.
        if ($code === 'provider_rejected') { return false; }
        // Everything else is uncertain and is treated as ambiguous.
        return true;
    }

    /** @return array{ok:bool,code:string,message:string,data:array} */
    private static function failure($code, $message) {
        return array('ok' => false, 'code' => (string) $code, 'message' => (string) $message, 'data' => array());
    }

    /* -------------------------------------------------------------- inputs */

    /** Plain-text prompt, length bounded, markup stripped. */
    public static function sanitize_prompt($raw) {
        if (!is_string($raw)) { return ''; }
        $text = function_exists('wp_strip_all_tags') ? wp_strip_all_tags($raw, true) : strip_tags($raw);
        $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $text);
        $text = trim(preg_replace('/\s+/u', ' ', $text));
        if (function_exists('mb_substr')) { return mb_substr($text, 0, self::MAX_PROMPT); }
        return substr($text, 0, self::MAX_PROMPT);
    }

    /** Prompt used when the operator leaves the field empty. */
    public static function default_prompt() {
        return 'Animate the product setup sequence shown in the reference images, following them in order. '
            . 'Keep the product shape, colour and proportions accurate, use a fixed camera and a clean neutral background.';
    }

    /**
     * Strict duration allowlist.
     *
     * @param mixed $raw    Submitted value.
     * @param int   $error  Set to 1 when the value is present but invalid.
     * @return int
     */
    public static function sanitize_duration($raw, &$error = 0) {
        if ($raw === null || $raw === '') { return self::DEFAULT_DURATION; }
        if (is_string($raw) && ctype_digit($raw)) { $raw = (int) $raw; }
        if (!is_int($raw)) { $error = 1; return self::DEFAULT_DURATION; }
        if (!in_array($raw, self::DURATIONS, true)) { $error = 1; return self::DEFAULT_DURATION; }
        return $raw;
    }

    /**
     * Strict resolution allowlist.
     *
     * @param mixed $raw    Submitted value.
     * @param int   $error  Set to 1 when the value is present but invalid.
     * @return string
     */
    public static function sanitize_resolution($raw, &$error = 0) {
        if ($raw === null || $raw === '') { return self::DEFAULT_RESOLUTION; }
        if (!is_string($raw)) { $error = 1; return self::DEFAULT_RESOLUTION; }
        $value = strtoupper(trim($raw));
        if (!in_array($value, self::RESOLUTIONS, true)) { $error = 1; return self::DEFAULT_RESOLUTION; }
        return $value;
    }

    /**
     * Validate the two frame attachments.
     *
     * Each frame must be a raster image the current user may read, and the
     * two frames must differ.
     *
     * @return array{ok:bool,code:string,message:string,first:int,last:int}
     */
    public static function validate_frames($first_raw, $last_raw) {
        $first = self::positive_id($first_raw);
        $last = self::positive_id($last_raw);
        if (!$first || !$last) {
            return self::frame_failure('invalid_frames', 'Select a first and a last frame for the AI provider.');
        }
        if ($first === $last) {
            return self::frame_failure('invalid_frames', 'The first and the last frame must be different images.');
        }
        $checked = self::check_frame($first);
        if (!$checked['ok']) { return $checked; }
        $checked = self::check_frame($last);
        if (!$checked['ok']) { return $checked; }
        return array('ok' => true, 'code' => 'ok', 'message' => '', 'first' => $first, 'last' => $last);
    }

    /** @return array{ok:bool,code:string,message:string,first:int,last:int} */
    private static function frame_failure($code, $message) {
        return array('ok' => false, 'code' => (string) $code, 'message' => (string) $message, 'first' => 0, 'last' => 0);
    }

    /**
     * One frame must exist, be a raster image, and be readable by the operator.
     *
     * The attachment MIME field alone is not trusted: the file itself is
     * inspected, because the field can disagree with the bytes on disk.
     *
     * @return array{ok:bool,code:string,message:string,first:int,last:int}
     */
    private static function check_frame($attachment_id) {
        $id = self::positive_id($attachment_id);
        if (!$id) {
            return self::frame_failure('invalid_frames', 'Select a first and a last frame for the AI provider.');
        }
        if (function_exists('get_post_type') && get_post_type($id) !== 'attachment') {
            return self::frame_failure('invalid_frames', 'The selected frame is not a media library item.');
        }
        $mime = function_exists('get_post_mime_type') ? get_post_mime_type($id) : '';
        if (!is_string($mime) || !in_array($mime, self::IMAGE_MIMES, true)) {
            return self::frame_failure('invalid_frames', 'The selected frame must be a PNG, JPEG or WebP image.');
        }
        if (function_exists('current_user_can') && !current_user_can('read_post', $id)) {
            return self::frame_failure('forbidden', 'You are not allowed to use the selected frame image.');
        }
        $checked = self::check_frame_file($id, $mime);
        if (!$checked['ok']) { return $checked; }
        return array('ok' => true, 'code' => 'ok', 'message' => '', 'first' => $id, 'last' => 0);
    }

    /**
     * Inspect the bytes of one frame attachment.
     *
     * The file must exist inside the uploads folder, be a regular file of a
     * bounded size, and really decode as the image type the attachment
     * claims. The dimensions are bounded as well, so an oversized image is
     * refused before it is sent to the provider.
     *
     * @param int    $attachment_id Attachment id.
     * @param string $declared_mime MIME type recorded on the attachment.
     * @return array{ok:bool,code:string,message:string,first:int,last:int}
     */
    private static function check_frame_file($attachment_id, $declared_mime) {
        if (!function_exists('get_attached_file')) {
            return self::frame_failure('invalid_frames', 'The selected frame is not available as a file on this server.');
        }
        $path = get_attached_file((int) $attachment_id);
        if (!is_string($path) || $path === '') {
            return self::frame_failure('invalid_frames', 'One of the selected frames is not available as a file on this server.');
        }
        $real = @realpath($path);
        if ($real === false || !is_file($real)) {
            return self::frame_failure('invalid_frames', 'One of the selected frames is not available as a file on this server.');
        }
        $root = self::media_root();
        if ($root === '' || ($real !== $root && strpos($real, $root . '/') !== 0)) {
            return self::frame_failure('invalid_frames', 'One of the selected frames is outside the uploads folder.');
        }
        $size = (int) @filesize($real);
        if ($size <= 0) {
            return self::frame_failure('invalid_frames', 'One of the selected frames is empty.');
        }
        if ($size > self::MAX_FRAME_BYTES) {
            return self::frame_failure('invalid_frames', 'One of the selected frames is larger than 20 MB and was refused.');
        }

        $sniffed = self::sniff_mime($real);
        if ($sniffed === '' || !in_array($sniffed, self::IMAGE_MIMES, true)) {
            return self::frame_failure('invalid_frames', 'One of the selected frames is not really a PNG, JPEG or WebP image.');
        }
        if ($sniffed !== $declared_mime) {
            return self::frame_failure('invalid_frames', 'One of the selected frames does not match its recorded file type.');
        }

        $size_info = @getimagesize($real);
        if (!is_array($size_info) || empty($size_info[0]) || empty($size_info[1])) {
            return self::frame_failure('invalid_frames', 'One of the selected frames could not be read as an image.');
        }
        $width = (int) $size_info[0];
        $height = (int) $size_info[1];
        if ($width <= 0 || $height <= 0 || $width > self::MAX_FRAME_WIDTH || $height > self::MAX_FRAME_HEIGHT) {
            return self::frame_failure('invalid_frames', 'One of the selected frames has an unusable frame size.');
        }
        return array('ok' => true, 'code' => 'ok', 'message' => '', 'first' => (int) $attachment_id, 'last' => 0);
    }

    /**
     * The MIME type of a file, as the file itself reports it.
     *
     * @param string $path Absolute path.
     * @return string Empty when the type cannot be determined.
     */
    private static function sniff_mime($path) {
        if (!function_exists('finfo_open')) { return ''; }
        $finfo = @finfo_open(FILEINFO_MIME_TYPE);
        if (!$finfo) { return ''; }
        $mime = @finfo_file($finfo, $path);
        finfo_close($finfo);
        return is_string($mime) ? $mime : '';
    }

    /** Local file path of an attachment, used as the provider frame input. */
    public static function frame_path($attachment_id) {
        if (!function_exists('get_attached_file')) { return ''; }
        $path = get_attached_file(self::positive_id($attachment_id));
        if (!is_string($path) || $path === '') { return ''; }
        $real = @realpath($path);
        if ($real === false) { return ''; }
        $root = self::media_root();
        if ($root === '' || ($real !== $root && strpos($real, $root . '/') !== 0)) { return ''; }
        return $real;
    }

    /* ---------------------------------------------------------- job store */

    /** Option key of one job row. */
    public static function job_key($job_id) {
        $id = self::sanitize_job_id($job_id);
        return $id === '' ? '' : self::JOB_OPTION_PREFIX . $id;
    }

    /** @return array|null */
    public static function load_job($job_id) {
        $key = self::job_key($job_id);
        if ($key === '') { return null; }
        // Another request may have completed import while this request waited
        // on its lock. Drop the request-local/object-cache copy before reading
        // the non-autoloaded row, not merely the PHP variable holding it.
        self::option_cache_forget($key);
        $job = get_option($key, null);
        return is_array($job) ? $job : null;
    }

    /**
     * Write a job row.
     *
     * The write is checked: a row that cannot be stored is reported to the
     * caller rather than silently lost. update_option() returns false when
     * the stored value is unchanged, so the stored row is read back and
     * compared before the write is accepted.
     *
     * @return bool
     */
    public static function save_job(array $job) {
        $key = self::job_key(isset($job['id']) ? $job['id'] : '');
        if ($key === '') { return false; }
        if (get_option($key, null) === null) {
            $added = add_option($key, $job, '', false);
            if ($added) { return true; }
        } else {
            $updated = update_option($key, $job, false);
            if ($updated) { return true; }
        }
        // The write reported "unchanged" or failed. The row is only accepted
        // when a read back proves that the intended state is stored.
        $stored = get_option($key, null);
        return is_array($stored) && self::same_job($stored, $job);
    }

    /**
     * Do two job rows hold the same state?
     *
     * @param array $a First row.
     * @param array $b Second row.
     * @return bool
     */
    private static function same_job(array $a, array $b) {
        $keys = array_unique(array_merge(array_keys($a), array_keys($b)));
        foreach ($keys as $key) {
            $left = array_key_exists($key, $a) ? $a[$key] : null;
            $right = array_key_exists($key, $b) ? $b[$key] : null;
            if (is_scalar($left) && is_scalar($right)) {
                if ((string) $left !== (string) $right) { return false; }
                continue;
            }
            if ($left !== $right) { return false; }
        }
        return true;
    }

    /**
     * Job ids for one product, newest first.
     *
     * The order is explicit, so the recovery path always sees the newest
     * job first and no caller has to guess the direction.
     *
     * @return array
     */
    public static function job_index($product_id) {
        $index = get_option(self::index_key($product_id), array());
        if (!is_array($index)) { return array(); }
        $clean = array();
        foreach ($index as $id) {
            $sanitized = self::sanitize_job_id($id);
            if ($sanitized !== '') { $clean[] = $sanitized; }
        }
        return $clean;
    }

    /** Option key of the job index of one product. */
    public static function index_key($product_id) {
        return self::JOB_INDEX_PREFIX . (int) $product_id;
    }

    /**
     * Record a job id in the index of one product.
     *
     * The write is checked with a read back, so a job is never paid for
     * unless the index really points at it.
     *
     * @return bool
     */
    public static function remember_job($product_id, $job_id) {
        $id = self::sanitize_job_id($job_id);
        if ($id === '') { return false; }
        $ids = self::job_index($product_id);
        if (!in_array($id, $ids, true)) {
            // The newest job goes first, so the index reads newest first.
            array_unshift($ids, $id);
        }
        $kept = self::retained_index($ids);
        update_option(self::index_key($product_id), $kept, false);
        $stored = get_option(self::index_key($product_id), array());
        return is_array($stored) && in_array($id, self::job_index($product_id), true);
    }

    /**
     * Keep every active job id and bound the finished ones.
     *
     * An in-flight job is never dropped from the index: dropping it would
     * lose the only reference to a paid render. The newest finished jobs are
     * the ones kept, because the index reads newest first.
     *
     * @param array $ids Job ids, newest first.
     * @return array
     */
    private static function retained_index(array $ids) {
        $finished = array();
        foreach ($ids as $id) {
            $job = self::load_job($id);
            if (!$job) { continue; }
            if (!self::is_active($job)) { $finished[] = $id; }
        }
        // The finished list is newest first, so the oldest ones sit at the
        // end and are the ones dropped.
        $drop = array();
        if (count($finished) > self::MAX_JOBS) {
            $drop = array_slice($finished, self::MAX_JOBS);
        }
        $kept = array();
        foreach ($ids as $id) {
            if (in_array($id, $drop, true)) { continue; }
            $job = self::load_job($id);
            if (!$job) { continue; }
            $kept[] = $id;
        }
        return $kept;
    }

    /**
     * Jobs that are still in flight for one product, across all users.
     *
     * @return array
     */
    public static function active_jobs($product_id) {
        $active = array();
        foreach (self::job_index($product_id) as $id) {
            $job = self::load_job($id);
            if (!$job) { continue; }
            if ((int) ($job['product_id'] ?? 0) !== (int) $product_id) { continue; }
            if (self::is_active($job)) { $active[] = $job; }
        }
        return $active;
    }

    /** A job is active until it succeeds, fails, or is explicitly abandoned. */
    public static function is_active(array $job) {
        $status = isset($job['status']) ? (string) $job['status'] : '';
        return in_array($status, array('submitted', 'processing', 'unknown'), true);
    }

    /**
     * Drop expired job rows and trim the index.
     *
     * Only finished jobs expire. A job that is still in flight is never
     * removed, because that would lose a paid render.
     */
    public static function prune_jobs($product_id) {
        $ids = self::job_index($product_id);
        if (!$ids) { return; }
        $now = time();
        $kept = array();
        foreach ($ids as $id) {
            $job = self::load_job($id);
            if (!$job) { continue; }
            $updated = isset($job['updated']) ? (int) $job['updated'] : 0;
            if (!self::is_active($job) && $updated < $now - self::JOB_TTL) {
                delete_option(self::job_key($id));
                continue;
            }
            $kept[] = $id;
        }
        $retained = self::retained_index($kept);
        $current = self::job_index($product_id);
        if ($current !== $retained) {
            update_option(self::index_key($product_id), $retained, false);
        }
    }

    /**
     * Acquire an atomic lock.
     *
     * The lock value carries an owner token. A holder releases only its own
     * lock, and a stale lock is reclaimed with a compare-and-set, so a slow
     * holder can never delete the lock of a newer holder.
     *
     * @param string $prefix Lock prefix.
     * @param mixed  $scope  Lock scope.
     * @param int    $ttl    Lease in seconds.
     * @return string|false The owner token, or false when the lock is held.
     */
    public static function acquire_lock($prefix, $scope, $ttl = self::LOCK_TTL) {
        $key = $prefix . self::scope_hash($scope);
        $token = bin2hex(random_bytes(16));
        $value = array('at' => time(), 'owner' => $token);
        if (self::option_add($key, $value)) { return $token; }

        $existing = get_option($key, null);
        if (!is_array($existing) || !isset($existing['at'])) {
            // An unreadable lock is not reclaimed blindly.
            return false;
        }
        $stamp = (int) $existing['at'];
        if ($stamp > time() - max(1, (int) $ttl)) { return false; }
        // The lease has expired. Reclaim it with a compare-and-set so two
        // reclaimers cannot both take the lock.
        if (!self::option_cas($key, $existing, $value)) { return false; }
        return $token;
    }

    /**
     * Release a lock.
     *
     * Only the owner of the lock may release it. A holder whose lease was
     * already reclaimed cannot delete the lock of the newer holder.
     *
     * @param string $prefix Lock prefix.
     * @param mixed  $scope  Lock scope.
     * @param string $token  Owner token returned by acquire_lock().
     * @return bool
     */
    public static function release_lock($prefix, $scope, $token) {
        if (!is_string($token) || $token === '') { return false; }
        $key = $prefix . self::scope_hash($scope);
        $current = get_option($key, null);
        if (!is_array($current) || !isset($current['owner']) || $current['owner'] !== $token) {
            return false;
        }
        return self::option_delete_cas($key, $current);
    }

    /**
     * Add an option only when the key is absent.
     *
     * With a database handle the insert is a real INSERT IGNORE, so exactly
     * one caller can create the key. add_option() alone is not enough: core
     * inserts with ON DUPLICATE KEY UPDATE, which lets a second caller
     * overwrite the first caller's lock.
     *
     * @return bool
     */
    private static function option_add($key, $value) {
        global $wpdb;
        if (isset($wpdb) && is_object($wpdb) && isset($wpdb->options)
            && method_exists($wpdb, 'query') && method_exists($wpdb, 'prepare')
            && function_exists('maybe_serialize')) {
            $serialized = maybe_serialize($value);
            $inserted = $wpdb->query($wpdb->prepare(
                "INSERT IGNORE INTO `{$wpdb->options}` (`option_name`, `option_value`, `autoload`) VALUES (%s, %s, 'no')",
                $key,
                $serialized
            ));
            if ((int) $inserted !== 1) { return false; }
            self::option_cache_forget($key);
            return true;
        }
        if (function_exists('wp_cache_delete')) { @wp_cache_delete($key, 'options'); }
        return (bool) add_option($key, $value, '', false);
    }

    /**
     * Replace an option only when it still holds the expected value.
     *
     * The compare-and-set runs as one statement, so two reclaimers can
     * never both take the same stale lock.
     *
     * @param string $key      Option key.
     * @param array  $expected Value the option must still hold.
     * @param array  $value    New value.
     * @return bool
     */
    private static function option_cas($key, array $expected, array $value) {
        global $wpdb;
        if (isset($wpdb) && is_object($wpdb) && isset($wpdb->options)
            && method_exists($wpdb, 'query') && method_exists($wpdb, 'prepare')
            && function_exists('maybe_serialize')) {
            $updated = $wpdb->query($wpdb->prepare(
                "UPDATE `{$wpdb->options}` SET `option_value` = %s WHERE `option_name` = %s AND `option_value` = %s",
                maybe_serialize($value),
                $key,
                maybe_serialize($expected)
            ));
            if ((int) $updated !== 1) { return false; }
            self::option_cache_forget($key);
            return true;
        }
        // Without a database handle the compare-and-set cannot be atomic.
        // The lock is then left alone rather than risking a double holder.
        return false;
    }

    /**
     * Delete an option only when it still holds the expected value.
     *
     * @param string $key      Option key.
     * @param array  $expected Value the option must still hold.
     * @return bool
     */
    private static function option_delete_cas($key, array $expected) {
        global $wpdb;
        if (isset($wpdb) && is_object($wpdb) && isset($wpdb->options)
            && method_exists($wpdb, 'query') && method_exists($wpdb, 'prepare')
            && function_exists('maybe_serialize')) {
            $deleted = $wpdb->query($wpdb->prepare(
                "DELETE FROM `{$wpdb->options}` WHERE `option_name` = %s AND `option_value` = %s",
                $key,
                maybe_serialize($expected)
            ));
            if ((int) $deleted !== 1) { return false; }
            self::option_cache_forget($key);
            return true;
        }
        $current = get_option($key, null);
        if (!is_array($current) || !self::same_job($current, $expected)) { return false; }
        return (bool) delete_option($key);
    }

    /**
     * Drop the cached copy of one option.
     *
     * A direct write bypasses the option cache, so the cached value and the
     * "notoptions" list have to be cleared by hand.
     *
     * @param string $key Option key.
     */
    private static function option_cache_forget($key) {
        if (!function_exists('wp_cache_delete')) { return; }
        wp_cache_delete($key, 'options');
        if (!function_exists('wp_cache_get') || !function_exists('wp_cache_set')) { return; }
        $notoptions = wp_cache_get('notoptions', 'options');
        if (is_array($notoptions) && isset($notoptions[$key])) {
            unset($notoptions[$key]);
            wp_cache_set('notoptions', $notoptions, 'options');
        }
    }

    private static function scope_hash($scope) {
        return substr(hash('sha256', (string) $scope), 0, 32);
    }

    /* ---------------------------------------------------------- result IO */

    /**
     * Download the generated clip and store it as a Media Library attachment.
     *
     * The attachment is tagged with the job id, so an import that succeeded
     * but whose job row could not be written can still be recovered instead
     * of being downloaded and imported a second time.
     *
     * @param string $download_url Provider download link.
     * @param int    $product_id   Product the clip belongs to.
     * @param string $job_id       Job the clip belongs to.
     * @return array{ok:bool,status:int,attachment_id:int,url:string,message:string}
     */
    public static function store_generated_video($download_url, $product_id, $job_id = '') {
        if (!is_string($download_url) || $download_url === '') {
            return self::store_failure(502, 'The AI provider did not return a download link for the clip.');
        }
        $downloaded = self::download_video($download_url);
        if (!$downloaded['ok']) {
            return self::store_failure($downloaded['status'], $downloaded['message']);
        }
        $path = $downloaded['path'];
        $checked = self::validate_video_file($path);
        if (!$checked['ok']) {
            @unlink($path);
            return self::store_failure(415, $checked['message']);
        }
        $attachment_id = self::sideload($path, $product_id, $job_id);
        @unlink($path);
        if (!$attachment_id) {
            return self::store_failure(500, 'The generated clip could not be added to the Media Library.');
        }
        $url = function_exists('wp_get_attachment_url') ? wp_get_attachment_url($attachment_id) : '';
        return array(
            'ok' => true,
            'status' => 200,
            'attachment_id' => (int) $attachment_id,
            'url' => is_string($url) ? $url : '',
            'message' => '',
        );
    }

    /**
     * The attachment that already holds the clip of one job.
     *
     * This is the recovery path for an import that succeeded but whose job
     * row could not be stored. The existing clip is reused, never deleted
     * and never downloaded a second time.
     *
     * @param string $job_id Job id.
     * @return int Attachment id, or 0 when the job has no clip yet.
     */
    public static function find_attachment_for_job($job_id) {
        $id = self::sanitize_job_id($job_id);
        if ($id === '') { return 0; }
        if (!function_exists('get_posts')) { return 0; }
        $found = get_posts(array(
            'post_type' => 'attachment',
            'post_status' => 'inherit',
            'posts_per_page' => 1,
            'fields' => 'ids',
            'no_found_rows' => true,
            'suppress_filters' => false,
            'meta_key' => self::ATTACHMENT_JOB_META,
            'meta_value' => $id,
        ));
        if (!is_array($found) || !$found) { return 0; }
        return (int) $found[0];
    }

    /** @return array{ok:bool,status:int,attachment_id:int,url:string,message:string} */
    private static function store_failure($status, $message) {
        return array('ok' => false, 'status' => (int) $status, 'attachment_id' => 0, 'url' => '', 'message' => (string) $message);
    }

    /**
     * Fetch the clip over HTTPS.
     *
     * The request is streamed to a temporary file with a hard size ceiling.
     * Redirects are not followed automatically: each hop is validated on its
     * own against the host allowlist before it is requested.
     *
     * @return array{ok:bool,status:int,path:string,message:string}
     */
    public static function download_video($url) {
        if (!self::is_allowed_download_url($url)) {
            return array('ok' => false, 'status' => 502, 'path' => '', 'message' => 'The AI provider returned an address that this server will not download from.');
        }
        if (!function_exists('wp_safe_remote_get')) {
            return array('ok' => false, 'status' => 500, 'path' => '', 'message' => 'This server cannot fetch the generated clip.');
        }
        $temp = function_exists('wp_tempnam') ? wp_tempnam('ppg-wan-video-') : '';
        if (!is_string($temp) || $temp === '') {
            return array('ok' => false, 'status' => 500, 'path' => '', 'message' => 'The generated clip could not be staged on this server.');
        }

        $current = $url;
        $downloaded = false;
        for ($hop = 0; $hop <= self::MAX_REDIRECTS; $hop++) {
            $response = wp_safe_remote_get($current, array(
                'timeout' => 120,
                'redirection' => 0,
                'reject_unsafe_urls' => true,
                'sslverify' => true,
                'stream' => true,
                'filename' => $temp,
                'limit_response_size' => self::MAX_BYTES + 1,
                'ppg_wan_download' => true,
            ));
            if (is_wp_error($response)) {
                @unlink($temp);
                return array('ok' => false, 'status' => 502, 'path' => '', 'message' => 'The generated clip could not be downloaded.');
            }
            $code = (int) wp_remote_retrieve_response_code($response);
            if ($code >= 300 && $code < 400) {
                if ($hop >= self::MAX_REDIRECTS) {
                    @unlink($temp);
                    return array('ok' => false, 'status' => 502, 'path' => '', 'message' => 'The AI provider redirected the clip too many times.');
                }
                $location = (string) wp_remote_retrieve_header($response, 'location');
                if ($location === '' || !self::is_allowed_download_url($location)) {
                    @unlink($temp);
                    return array('ok' => false, 'status' => 502, 'path' => '', 'message' => 'The AI provider redirected the clip to an address this server will not follow.');
                }
                // Each hop is validated on its own before it is requested.
                $current = $location;
                continue;
            }
            if ($code < 200 || $code >= 300) {
                @unlink($temp);
                return array('ok' => false, 'status' => 502, 'path' => '', 'message' => 'The generated clip download failed with HTTP ' . $code . '.');
            }
            $downloaded = true;
            break;
        }
        if (!$downloaded) {
            @unlink($temp);
            return array('ok' => false, 'status' => 502, 'path' => '', 'message' => 'The generated clip download failed.');
        }

        $size = (int) @filesize($temp);
        if ($size <= 0) {
            @unlink($temp);
            return array('ok' => false, 'status' => 502, 'path' => '', 'message' => 'The generated clip download was empty.');
        }
        if ($size > self::MAX_BYTES) {
            @unlink($temp);
            return array('ok' => false, 'status' => 413, 'path' => '', 'message' => 'The generated clip is larger than 25 MB and was rejected.');
        }
        return array('ok' => true, 'status' => 200, 'path' => $temp, 'message' => '');
    }

    /**
     * Container signature, sniffed MIME, real duration and frame size.
     *
     * The metadata is read with the WordPress reader, so the accepted values
     * match what the site itself will report for the attachment.
     *
     * @return array{ok:bool,message:string}
     */
    public static function validate_video_file($path) {
        if (!is_string($path) || $path === '' || !is_file($path)) {
            return array('ok' => false, 'message' => 'The generated clip could not be read.');
        }
        $size = (int) @filesize($path);
        if ($size <= 0) {
            return array('ok' => false, 'message' => 'The generated clip was empty.');
        }
        if ($size > self::MAX_BYTES) {
            return array('ok' => false, 'message' => 'The generated clip is larger than 25 MB and was rejected.');
        }
        $handle = @fopen($path, 'rb');
        if (!$handle) {
            return array('ok' => false, 'message' => 'The generated clip could not be inspected.');
        }
        $head = (string) fread($handle, 16);
        fclose($handle);
        if (strlen($head) < 8 || substr($head, 4, 4) !== 'ftyp') {
            return array('ok' => false, 'message' => 'The generated file is not a valid MP4 video.');
        }
        // The file must really be an MP4. Without a file type reader there
        // is no proof, so the clip is refused rather than trusted.
        $mime = self::sniff_mime($path);
        if ($mime === '') {
            return array('ok' => false, 'message' => 'The generated file type could not be verified.');
        }
        if ($mime !== 'video/mp4') {
            return array('ok' => false, 'message' => 'The generated file was not an MP4 video.');
        }
        $meta = array();
        if (!function_exists('wp_read_video_metadata')) {
            if (defined('ABSPATH') && is_file(ABSPATH . 'wp-admin/includes/media.php')) {
                require_once ABSPATH . 'wp-admin/includes/media.php';
            }
        }
        if (function_exists('wp_read_video_metadata')) {
            $meta = wp_read_video_metadata($path);
        }
        $length = is_array($meta) && isset($meta['length']) ? (float) $meta['length'] : 0.0;
        if (!is_finite($length)) {
            return array('ok' => false, 'message' => 'The generated clip has no readable duration and was rejected.');
        }
        if ($length <= 0) {
            return array('ok' => false, 'message' => 'The generated clip has no readable duration and was rejected.');
        }
        if ($length < self::MIN_DURATION || $length > self::MAX_DURATION) {
            return array('ok' => false, 'message' => 'The generated clip is ' . round($length, 1) . ' seconds long; expected between ' . self::MIN_DURATION . ' and ' . self::MAX_DURATION . ' seconds.');
        }
        $width = is_array($meta) && isset($meta['width']) ? (int) $meta['width'] : 0;
        $height = is_array($meta) && isset($meta['height']) ? (int) $meta['height'] : 0;
        if ($width <= 0 || $height <= 0 || $width > self::MAX_WIDTH || $height > self::MAX_HEIGHT) {
            return array('ok' => false, 'message' => 'The generated clip frame size was not accepted.');
        }
        return array('ok' => true, 'message' => '');
    }

    /**
     * Move a validated file into the Media Library.
     *
     * The extension to MIME map is set for the upload, so the attachment is
     * stored as a video rather than as an unknown binary.
     *
     * @param string $path       Validated file path.
     * @param int    $product_id Product the clip belongs to.
     * @param string $job_id     Job the clip belongs to.
     * @return int Attachment id, or 0 on failure.
     */
    private static function sideload($path, $product_id, $job_id = '') {
        $title = 'Product setup AI clip';
        $post = function_exists('get_post') ? get_post($product_id) : null;
        if ($post && isset($post->post_title)) { $title .= ' - ' . $post->post_title; }
        $file = array(
            'name' => function_exists('sanitize_file_name')
                ? sanitize_file_name('ppg-setup-ai-' . wp_generate_password(12, false, false) . '.mp4')
                : 'ppg-setup-ai.mp4',
            'tmp_name' => $path,
        );
        if (!function_exists('media_handle_sideload')) {
            if (!defined('ABSPATH')) { return 0; }
            // media.php alone does not load the file and image helpers that
            // media_handle_sideload() calls, so all three are required.
            foreach (array('file.php', 'image.php', 'media.php') as $include) {
                if (!is_file(ABSPATH . 'wp-admin/includes/' . $include)) { return 0; }
            }
            require_once ABSPATH . 'wp-admin/includes/file.php';
            require_once ABSPATH . 'wp-admin/includes/image.php';
            require_once ABSPATH . 'wp-admin/includes/media.php';
        }
        add_filter('upload_mimes', array(__CLASS__, 'upload_mimes'));
        $attachment_id = media_handle_sideload($file, $product_id, array('post_title' => $title));
        remove_filter('upload_mimes', array(__CLASS__, 'upload_mimes'));
        if (is_wp_error($attachment_id) || !$attachment_id) {
            return 0;
        }
        $attachment_id = (int) $attachment_id;

        // The stored attachment must really be a video. If WordPress stored
        // it as something else, the import is undone rather than leaving an
        // unknown binary in the library.
        if (function_exists('get_post_mime_type')) {
            $mime = get_post_mime_type($attachment_id);
            if ($mime !== 'video/mp4') {
                if (function_exists('wp_delete_attachment')) {
                    wp_delete_attachment($attachment_id, true);
                }
                return 0;
            }
        }

        // Correlate the attachment with the job, so an import whose job row
        // could not be written can still be recovered.
        $job = self::sanitize_job_id($job_id);
        if ($job !== '' && function_exists('update_post_meta')) {
            update_post_meta($attachment_id, self::ATTACHMENT_JOB_META, $job);
        }
        return $attachment_id;
    }

    /**
     * Keep the MP4 MIME mapping available for the upload.
     *
     * @param array $mimes Allowed mimes.
     * @return array
     */
    public static function upload_mimes($mimes) {
        if (!is_array($mimes)) { $mimes = array(); }
        $mimes['mp4'] = 'video/mp4';
        return $mimes;
    }

    /**
     * Is this download URL allowed to be fetched?
     *
     * Only HTTPS URLs on the Wan delivery suffixes are accepted, and only on
     * the standard HTTPS port. A non-standard port would send the request to
     * a different service than the allowlist describes.
     *
     * @return bool
     */
    public static function is_allowed_download_url($url) {
        if (!is_string($url) || $url === '') { return false; }
        $parts = function_exists('wp_parse_url') ? wp_parse_url($url) : parse_url($url);
        if (!is_array($parts) || !isset($parts['scheme']) || strtolower($parts['scheme']) !== 'https') { return false; }
        if (!isset($parts['host']) || $parts['host'] === '') { return false; }
        if (isset($parts['user']) || isset($parts['pass'])) { return false; }
        if (isset($parts['port']) && (int) $parts['port'] !== 443) { return false; }
        $host = strtolower($parts['host']);
        foreach (self::DOWNLOAD_HOST_SUFFIXES as $suffix) {
            if (substr($host, -strlen($suffix)) === $suffix) { return true; }
        }
        return false;
    }

    /* ------------------------------------------------------------ helpers */

    public static function positive_id($value) {
        if (is_bool($value) || is_float($value) || is_array($value) || is_object($value) || $value === null) {
            return 0;
        }
        if (is_int($value)) { return $value > 0 ? $value : 0; }
        if (!is_string($value)) { return 0; }
        $digits = $value;
        if ($digits === '' || !ctype_digit($digits)) { return 0; }
        // Reject a value that does not fit in a PHP integer.
        $max = (string) PHP_INT_MAX;
        if (strlen($digits) > strlen($max)) { return 0; }
        if (strlen($digits) === strlen($max) && strcmp($digits, $max) > 0) { return 0; }
        $id = (int) $digits;
        return $id > 0 ? $id : 0;
    }

    public static function job_id() {
        return 'job_' . bin2hex(random_bytes(8));
    }

    public static function sanitize_job_id($raw) {
        if (!is_string($raw)) { return ''; }
        return preg_match('/^job_[a-f0-9]{16}$/', $raw) ? $raw : '';
    }
}

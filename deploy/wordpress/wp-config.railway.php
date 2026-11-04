<?php
/** WordPress configuration for isolated Railway staging. */

$railwayRuntimeEnv = is_file(__DIR__ . '/.railway-env.php')
    ? require __DIR__ . '/.railway-env.php'
    : [];

function railway_env(string $name): string|false {
    global $railwayRuntimeEnv;
    $value = getenv($name);
    if (($value === false || $value === '') && isset($railwayRuntimeEnv[$name])) {
        $value = (string) $railwayRuntimeEnv[$name];
    }
    return $value;
}

function railway_required_env(string $name): string {
    $value = railway_env($name);
    if ($value === false || $value === '') {
        throw new RuntimeException("Required environment variable is missing: {$name}");
    }
    return $value;
}

if (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') {
    $_SERVER['HTTPS'] = 'on';
}

define('DB_NAME', railway_required_env('WORDPRESS_DB_NAME'));
define('DB_USER', railway_required_env('WORDPRESS_DB_USER'));
define('DB_PASSWORD', railway_required_env('WORDPRESS_DB_PASSWORD'));
define('DB_HOST', railway_required_env('WORDPRESS_DB_HOST') . ':' . (railway_env('WORDPRESS_DB_PORT') ?: '3306'));
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');
$table_prefix = 'wpjw_';

define('AUTH_KEY',         railway_required_env('WORDPRESS_AUTH_KEY'));
define('SECURE_AUTH_KEY',  railway_required_env('WORDPRESS_SECURE_AUTH_KEY'));
define('LOGGED_IN_KEY',    railway_required_env('WORDPRESS_LOGGED_IN_KEY'));
define('NONCE_KEY',        railway_required_env('WORDPRESS_NONCE_KEY'));
define('AUTH_SALT',        railway_required_env('WORDPRESS_AUTH_SALT'));
define('SECURE_AUTH_SALT', railway_required_env('WORDPRESS_SECURE_AUTH_SALT'));
define('LOGGED_IN_SALT',   railway_required_env('WORDPRESS_LOGGED_IN_SALT'));
define('NONCE_SALT',       railway_required_env('WORDPRESS_NONCE_SALT'));

$publicDomain = railway_env('RAILWAY_PUBLIC_DOMAIN');
$publicUrl = railway_env('WP_HOME') ?: ($publicDomain ? 'https://' . $publicDomain : '');
if ($publicUrl === '') {
    throw new RuntimeException('WP_HOME or RAILWAY_PUBLIC_DOMAIN is required');
}
define('WP_HOME', $publicUrl);
define('WP_SITEURL', railway_env('WP_SITEURL') ?: $publicUrl);

define('WP_CACHE', true);
define('WP_MEMORY_LIMIT', '512M');
define('DISALLOW_FILE_EDIT', true);
define('WP_AUTO_UPDATE_CORE', false);
define('DISABLE_WP_CRON', true);
define('WP_ENVIRONMENT_TYPE', 'staging');
define('WP_HTTP_BLOCK_EXTERNAL', true);
// Download hosts remain additionally gated by the isolation MU plugin's
// private, bounded Wan-media request marker. General outbound HTTP stays blocked.
define('WP_ACCESSIBLE_HOSTS', 'api.wordpress.org,downloads.wordpress.org,*.alicdn.com,*.aliyuncs.com,*.wanxai.com,*.wan.video');
define('FS_METHOD', 'direct');
define('FORCE_SSL_ADMIN', true);

define('WP_DEBUG', false);
define('WP_DEBUG_LOG', false);
define('WP_DEBUG_DISPLAY', false);

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}
require_once ABSPATH . 'wp-settings.php';

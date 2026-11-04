<?php
add_filter('pre_wp_mail', '__return_false', PHP_INT_MAX);
// Only public WordPress.org plugin discovery/downloads may leave staging.
if (wp_get_environment_type() === 'staging') {
    // Local Docker uses a filtered gateway proxy. Railway has isolated public
    // egress and must connect directly because that local gateway does not exist.
    // LSAPI workers read Railway values from wp-config's protected runtime array,
    // so getenv('RAILWAY_ENVIRONMENT_ID') is not reliable inside web requests.
    $railwayPublicDomain = function_exists('railway_env')
        ? railway_env('RAILWAY_PUBLIC_DOMAIN')
        : false;
    if ($railwayPublicDomain === false || $railwayPublicDomain === '') {
        if (!defined('WP_PROXY_HOST')) define('WP_PROXY_HOST', '172.19.0.1');
        if (!defined('WP_PROXY_PORT')) define('WP_PROXY_PORT', 8891);
    }
    if (!defined('WP_ACCESSIBLE_HOSTS')) define('WP_ACCESSIBLE_HOSTS', 'api.wordpress.org,downloads.wordpress.org');
}
// Normal integrations stay blocked. Only the plugin's bounded, safe GET of
// finished Wan media is an exception; credentials are never sent to these URLs.
add_filter('pre_http_request', function($pre, $args, $url) {
    $parts = wp_parse_url($url);
    $wanDownload = wp_get_environment_type() === 'staging'
        && ($args['ppg_wan_download'] ?? false) === true
        && is_array($parts) && ($parts['scheme'] ?? '') === 'https'
        && preg_match('/(?:^|\.)(?:alicdn\.com|aliyuncs\.com|wanxai\.com|wan\.video)$/i', $parts['host'] ?? '')
        && (!isset($parts['port']) || (int) $parts['port'] === 443)
        && !isset($parts['user']) && !isset($parts['pass'])
        && strtoupper($args['method'] ?? 'GET') === 'GET'
        && empty($args['headers'])
        && ($args['reject_unsafe_urls'] ?? false) === true
        && ($args['sslverify'] ?? false) === true
        && ($args['stream'] ?? false) === true
        && (int) ($args['redirection'] ?? -1) === 0
        && (int) ($args['limit_response_size'] ?? 0) > 0
        && (int) ($args['limit_response_size'] ?? 0) <= 26214401
        && function_exists('wp_http_validate_url') && wp_http_validate_url($url);
    if ($wanDownload) { return $pre; }
    if (wp_get_environment_type() === 'staging' && is_array($parts)
        && ($parts['scheme'] ?? '') === 'https'
        && in_array($parts['host'] ?? '', ['api.wordpress.org', 'downloads.wordpress.org'], true)
        && (!isset($parts['port']) || $parts['port'] === 443)
        && !isset($parts['user']) && !isset($parts['pass'])) {
        return $pre;
    }
    return new WP_Error('staging_isolation', 'Outbound HTTP blocked on staging');
}, PHP_INT_MAX, 3);
// Safe-download DNS preflight cannot resolve hosts on the internal Docker network.
// Only these exact HTTPS origins use the gateway, which rejects non-public IPs.
add_filter('http_request_args', function($args, $url) {
    $parts = wp_parse_url($url);
    if (wp_get_environment_type() === 'staging' && is_array($parts)
        && ($parts['scheme'] ?? '') === 'https'
        && in_array($parts['host'] ?? '', ['api.wordpress.org', 'downloads.wordpress.org'], true)
        && (!isset($parts['port']) || $parts['port'] === 443)
        && !isset($parts['user']) && !isset($parts['pass'])) {
        $args['reject_unsafe_urls'] = false;
        $args['sslverify'] = true;
    }
    return $args;
}, PHP_INT_MAX, 2);
add_filter('pre_option_blog_public', '__return_zero');
// A public image CDN cannot fetch this private staging origin.
if (wp_get_environment_type() === 'staging') {
    // This isolated container writes local runtime files; no FTP service exists.
    if (!defined('FS_METHOD')) {
        define('FS_METHOD', 'direct');
    }
    add_filter('jetpack_photon_skip_image', '__return_true', PHP_INT_MAX);
    add_filter('jetpack_photon_override_image_downsize', '__return_true', PHP_INT_MAX);
}
add_filter('woocommerce_available_payment_gateways', '__return_empty_array', PHP_INT_MAX);
add_filter('action_scheduler_allow_async_request_runner', '__return_false', PHP_INT_MAX);
add_action('send_headers', function(){header('X-Robots-Tag: noindex, nofollow');});

<?php
/**
 * Plugin Name: Railway Brizy Media Hydration
 * Description: Hydrates missing Brizy source images from the private staging bucket before Brizy generates crops.
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Read a Railway runtime value without exposing it in logs.
 */
function j5_railway_brizy_env(string $name): string
{
    if (function_exists('railway_env')) {
        $value = railway_env($name);
        if (is_string($value) && $value !== '') {
            return $value;
        }
    }

    $value = getenv($name);
    return is_string($value) ? $value : '';
}

function j5_railway_brizy_aws_encode(string $value): string
{
    return str_replace('%7E', '~', rawurlencode($value));
}

function j5_railway_brizy_aws_path(string $key): string
{
    return implode('/', array_map('j5_railway_brizy_aws_encode', explode('/', $key)));
}

/**
 * Build a short-lived, GET-only URL for an existing object.
 */
function j5_railway_brizy_signed_url(string $key): string
{
    $accessKey = j5_railway_brizy_env('S3_ACCESS_KEY_ID');
    $secretKey = j5_railway_brizy_env('S3_SECRET_ACCESS_KEY');
    $bucket = j5_railway_brizy_env('S3_BUCKET');
    $endpoint = j5_railway_brizy_env('S3_ENDPOINT');
    $region = j5_railway_brizy_env('S3_REGION');

    if ($accessKey === '' || $secretKey === '' || $bucket === '' || $endpoint === '' || $region === '') {
        throw new RuntimeException('Railway media storage is not configured.');
    }

    $endpointHost = parse_url($endpoint, PHP_URL_HOST);
    if (!is_string($endpointHost) || $endpointHost === '') {
        throw new RuntimeException('Railway media endpoint is invalid.');
    }

    $host = $bucket . '.' . $endpointHost;
    $uri = '/' . j5_railway_brizy_aws_path($key);
    $now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
    $amzDate = $now->format('Ymd\THis\Z');
    $dateStamp = $now->format('Ymd');
    $scope = $dateStamp . '/' . $region . '/s3/aws4_request';
    $query = [
        'X-Amz-Algorithm' => 'AWS4-HMAC-SHA256',
        'X-Amz-Credential' => $accessKey . '/' . $scope,
        'X-Amz-Date' => $amzDate,
        'X-Amz-Expires' => '900',
        'X-Amz-SignedHeaders' => 'host',
    ];
    ksort($query);

    $canonicalQuery = http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    $canonicalRequest = "GET\n{$uri}\n{$canonicalQuery}\nhost:{$host}\n\nhost\nUNSIGNED-PAYLOAD";
    $stringToSign = "AWS4-HMAC-SHA256\n{$amzDate}\n{$scope}\n" . hash('sha256', $canonicalRequest);
    $kDate = hash_hmac('sha256', $dateStamp, 'AWS4' . $secretKey, true);
    $kRegion = hash_hmac('sha256', $region, $kDate, true);
    $kService = hash_hmac('sha256', 's3', $kRegion, true);
    $kSigning = hash_hmac('sha256', 'aws4_request', $kService, true);
    $query['X-Amz-Signature'] = hash_hmac('sha256', $stringToSign, $kSigning);

    return 'https://' . $host . $uri . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
}

/**
 * Resolve a Brizy media identifier to an attachment ID.
 */
function j5_railway_brizy_attachment_id(string $uid): int
{
    if (ctype_digit($uid)) {
        $attachmentId = (int) $uid;
        return get_post_type($attachmentId) === 'attachment' ? $attachmentId : 0;
    }

    if (!preg_match('/^wp-[a-f0-9]{32}\.[a-z0-9]+$/i', $uid)) {
        return 0;
    }

    global $wpdb;
    return (int) $wpdb->get_var(
        $wpdb->prepare(
            "SELECT p.ID
             FROM {$wpdb->posts} p
             INNER JOIN {$wpdb->postmeta} pm ON pm.post_id = p.ID
             WHERE p.post_type = 'attachment'
               AND p.post_status = 'inherit'
               AND pm.meta_key = 'brizy_attachment_uid'
               AND pm.meta_value = %s
             ORDER BY p.post_date DESC
             LIMIT 1",
            $uid
        )
    );
}

/**
 * Download one object atomically into the persistent uploads volume.
 */
function j5_railway_brizy_download(string $key, string $target): void
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('PHP cURL is unavailable.');
    }

    $directory = dirname($target);
    if (!wp_mkdir_p($directory)) {
        throw new RuntimeException('Unable to create the Brizy media directory.');
    }

    $lockPath = $target . '.railway.lock';
    $lock = fopen($lockPath, 'c');
    if ($lock === false) {
        throw new RuntimeException('Unable to create the Brizy media lock.');
    }

    try {
        if (!flock($lock, LOCK_EX)) {
            throw new RuntimeException('Unable to lock the Brizy media target.');
        }

        clearstatcache(true, $target);
        if (is_file($target) && filesize($target) > 0) {
            return;
        }

        $temporary = $target . '.railway-part-' . bin2hex(random_bytes(6));
        $output = fopen($temporary, 'xb');
        if ($output === false) {
            throw new RuntimeException('Unable to create a temporary Brizy media file.');
        }

        $curl = curl_init(j5_railway_brizy_signed_url($key));
        if ($curl === false) {
            fclose($output);
            @unlink($temporary);
            throw new RuntimeException('Unable to initialize the Brizy media transfer.');
        }

        curl_setopt_array($curl, [
            CURLOPT_FILE => $output,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_FAILONERROR => true,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT => 'Live Edge Railway Brizy hydration/1.0',
            CURLOPT_MAXFILESIZE_LARGE => 52_428_800,
        ]);

        $ok = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $contentType = (string) curl_getinfo($curl, CURLINFO_CONTENT_TYPE);
        $error = curl_error($curl);
        curl_close($curl);
        fclose($output);

        clearstatcache(true, $temporary);
        $size = is_file($temporary) ? (int) filesize($temporary) : 0;
        $validType = $contentType === ''
            || str_starts_with(strtolower($contentType), 'image/')
            || strtolower($contentType) === 'application/octet-stream';

        if ($ok !== true || $status !== 200 || $size < 1 || $size > 52_428_800 || !$validType) {
            @unlink($temporary);
            throw new RuntimeException(
                sprintf('Brizy media hydration failed (HTTP %d, bytes %d, type %s, transport %s).', $status, $size, $contentType ?: 'unknown', $error ?: 'none')
            );
        }

        if (!rename($temporary, $target)) {
            @unlink($temporary);
            throw new RuntimeException('Unable to publish the hydrated Brizy media file.');
        }

        chmod($target, 0644);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
        @unlink($lockPath);
    }
}

/**
 * Brizy fires this immediately before it resolves and crops the source image.
 */
function j5_railway_brizy_hydrate_source(): void
{
    if (wp_get_environment_type() !== 'staging') {
        return;
    }

    $rawUid = isset($_GET['brizy_media']) ? wp_unslash((string) $_GET['brizy_media']) : '';
    if ($rawUid === '') {
        return;
    }

    $attachmentId = j5_railway_brizy_attachment_id($rawUid);
    if ($attachmentId < 1) {
        return;
    }

    $relative = (string) get_post_meta($attachmentId, '_wp_attached_file', true);
    $relative = ltrim(str_replace('\\', '/', $relative), '/');
    if ($relative === '' || str_contains($relative, "\0") || preg_match('#(^|/)\.\.(/|$)#', $relative)) {
        return;
    }

    $uploads = wp_get_upload_dir();
    $baseDirectory = wp_normalize_path((string) ($uploads['basedir'] ?? ''));
    $target = wp_normalize_path($baseDirectory . '/' . $relative);
    if ($baseDirectory === '' || !str_starts_with($target, rtrim($baseDirectory, '/') . '/')) {
        return;
    }

    clearstatcache(true, $target);
    if (is_file($target) && filesize($target) > 0) {
        return;
    }

    try {
        j5_railway_brizy_download($relative, $target);
    } catch (Throwable $exception) {
        error_log('Railway Brizy media hydration: ' . $exception->getMessage());
    }
}

add_action('brizy_before_extract_img', 'j5_railway_brizy_hydrate_source', -100);

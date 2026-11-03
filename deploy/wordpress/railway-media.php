<?php
declare(strict_types=1);

$railwayRuntimeEnv = is_file(__DIR__ . '/.railway-env.php')
    ? require __DIR__ . '/.railway-env.php'
    : [];

function required_env(string $name): string {
    global $railwayRuntimeEnv;
    $value = getenv($name);
    if (($value === false || $value === '') && isset($railwayRuntimeEnv[$name])) {
        $value = (string) $railwayRuntimeEnv[$name];
    }
    if ($value === false || $value === '') {
        http_response_code(503);
        exit('Media storage is not configured');
    }
    return $value;
}

function aws_encode(string $value): string {
    return str_replace('%7E', '~', rawurlencode($value));
}

function aws_path(string $key): string {
    return implode('/', array_map('aws_encode', explode('/', $key)));
}

$key = ltrim((string)($_GET['key'] ?? ''), '/');
if ($key === '' || str_contains($key, "\0") || preg_match('#(^|/)\.\.(/|$)#', $key)) {
    http_response_code(400);
    exit('Invalid media key');
}

$accessKey = required_env('S3_ACCESS_KEY_ID');
$secretKey = required_env('S3_SECRET_ACCESS_KEY');
$bucket = required_env('S3_BUCKET');
$endpoint = required_env('S3_ENDPOINT');
$region = required_env('S3_REGION');
$endpointHost = parse_url($endpoint, PHP_URL_HOST);
if (!is_string($endpointHost) || $endpointHost === '') {
    http_response_code(503);
    exit('Invalid media endpoint');
}

$host = $bucket . '.' . $endpointHost;
$uri = '/' . aws_path($key);
$now = new DateTimeImmutable('now', new DateTimeZone('UTC'));
$amzDate = $now->format('Ymd\THis\Z');
$dateStamp = $now->format('Ymd');
$scope = $dateStamp . '/' . $region . '/s3/aws4_request';
$query = [
    'X-Amz-Algorithm' => 'AWS4-HMAC-SHA256',
    'X-Amz-Credential' => $accessKey . '/' . $scope,
    'X-Amz-Date' => $amzDate,
    'X-Amz-Expires' => '3600',
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
$url = 'https://' . $host . $uri . '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);

header('Cache-Control: public, max-age=300');
header('Location: ' . $url, true, 302);
exit;

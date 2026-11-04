<?php
define('SHORTINIT', true);
require __DIR__ . '/wp-load.php';
header('Content-Type: application/json');
if (!isset($wpdb) || $wpdb->get_var('SELECT 1') !== '1') {
    http_response_code(503);
    echo json_encode(['ok' => false, 'database' => false]);
    exit;
}
echo json_encode(['ok' => true, 'database' => true]);

<?php
/** Staging-only real-WP options/CAS probe. No CLI/provider/media calls. */
if (home_url() !== 'https://portare.up.railway.app' || wp_get_environment_type() !== 'staging') { throw new RuntimeException('Staging guard failed'); }
if (class_exists('PPG_Wan', false)) { throw new RuntimeException('Use WP-CLI --skip-plugins --skip-themes'); }
require '/tmp/ppg-wan-adapter-qa.php';
$scope = 'qa-' . bin2hex(random_bytes(12));
$prefix = '_ppg_wan_qa_lock_';
$key = $prefix . substr(hash('sha256', $scope), 0, 32);
$checks = array();
$check = static function ($value, $label) use (&$checks) { if (!$value) { throw new RuntimeException($label); } $checks[] = $label; };
try {
    $first = PPG_Wan::acquire_lock($prefix, $scope);
    $check(is_string($first) && strlen($first) === 32, 'real SQL creates owned lock');
    $check(PPG_Wan::acquire_lock($prefix, $scope) === false, 'second holder refused');
    $check(PPG_Wan::release_lock($prefix, $scope, 'foreign-owner') === false, 'foreign owner cannot release');
    $old = get_option($key); $old['at'] = time() - 3600; update_option($key, $old, false);
    $second = PPG_Wan::acquire_lock($prefix, $scope);
    $check(is_string($second) && $second !== $first, 'stale lease reclaimed through SQL CAS');
    $check(PPG_Wan::release_lock($prefix, $scope, $first) === false, 'expired holder cannot release newer lease');
    $check(get_option($key)['owner'] === $second, 'new owner survives stale release');
    $cas = new ReflectionMethod('PPG_Wan', 'option_cas');
    if (PHP_VERSION_ID < 80100) { $cas->setAccessible(true); }
    $check($cas->invoke(null, $key, $old, array('owner'=>'wrong','at'=>time())) === false, 'stale compare value cannot overwrite current row');
    $check(PPG_Wan::release_lock($prefix, $scope, $second) === true, 'current owner releases by SQL compare-delete');
    $check(get_option($key, null) === null, 'exact QA option read back absent');
    echo 'PPG_CAS_RESULT:' . json_encode(array('checks'=>$checks,'provider_calls'=>0)) . PHP_EOL;
} finally {
    delete_option($key);
}

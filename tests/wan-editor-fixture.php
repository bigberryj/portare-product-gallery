<?php
/** Offline browser fixture only. Never installed in WordPress or packaged. */
require __DIR__ . '/../qa/wp-stubs.php';
function get_post_mime_type($id){return 'image/png';}
function wp_strip_all_tags($text,$remove_breaks=false){return strip_tags($text);}
function wp_get_attachment_url($id){return 'https://example.test/'.$id.'.png';}
function wp_create_nonce($action){return 'offline-fixture-nonce';}
function admin_url($path=''){return '/wp-admin/'.$path;}
class PPG_Setup_AI {
 public static function public_config(){return array('enabled'=>true,'provider'=>'Wan','message'=>'','duration'=>5,'maxPrompt'=>500,'minImages'=>2,'maxImages'=>2);}
 public static function ajax_url($action){return '/wp-admin/admin-ajax.php';}
 public static function nonce($id){return 'offline-fixture-nonce';}
}
require __DIR__ . '/../includes/class-ppg-setup.php';
$GLOBALS['meta'][10440]['_ppg_setup']=array('enabled'=>1,'mode'=>'pictures','images'=>array(11,12,13,14));
echo '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/setup.css"><style>body{font:15px system-ui;padding:16px;max-width:950px}.form-field{display:flex;gap:16px;flex-wrap:wrap}label{min-width:180px}.description{max-width:100%}select,textarea{max-width:100%}.ppg-setup-list{list-style:none;padding:0}.ppg-setup-list img{max-width:80px}.fixture-warning{padding:12px;background:#fff1b8}</style></head><body><p class="fixture-warning">OFFLINE FIXTURE — simulated jobs, no Wan calls or credits</p><form id="fixture-product-form"><div id="ppg_product_panel">';
ob_start();PPG_Setup::panel(10440);$panel=ob_get_clean();
echo str_replace('data-ai-enabled="1"','data-ai-enabled="1" data-ai-poll-interval="30"',$panel);
echo '</div></form><script src="/assets/setup-ai-admin.js"></script></body></html>';

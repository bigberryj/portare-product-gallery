<?php
/** Offline staging-egress policy tests; no network or provider calls. */
$filters = array(); $kind='staging'; $safe=true; $checks=0;
function add_filter($name,$callback,$priority=10,$args=1){$GLOBALS['filters'][$name][]=$callback;}
function add_action($name,$callback,$priority=10,$args=1){}
function wp_get_environment_type(){return $GLOBALS['kind'];}
function railway_env($name){return 'portare.up.railway.app';}
function wp_parse_url($url){return parse_url($url);}
function wp_http_validate_url($url){return $GLOBALS['safe'] ? $url : false;}
class WP_Error {public function __construct($code,$message){}}
require __DIR__.'/../deploy/wordpress/000-staging-isolation.php';
$policy=$filters['pre_http_request'][0];
function check($condition,$name){$GLOBALS['checks']++;if(!$condition){fwrite(STDERR,"FAIL: $name\n");exit(1);}}
$args=array('ppg_wan_download'=>true,'method'=>'GET','headers'=>array(),'reject_unsafe_urls'=>true,'sslverify'=>true,'stream'=>true,'redirection'=>0,'limit_response_size'=>26214401);
$url='https://result.example.alicdn.com/video.mp4?signature=fixture';
check($policy(false,$args,$url)===false,'bounded HTTPS finished-media download allowed');
foreach(array('ppg_wan_download','reject_unsafe_urls','sslverify','stream') as $key){$bad=$args;$bad[$key]=false;check($policy(false,$bad,$url) instanceof WP_Error,$key.' required');}
foreach(array('http://result.example.alicdn.com/video.mp4','https://evil.test/video.mp4','https://alicdn.com.evil.test/v.mp4','https://127.0.0.1/video.mp4','https://user:pass@result.example.alicdn.com/v.mp4','https://result.example.alicdn.com:444/v.mp4') as $bad){check($policy(false,$args,$bad) instanceof WP_Error,'reject unsafe URL');}
foreach(array(array('method','POST'),array('redirection',1),array('limit_response_size',26214402),array('limit_response_size',0),array('headers',array('Authorization'=>'fixture'))) as $change){$bad=$args;$bad[$change[0]]=$change[1];check($policy(false,$bad,$url) instanceof WP_Error,'reject unsafe transport settings');}
$safe=false;check($policy(false,$args,$url) instanceof WP_Error,'reject failed core public-IP validation');$safe=true;
check($policy(false,array(),'https://api.wordpress.org/plugins/info/1.2/')===false,'WordPress discovery unchanged');
check($policy(false,array(),'https://downloads.wordpress.org/plugin/example.zip')===false,'WordPress downloads unchanged');
check($policy(false,array(),'https://api.minimax.io/v2/video_generation') instanceof WP_Error,'unrelated providers still blocked');
$kind='production';check($policy(false,$args,$url) instanceof WP_Error,'Wan exception staging only');
echo 'PASS: '.$checks." staging-egress assertions (no network)\n";

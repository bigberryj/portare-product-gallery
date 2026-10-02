<?php
require __DIR__.'/../qa/wp-stubs.php';
require __DIR__.'/../includes/class-ppg.php';
require __DIR__.'/../includes/class-ppg-admin.php';
$count=0;
function test($condition,$label){global $count;$count++;if(!$condition){fwrite(STDERR,"FAIL: $label\n");exit(1);}}
$c=PPG::sanitize_config(null);
test($c===PPG::config_defaults(),'config defaults');
foreach(array(null,array(),new stdClass(),'-1','0','01','1a','1.0','1e2','+1',' 1','1 ','999999999999999999999999') as $bad){test(PPG::id($bad)===0,'reject malformed ID');}
test(PPG::id('10440')===10440,'valid ID');
foreach(array(null,array(),new stdClass(),'yes','true','1garbage',2,-1) as $bad){test(PPG::flag($bad)===0,'strict booleans');}
test(PPG::flag('1')===1,'literal checkbox flag');
$c=PPG::sanitize_config(array('enabled'=>array(1),'placement'=>'<style>','quote_enabled'=>'0','autoplay'=>'1','interval'=>999,'text_side'=>'right','quote_align'=>'center'));
test($c['enabled']===0,'structured flag rejected');test($c['placement']==='auto','placement allowlist');test($c['quote_enabled']===0,'quote off');test($c['interval']===120,'interval maximum');test($c['text_side']==='right','right side');test($c['quote_align']==='center','center quote');
test(PPG::sanitize_config(array('interval'=>-2))['interval']===1,'interval minimum');
test(PPG::sanitize_config(array('interval'=>array(9)))['interval']===5,'structured number default');
$s=PPG::sanitize_settings(array('font'=>'Arial;position:fixed','text_color'=>'red','title_color'=>'#ABCDEF','gap'=>-5,'radius'=>10000,'duration'=>array(2),'text_fade'=>'garbage','transition'=>'evil'));
test($s['font']==='inherit','font allowlist');test($s['text_color']==='#16354b','color rejected');test($s['title_color']==='#abcdef','color canonical');test($s['gap']===0,'gap clamp');test($s['radius']===100,'radius clamp');test($s['duration']===250,'structured duration rejected');test($s['text_fade']===0,'text fade strict');test($s['transition']==='fade','transition allowlist');
test(count(PPG::sanitize_settings('bad'))===count(PPG::setting_specs()),'settings defaults cover every field');
$rows=PPG::sanitize_slides(array('bad',array('id'=>12,'description'=>'<p>Paragraph <strong>bold</strong></p><script>x</script>','x'=>-8,'y'=>200,'zoom'=>500),array('id'=>12),array('id'=>99),array('id'=>'-11'),array('id'=>array(11))));
test(count($rows)===1,'slides validate and dedupe');test($rows[0]['x']===0,'focus minimum');test($rows[0]['y']===100,'focus maximum');test($rows[0]['zoom']===200,'zoom maximum');test(strpos($rows[0]['description'],'<script>')===false,'rich text passes KSES');test(!isset($GLOBALS['kses_allow']['p']['style']),'no style allowlist');test(isset($GLOBALS['kses_allow']['a']['href']),'rich links allowed');test(PPG::sanitize_slides('bad')===array(),'malformed slide structure');
$GLOBALS['meta'][10440]['_ppg_slides']=array(array('id'=>12,'description'=>'Custom'),array('id'=>11,'description'=>'Ignored featured text','x'=>17,'y'=>81,'zoom'=>160));
$rows=PPG::slide_rows(new WC_Product());test(array_column($rows,'id')===array(11,12),'featured initial custom list');
test($rows[0]['x']===17.0 && $rows[0]['y']===81.0 && $rows[0]['zoom']===160.0,'featured framing survives normalization');
$html=PPG::render(10440);test(strpos($html,'class="ppg"')!==false,'render root');test(strpos($html,'&lt;script&gt;')!==false,'title escaped');test(strpos($html,'data-pqb-product="10440"')!==false,'PQB reuse');test(strpos($html,'data-text-side="left"')!==false,'text default');test(strpos($html,'Ignored featured text')===false,'featured description fixed');test(strpos($html,'Full product description')!==false,'full description');test(strpos($html,'class="price"')===false,'no prices');
preg_match('/<script class="ppg-data" type="application\/json">(.*?)<\/script>/s',$html,$match);$data=json_decode($match[1],true);test(count($data['slides'])===2,'JSON slide count');test($data['slides'][0]['description']===$data['defaultDescription'],'featured description fallback');test($data['slides'][1]['description']==='Custom','custom image description');
foreach(array('bad','-10440','10440x',array(10440),'') as $id){test(PPG::shortcode(array('product_id'=>$id))==='','shortcode rejects invalid explicit ID');}
test(PPG::shortcode()!=='','shortcode current product');
$GLOBALS['statuses'][10440]='draft';test(PPG::render(10440)==='','draft inaccessible');$GLOBALS['statuses'][10440]='private';test(PPG::render(10440)==='','private inaccessible');$GLOBALS['statuses'][10440]='publish';$GLOBALS['password']=true;test(PPG::render(10440)==='','password inaccessible');$GLOBALS['password']=false;
reset_state();test(!PPG::should_auto(10440),'automatic disabled default');PPG::auto_hooks();test(!$GLOBALS['removed'],'disabled hooks untouched');
$GLOBALS['meta'][10440]['_ppg_config']=array('enabled'=>1,'placement'=>'shortcode');test(!PPG::should_auto(10440),'shortcode mode no auto');
$GLOBALS['meta'][10440]['_ppg_config']=array('enabled'=>1);PPG::auto_hooks();test(count($GLOBALS['removed'])===4,'only opted in three WC hooks and PQB removed');test($GLOBALS['removed'][3][2]===32,'PQB actual priority');PPG::register_assets();test(count($GLOBALS['enqueued'])===2,'auto assets without render/standard hooks');
reset_state();$GLOBALS['meta'][10440]['_ppg_config']=array('enabled'=>1,'quote_enabled'=>0);PPG::auto_hooks();test(count($GLOBALS['removed'])===4,'automatic quote disabled suppresses original PQB hook');
reset_state();$valid=array('ppg_present'=>'1','ppg_slides_present'=>'1','ppg_nonce'=>'valid','ppg_config'=>array('enabled'=>1,'text_side'=>'right'),'ppg_slides'=>array(array('id'=>12,'description'=>'<p>Row</p>')));
$_POST=$valid;$GLOBALS['cap']=false;PPG_Admin::save(10440);test(!$GLOBALS['meta'],'unauthorized save');$GLOBALS['cap']=true;$_POST['ppg_nonce']='bad';PPG_Admin::save(10440);test(!$GLOBALS['meta'],'invalid nonce');$_POST['ppg_nonce']=array('valid');PPG_Admin::save(10440);test(!$GLOBALS['meta'],'structured nonce rejected');$_POST=$valid;$GLOBALS['revision']=true;PPG_Admin::save(10440);test(!$GLOBALS['meta'],'revision guard');$GLOBALS['revision']=false;$GLOBALS['autosave']=true;PPG_Admin::save(10440);test(!$GLOBALS['meta'],'autosave guard');$GLOBALS['autosave']=false;$GLOBALS['types'][10440]='page';PPG_Admin::save(10440);test(!$GLOBALS['meta'],'nonproduct guard');$GLOBALS['types'][10440]='product';PPG_Admin::save(10440);test($GLOBALS['meta'][10440]['_ppg_config']['enabled']===1,'valid config save');test($GLOBALS['meta'][10440]['_ppg_slides'][0]['id']===12,'valid slides save');test(count($GLOBALS['meta'][10440])===2,'only plugin metadata changed');
$_POST=$valid;$_POST['ppg_config']='bad';$_POST['ppg_slides']='bad';PPG_Admin::save(10440);test($GLOBALS['meta'][10440]['_ppg_slides']===array(),'malformed slides save safe');test($GLOBALS['meta'][10440]['_ppg_config']===PPG::config_defaults(),'malformed config save safe');
PPG_Admin::settings();test($GLOBALS['registered'][1]==='ppg_settings','Settings API option');test($GLOBALS['registered'][2]['sanitize_callback']===array('PPG','sanitize_settings'),'Settings API sanitizer');
$GLOBALS['post']=(object)array('ID'=>10440,'post_type'=>'product');ob_start();PPG_Admin::panel();$panel=ob_get_clean();test(strpos($panel,'ppg_nonce')!==false,'product panel nonce');test(strpos($panel,'ppg_slides[0][description]')!==false,'keyed row descriptions');test(strpos($panel,'ppg-row-template')!==false,'dynamic row template');test(strpos($panel,'ppg-remove')!==false,'association removal UI');
reset_state();$html=PPG::render(10440);test(substr_count($html,'class="ppg-thumb"')===6,'fallback more than four thumbnails');
$GLOBALS['meta'][10440]['_ppg_slides']=array(array('id'=>12,'description'=>'</script><p>Safe</p>'));$html=PPG::render(10440);test(strpos($html,'\\u003C')!==false,'JSON HEX protects script context');
$c=PPG::sanitize_config(array('main_arrows'=>'0','thumb_arrows'=>'1'));test($c['main_arrows']===0 && $c['thumb_arrows']===1,'independent arrow flags');
foreach(array('true',array(1),'garbage') as $bad){test(PPG::sanitize_config(array('main_arrows'=>$bad))['main_arrows']===0,'main arrow flag strict');}
reset_state();$GLOBALS['meta'][10440]['_ppg_config']=array('main_arrows'=>0,'thumb_arrows'=>0);$html=PPG::render(10440);test(strpos($html,'ppg-prev')===false && strpos($html,'ppg-strip-prev')===false,'both arrow sets disabled');test(strpos($html,'ppg-toolbar')===false,'no bottom toolbar');test(strpos($html,'ppg-play')===false,'autoplay off emits no play icon');
$GLOBALS['meta'][10440]['_ppg_config']=array('main_arrows'=>1,'thumb_arrows'=>0,'autoplay'=>1);$html=PPG::render(10440);test(strpos($html,'ppg-prev')!==false && strpos($html,'ppg-strip-prev')===false,'main arrows independent');test(strpos($html,'ppg-icon-pause')!==false,'autoplay has discreet pause SVG');
$GLOBALS['meta'][10440]['_ppg_config']=array('main_arrows'=>0,'thumb_arrows'=>1);$html=PPG::render(10440);test(strpos($html,'ppg-prev')===false && strpos($html,'ppg-strip-prev')!==false,'strip arrows independent');
echo "PASS: $count assertions\n";

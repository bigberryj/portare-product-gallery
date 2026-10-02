<?php
/** Run through WP-CLI on an isolated staging copy. Restores plugin/product state. */
if (!defined('ABSPATH') || wp_get_environment_type() !== 'staging') { throw new RuntimeException('Staging only'); }
$id=10440;
$originalUser=get_current_user_id();
$originalConfig=get_post_meta($id,'_ppg_config',true); $hasConfig=metadata_exists('post',$id,'_ppg_config');
$originalSlides=get_post_meta($id,'_ppg_slides',true); $hasSlides=metadata_exists('post',$id,'_ppg_slides');
$originalSettings=get_option('ppg_settings',null);
$content=get_post_field('post_content',$id); $meta=get_post_meta($id);
$checks=0;
$assert=function($ok,$name)use(&$checks){if(!$ok)throw new RuntimeException('FAIL: '.$name); ++$checks;echo "PASS: $name\n";};
try {
 wp_set_current_user(1);
 $assert(current_user_can('edit_post',$id),'authorized administrator');
 $p=wc_get_product($id); $gallery=$p->get_gallery_image_ids();
 $a=$gallery[0];$b=$gallery[1];
 $_POST=['ppg_present'=>'1','ppg_nonce'=>wp_create_nonce('ppg_save_'.$id),'ppg_slides_present'=>'1','ppg_config'=>['enabled'=>'1','placement'=>'auto','text_side'=>'right','quote_enabled'=>'1','quote_align'=>'center','autoplay'=>'1','interval'=>'3.5'],'ppg_slides'=>[['id'=>$a,'description'=>'<p>First custom paragraph.</p><p>Second paragraph.</p><script>alert(1)</script><a href="javascript:alert(1)">Link</a>','x'=>'20','y'=>'80','zoom'=>'125'],['id'=>$b,'description'=>'<strong>Other photograph.</strong>'],['id'=>$a,'description'=>'duplicate']]];
 PPG_Admin::save($id);
 $c=PPG::config($id);$r=get_post_meta($id,'_ppg_slides',true);
 $assert($c['text_side']==='right'&&$c['quote_align']==='center','per-product right-side and center alignment saved');
 $assert($c['autoplay']===1&&$c['interval']===3.5,'autoplay interval saved');
 $assert(count($r)===2,'attachment IDs deduplicated');
 $assert($r[0]['x']==20&&$r[0]['y']==80&&$r[0]['zoom']==125,'focal settings saved');
 $assert(strpos($r[0]['description'],'<script')===false&&strpos($r[0]['description'],'javascript:')===false,'real WordPress KSES strips script/protocol');
 $assert(substr_count($r[0]['description'],'<p>')===2,'rich paragraphs retained');
 $html=PPG::render($id);
 $assert(strpos($html,'data-text-side="right"')!==false,'render saved text side');
 $assert(strpos($html,'data-interval="3500"')!==false,'render saved speed');
 $assert(strpos($html,'data-pqb-product="10440"')!==false,'existing quote modal button reused');
 $assert(strpos($html,'class="price"')===false,'no price output');
 preg_match('/<script class="ppg-data"[^>]*>(.*?)<\/script>/s',$html,$m);$data=json_decode($m[1],true);
 $assert($data['slides'][0]['id']==$p->get_image_id(),'featured first');
 $assert($data['slides'][0]['description']===PPG::rich(wpautop($p->get_description())),'initial full product description');
 $assert(count($data['slides'])===3,'featured plus custom images');
 $assert(strpos($data['slides'][1]['description'],'First custom')!==false,'custom image description rendered');
 $assert(PPG::shortcode(['product_id'=>'10440junk'])==='','malformed shortcode ID rejected');
 $assert(strpos(do_shortcode('[portare_product_gallery product_id="10440"]'),'data-ppg')!==false,'registered shortcode executes');
 $_POST['ppg_nonce']='invalid'; $_POST['ppg_config']['interval']='20';PPG_Admin::save($id);
 $assert(PPG::config($id)['interval']===3.5,'invalid nonce does not change data');
 wp_set_current_user(0);$_POST['ppg_nonce']=wp_create_nonce('ppg_save_'.$id);PPG_Admin::save($id);
 $assert(PPG::config($id)['interval']===3.5,'unauthorized save does not change data');
 wp_set_current_user(1);$_POST['ppg_nonce']=wp_create_nonce('ppg_save_'.$id);$_POST['ppg_config']['quote_enabled']='0';$_POST['ppg_config']['autoplay']='0';$_POST['ppg_slides']=[$r[1]];PPG_Admin::save($id);
 $assert(count(get_post_meta($id,'_ppg_slides',true))===1,'image removal saves association');
 $assert(get_post($a)->post_type==='attachment'&&wp_attachment_is_image($a),'removed image remains in media library');
 $html=PPG::render($id);
 $assert(strpos($html,'data-pqb-product=')===false&&strpos($html,'data-autoplay="0"')!==false,'quote and autoplay off respected');
 $_POST['ppg_config']['placement']='shortcode';PPG_Admin::save($id);
 $assert(!PPG::should_auto($id),'shortcode-only disables automatic mode');
 $assert(strpos(PPG::render($id),'data-ppg')!==false,'shortcode independent of automatic mode');
 update_option('ppg_settings',PPG::sanitize_settings(['font'=>'serif','text_size'=>18,'transition'=>'slide','load_effect'=>'rise','radius'=>40]));
 $html=PPG::render($id);
 $assert(strpos($html,'--ppg-text-size:18px;')!==false&&strpos($html,'data-transition="slide"')!==false,'appearance settings render');
 $assert(get_post_field('post_content',$id)===$content,'main product description unchanged');
 $afterMeta=get_post_meta($id);
 foreach($meta as $key=>$value)if(stripos($key,'brizy')!==false)$assert(($afterMeta[$key]??null)===$value,'Brizy metadata preserved: '.$key);
 echo "PASS: $checks real WordPress integration assertions\n";
} finally {
 if($hasConfig)update_post_meta($id,'_ppg_config',$originalConfig);else delete_post_meta($id,'_ppg_config');
 if($hasSlides)update_post_meta($id,'_ppg_slides',$originalSlides);else delete_post_meta($id,'_ppg_slides');
 if($originalSettings===null)delete_option('ppg_settings');else update_option('ppg_settings',$originalSettings);
 wp_set_current_user($originalUser);$_POST=[];
}

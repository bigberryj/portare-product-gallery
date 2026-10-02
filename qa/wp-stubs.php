<?php
/* Minimal WP/WC doubles. KSES tests check the allowlist, not WP's implementation. */
define('ABSPATH', __DIR__.'/');
define('PPG_PLUGIN_FILE',dirname(__DIR__).'/portare-product-gallery.php');
define('PPG_VERSION','0.1.1');
function reset_state() { $GLOBALS['meta']=array(); $GLOBALS['options']=array(); $GLOBALS['hooks']=array(); $GLOBALS['removed']=array(); $GLOBALS['enqueued']=array(); $GLOBALS['types']=array(10440=>'product'); $GLOBALS['statuses']=array(10440=>'publish'); $GLOBALS['password']=false; $GLOBALS['cap']=true; $GLOBALS['revision']=false; $GLOBALS['autosave']=false; $GLOBALS['queried']=10440; $GLOBALS['is_product']=true; $_POST=array(); }
reset_state();
function get_post_meta($id,$key,$single=true){return $GLOBALS['meta'][$id][$key]??'';}
function update_post_meta($id,$key,$value){$GLOBALS['meta'][$id][$key]=$value;}
function get_option($key,$default=false){return $GLOBALS['options'][$key]??$default;}
function get_post_type($id){return $GLOBALS['types'][$id]??'attachment';}
function get_post_status($id){return $GLOBALS['statuses'][$id]??'draft';}
function post_password_required($id){return $GLOBALS['password'];}
function wp_attachment_is_image($id){return in_array($id,array(11,12,13,14,15,16),true);}
function wp_kses($html,$allow){$GLOBALS['kses_allow']=$allow; return strip_tags($html,'<'.implode('><',array_keys($allow)).'>');}
function wpautop($s){return '<p>'.$s.'</p>';}
function wp_unslash($v){return is_array($v)?array_map('wp_unslash',$v):(is_string($v)?stripslashes($v):$v);}
function wp_verify_nonce($nonce,$action){return $nonce==='valid' && $action==='ppg_save_10440';}
function wp_is_post_revision($id){return $GLOBALS['revision'];}
function wp_is_post_autosave($id){return $GLOBALS['autosave'];}
function current_user_can($cap,$id=0){return $GLOBALS['cap'];}
function get_the_ID(){return $GLOBALS['queried'];}
function get_queried_object_id(){return $GLOBALS['queried'];}
function is_product(){return $GLOBALS['is_product'];}
function esc_attr($v){return htmlspecialchars((string)$v,ENT_QUOTES,'UTF-8');}
function esc_html($v){return esc_attr($v);}
function esc_textarea($v){return esc_attr($v);}
function esc_url($v){return esc_attr($v);}
function plugins_url($path,$file){return 'https://example.test/plugins/ppg/'.$path;}
function wp_register_style(...$args){}
function wp_register_script(...$args){}
function wp_enqueue_style($handle){$GLOBALS['enqueued'][]=$handle;}
function wp_enqueue_script($handle){$GLOBALS['enqueued'][]=$handle;}
function wp_get_attachment_image_src($id,$size){return array('https://example.test/'.$id.'.jpg',1600,1000);}
function wp_get_attachment_image_srcset($id,$size){return '';}
function wp_get_attachment_image_sizes($id,$size){return '';}
function wp_get_attachment_image($id,$size,$icon=false,$attrs=array()){return '<img src="https://example.test/'.$id.'.jpg" alt="">';}
function wp_json_encode($value,$flags=0){return json_encode($value,$flags);}
function add_action($hook,$cb,$priority=10,$accepted=1){$GLOBALS['hooks'][$hook][$priority][]=array($cb,$accepted);}
function add_filter(...$args){add_action(...$args);}
function add_shortcode($name,$cb){$GLOBALS['shortcodes'][$name]=$cb;}
function remove_action($hook,$cb,$priority=10){$GLOBALS['removed'][]=array($hook,$cb,$priority);}
function has_action($hook,$cb){return $cb===array('PQB','single_button')?32:false;}
function register_setting($group,$name,$args){$GLOBALS['registered']=array($group,$name,$args);}
function add_settings_section(...$args){}
function add_settings_field(...$args){}
function checked($a,$b,$echo=true){$s=$a==$b?'checked="checked"':'';if($echo)echo $s;return $s;}
function selected($a,$b,$echo=true){$s=$a==$b?'selected="selected"':'';if($echo)echo $s;return $s;}
function wp_nonce_field($action,$name){echo '<input name="'.esc_attr($name).'">';}
class WC_Product {
 public function get_id(){return 10440;}
 public function get_image_id(){return 11;}
 public function get_gallery_image_ids(){return array(12,13,14,15,16);}
 public function get_description(){return 'Full product description';}
 public function get_name(){return '<script>alert(1)</script>Kings Table';}
}
function wc_get_product($id){return $id===10440?new WC_Product():false;}
class PQB { public static function button($atts){return '<button class="pqb-open" data-pqb-product="'.(int)$atts['product_id'].'">Request a Quote</button>';}}

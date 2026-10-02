<?php
defined('ABSPATH') || exit;

/** Public static methods deliberately keep storage normalization testable. */
class PPG {
    public static function init() {
        add_shortcode('portare_product_gallery', array(__CLASS__, 'shortcode'));
        add_action('wp', array(__CLASS__, 'auto_hooks'), 99);
        add_action('wp_enqueue_scripts', array(__CLASS__, 'register_assets'));
    }
    public static function config_defaults() {
        return array('enabled'=>0, 'placement'=>'auto', 'text_side'=>'left', 'quote_enabled'=>1, 'quote_align'=>'left', 'autoplay'=>0, 'interval'=>5);
    }
    public static function fonts() {
        return array('inherit'=>'inherit', 'system'=>'system-ui, -apple-system, sans-serif', 'sans'=>'Arial, Helvetica, sans-serif', 'serif'=>'Georgia, Times, serif');
    }
    public static function setting_specs() {
        return array(
            'font'=>array('select','inherit',self::fonts()),
            'copy_width'=>array('number',30,20,60), 'gap'=>array('number',36,0,100),
            'radius'=>array('number',32,0,100), 'thumb_radius'=>array('number',8,0,50), 'thumb_gap'=>array('number',24,0,60),
            'title_size'=>array('number',22,12,80), 'text_size'=>array('number',14,10,40), 'line_height'=>array('number',1.8,1,3),
            'text_color'=>array('color','#16354b'), 'title_color'=>array('color','#111111'), 'accent'=>array('color','#7eaf80'),
            'transition'=>array('select','fade',array('fade'=>'Fade','slide'=>'Slide','none'=>'None')),
            'duration'=>array('number',250,0,2000), 'load_effect'=>array('select','none',array('none'=>'None','fade'=>'Fade','rise'=>'Rise')),
            'ratio'=>array('number',1.64,0.5,3), 'text_fade'=>array('bool',1)
        );
    }
    public static function flag($value) { return in_array($value, array(1,'1',true), true) ? 1 : 0; }
    public static function choice($value, $choices, $default) { return is_string($value) && in_array($value,$choices,true) ? $value : $default; }
    public static function number($value,$default,$min,$max) {
        return is_scalar($value) && is_numeric($value) && is_finite((float)$value) ? max($min,min($max,(float)$value)) : $default;
    }
    public static function id($value) {
        if (!is_int($value) && !is_string($value)) { return 0; }
        $s = (string)$value;
        if (!preg_match('/^[1-9][0-9]*$/D',$s) || strlen($s)>strlen((string)PHP_INT_MAX) || (strlen($s)===strlen((string)PHP_INT_MAX) && strcmp($s,(string)PHP_INT_MAX)>0)) { return 0; }
        return (int)$s;
    }
    public static function sanitize_config($raw) {
        $raw=is_array($raw)?$raw:array(); $out=self::config_defaults();
        foreach (array('enabled','quote_enabled','autoplay') as $key) {
            if (array_key_exists($key,$raw)) { $out[$key]=self::flag($raw[$key]); }
        }
        $out['placement']=self::choice($raw['placement']??null,array('auto','shortcode'),'auto');
        $out['text_side']=self::choice($raw['text_side']??null,array('left','right'),'left');
        $out['quote_align']=self::choice($raw['quote_align']??null,array('left','center','right'),'left');
        $out['interval']=self::number($raw['interval']??null,5,1,120);
        return $out;
    }
    public static function sanitize_settings($raw) {
        $raw=is_array($raw)?$raw:array(); $out=array();
        foreach(self::setting_specs() as $key=>$spec) {
            $v=$raw[$key]??$spec[1];
            if ($spec[0]==='number') { $v=self::number($v,$spec[1],$spec[2],$spec[3]); }
            elseif ($spec[0]==='select') { $v=self::choice($v,array_keys($spec[2]),$spec[1]); }
            elseif ($spec[0]==='bool') { $v=self::flag($v); }
            else { $v=is_string($v) && preg_match('/^#[0-9a-fA-F]{6}$/D',$v)?strtolower($v):$spec[1]; }
            $out[$key]=$v;
        }
        return $out;
    }
    public static function rich($html) {
        return is_string($html) ? wp_kses($html,array('p'=>array(),'br'=>array(),'strong'=>array(),'b'=>array(),'em'=>array(),'i'=>array(),'ul'=>array(),'ol'=>array(),'li'=>array(),'blockquote'=>array(),'h2'=>array(),'h3'=>array(),'h4'=>array(),'a'=>array('href'=>true,'title'=>true),'span'=>array())) : '';
    }
    public static function sanitize_slides($raw) {
        if (!is_array($raw)) { return array(); }
        $out=array(); $seen=array();
        foreach(array_slice($raw,0,100) as $row) {
            if (!is_array($row)) { continue; }
            $id=self::id($row['id']??null);
            if (!$id || isset($seen[$id]) || !wp_attachment_is_image($id)) { continue; }
            $seen[$id]=true;
            $out[]=array('id'=>$id,'description'=>self::rich($row['description']??''),'x'=>self::number($row['x']??null,50,0,100),'y'=>self::number($row['y']??null,50,0,100),'zoom'=>self::number($row['zoom']??null,100,100,200));
        }
        return $out;
    }
    public static function config($id) { return self::sanitize_config(get_post_meta($id,'_ppg_config',true)); }
    public static function public_product($id) {
        $id=self::id($id);
        if (!$id || get_post_type($id)!=='product' || get_post_status($id)!=='publish' || post_password_required($id)) { return false; }
        return wc_get_product($id);
    }
    public static function slide_rows($product) {
        $rows=self::sanitize_slides(get_post_meta($product->get_id(),'_ppg_slides',true));
        if ($rows) {
            // Featured product image is always the initial slide, regardless of row order.
            $featured=self::sanitize_slides(array(array('id'=>$product->get_image_id())));
            foreach ($rows as $row) {
                if ($row['id'] === $product->get_image_id()) { $featured=array($row); break; }
            }
            return self::sanitize_slides(array_merge($featured,$rows));
        }
        $ids=array_merge(array($product->get_image_id()),$product->get_gallery_image_ids());
        return self::sanitize_slides(array_map(static function($id){return array('id'=>$id);},$ids));
    }
    public static function register_assets() {
        wp_register_style('ppg-gallery',plugins_url('assets/gallery.css',PPG_PLUGIN_FILE),array(),PPG_VERSION);
        wp_register_script('ppg-gallery',plugins_url('assets/gallery.js',PPG_PLUGIN_FILE),array(),PPG_VERSION,true);
        // Shortcodes and Brizy modules may render after wp_head. Keep this
        // small, root-scoped stylesheet available before content on all pages.
        wp_enqueue_style('ppg-gallery');
        if (is_product() && self::should_auto(get_queried_object_id())) {
            wp_enqueue_script('ppg-gallery');
        }
    }
    public static function shortcode($atts=array()) {
        $atts=is_array($atts)?$atts:array();
        if (array_key_exists('product_id',$atts)) { $id=self::id($atts['product_id']); }
        else { $id=get_the_ID(); }
        return self::render($id);
    }
    public static function quote_html($id) {
        if (!is_callable(array('PQB','button'))) { return ''; }
        return (string)call_user_func(array('PQB','button'),array('product_id'=>$id));
    }
    public static function render($id) {
        $product=self::public_product($id); if (!$product) { return ''; }
        $config=self::config($id); $settings=self::sanitize_settings(get_option('ppg_settings',array()));
        $description=self::rich(wpautop($product->get_description())); $slides=array();
        foreach(self::slide_rows($product) as $row) {
            $img=wp_get_attachment_image_src($row['id'],'full'); if (!$img) { continue; }
            $row['src']=$img[0]; $row['width']=$img[1]; $row['height']=$img[2];
            $row['srcset']=wp_get_attachment_image_srcset($row['id'],'full')?:'';
            $row['sizes']=wp_get_attachment_image_sizes($row['id'],'full')?:'';
            $alt=get_post_meta($row['id'],'_wp_attachment_image_alt',true);
            $row['alt']=is_string($alt)?$alt:'';
            if ($row['id']===$product->get_image_id() || trim($row['description'])==='') { $row['description']=$description; }
            $slides[]=$row;
        }
        self::register_assets(); wp_enqueue_style('ppg-gallery'); wp_enqueue_script('ppg-gallery');
        $style='';
        $vars=array('copy_width'=>array('copy-width','%'),'gap'=>array('gap','px'),'radius'=>array('radius','px'),'thumb_radius'=>array('thumb-radius','px'),'thumb_gap'=>array('thumb-gap','px'),'title_size'=>array('title-size','px'),'text_size'=>array('text-size','px'),'line_height'=>array('line-height',''),'text_color'=>array('text-color',''),'title_color'=>array('title-color',''),'accent'=>array('accent',''),'duration'=>array('duration','ms'),'ratio'=>array('ratio',''));
        foreach($vars as $key=>$var) { $style.='--ppg-'.$var[0].':'.$settings[$key].$var[1].';'; }
        $style.='--ppg-font:'.self::fonts()[$settings['font']].';';
        $first=$slides[0]??null;
        ob_start(); ?>
<section class="ppg" data-ppg data-product-id="<?php echo esc_attr($id); ?>" data-text-side="<?php echo esc_attr($config['text_side']); ?>" data-autoplay="<?php echo esc_attr($config['autoplay']); ?>" data-interval="<?php echo esc_attr($config['interval']*1000); ?>" data-transition="<?php echo esc_attr($settings['transition']); ?>" data-duration="<?php echo esc_attr($settings['duration']); ?>" data-load-effect="<?php echo esc_attr($settings['load_effect']); ?>" data-text-fade="<?php echo esc_attr($settings['text_fade']); ?>" style="<?php echo esc_attr($style); ?>">
 <div class="ppg-copy"><h2 class="ppg-title"><?php echo esc_html($product->get_name()); ?></h2><div class="ppg-description"><?php echo $first ? $first['description'] : $description; ?></div>
 <?php if($config['quote_enabled']) { ?><div class="ppg-quote" data-align="<?php echo esc_attr($config['quote_align']); ?>"><?php echo self::quote_html($id); ?></div><?php } ?></div>
 <div class="ppg-media"><div class="ppg-stage"><?php if($first) { ?><img class="ppg-main-image" src="<?php echo esc_url($first['src']); ?>" srcset="<?php echo esc_attr($first['srcset']); ?>" sizes="<?php echo esc_attr($first['sizes']); ?>" width="<?php echo esc_attr($first['width']); ?>" height="<?php echo esc_attr($first['height']); ?>" alt="<?php echo esc_attr($first['alt']); ?>" style="object-position:<?php echo esc_attr($first['x'].'% '.$first['y'].'%'); ?>;transform:scale(<?php echo esc_attr($first['zoom']/100); ?>)"><?php } else { ?><p>No product images available.</p><?php } ?></div>
 <div class="ppg-toolbar"<?php if(count($slides)<2) { echo ' hidden'; } ?>><button type="button" class="ppg-prev" aria-label="Previous image">Previous</button><button type="button" class="ppg-play" aria-label="Play slideshow" aria-pressed="false">Play</button><button type="button" class="ppg-next" aria-label="Next image">Next</button></div>
 <div class="ppg-thumbnails" aria-label="Product images"><?php foreach($slides as $index=>$slide) { ?><button type="button" class="ppg-thumb" data-index="<?php echo esc_attr($index); ?>" aria-pressed="<?php echo $index===0?'true':'false'; ?>" aria-label="<?php echo esc_attr('View image '.($index+1)); ?>"><?php echo wp_get_attachment_image($slide['id'],'thumbnail',false,array('alt'=>$slide['alt'],'loading'=>'lazy')); ?></button><?php } ?></div></div>
 <p class="ppg-status" role="status" aria-live="polite"></p><p class="ppg-error" role="alert" hidden>Unable to load this image.</p>
 <script class="ppg-data" type="application/json"><?php echo wp_json_encode(array('slides'=>$slides,'defaultDescription'=>$description),JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT); ?></script>
</section>
<?php return ob_get_clean();
    }
    public static function should_auto($id) {
        $c=self::config($id); return $c['enabled'] && $c['placement']==='auto' && (bool)self::public_product($id);
    }
    public static function auto_hooks() {
        if (!is_product() || !self::should_auto(get_queried_object_id())) { return; }
        // Brizy's embedded WC block must remain untouched; the runtime bridge
        // enhances its introductory row instead, retaining authored content.
        if (class_exists('PPG_Brizy') && PPG_Brizy::active()) { return; }
        remove_action('woocommerce_before_single_product_summary','woocommerce_show_product_images',20);
        remove_action('woocommerce_single_product_summary','woocommerce_template_single_title',5);
        remove_action('woocommerce_single_product_summary','woocommerce_template_single_excerpt',20);
        if (is_callable(array('PQB','button'))) {
            $priority=has_action('woocommerce_single_product_summary',array('PQB','single_button'));
            if ($priority!==false) { remove_action('woocommerce_single_product_summary',array('PQB','single_button'),$priority); }
        }
        add_action('woocommerce_before_single_product_summary',array(__CLASS__,'auto_render'),20);
    }
    public static function auto_render() { echo self::render(get_queried_object_id()); }
}

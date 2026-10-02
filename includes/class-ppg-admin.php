<?php
defined('ABSPATH') || exit;
class PPG_Admin {
    public static function init() {
        add_filter('woocommerce_product_data_tabs',array(__CLASS__,'tab'));
        add_action('woocommerce_product_data_panels',array(__CLASS__,'panel'));
        add_action('woocommerce_process_product_meta',array(__CLASS__,'save'));
        add_action('admin_enqueue_scripts',array(__CLASS__,'assets'));
        add_action('admin_menu',array(__CLASS__,'menu'));
        add_action('admin_init',array(__CLASS__,'settings'));
    }
    public static function tab($tabs) { $tabs['ppg']=array('label'=>'Portare Gallery','target'=>'ppg_product_panel','class'=>array(),'priority'=>80); return $tabs; }
    public static function assets($hook) {
        $screen=get_current_screen();
        if (!$screen || $screen->post_type!=='product' || !in_array($hook,array('post.php','post-new.php'),true)) { return; }
        wp_enqueue_media(); wp_enqueue_editor();
        wp_enqueue_script('ppg-admin',plugins_url('assets/admin.js',PPG_PLUGIN_FILE),array('jquery','jquery-ui-sortable','editor'),PPG_VERSION,true);
        wp_enqueue_style('ppg-admin',plugins_url('assets/admin.css',PPG_PLUGIN_FILE),array(),PPG_VERSION);
    }
    public static function select($name,$value,$choices) {
        echo '<select name="'.esc_attr($name).'">';
        foreach($choices as $key=>$label) { echo '<option value="'.esc_attr($key).'" '.selected($value,$key,false).'>'.esc_html($label).'</option>'; }
        echo '</select>';
    }
    public static function panel() {
        global $post;
        if (!$post || $post->post_type!=='product') { return; }
        $c=PPG::config($post->ID); $product=wc_get_product($post->ID);
        $rows=$product?PPG::slide_rows($product):array();
        echo '<div id="ppg_product_panel" class="panel woocommerce_options_panel hidden"><div class="options_group">';
        wp_nonce_field('ppg_save_'.$post->ID,'ppg_nonce');
        echo '<input type="hidden" name="ppg_present" value="1">';
        foreach(array('enabled'=>'Enable automatic gallery (shortcodes always work)','quote_enabled'=>'Show existing Quote Builder button','autoplay'=>'Automatically rotate images') as $key=>$label) {
            echo '<p class="form-field"><label for="ppg_'.$key.'">'.esc_html($label).'</label><input type="hidden" name="ppg_config['.esc_attr($key).']" value="0"><input type="checkbox" id="ppg_'.esc_attr($key).'" name="ppg_config['.esc_attr($key).']" value="1" '.checked($c[$key],1,false).'></p>';
        }
        foreach(array('placement'=>array('auto'=>'Automatic (WooCommerce / supported Brizy layout)','shortcode'=>'Shortcode only'),'text_side'=>array('left'=>'Text left','right'=>'Text right'),'quote_align'=>array('left'=>'Left','center'=>'Center','right'=>'Right')) as $key=>$choices) {
            echo '<p class="form-field"><label>'.esc_html(ucwords(str_replace('_',' ',$key))).'</label>'; self::select('ppg_config['.$key.']',$c[$key],$choices); echo '</p>';
        }
        echo '<p class="form-field"><label for="ppg_interval">Autoplay interval (seconds)</label><input type="number" id="ppg_interval" name="ppg_config[interval]" min="1" max="120" step="0.1" value="'.esc_attr($c['interval']).'"></p></div>';
        echo '<div class="ppg-admin-gallery"><p>Drag rows or use Up/Down. Add images appends without duplicates; Remove only removes this gallery association, never the media file. The featured image always uses the full product description; blank descriptions use the same fallback. Removing all custom rows restores the WooCommerce featured + gallery fallback.</p><input type="hidden" name="ppg_slides_present" value="1"><button type="button" class="button ppg-add-images">Add images</button><ol class="ppg-admin-rows">';
        foreach($rows as $i=>$row) { self::row($i,$row,$product?$product->get_image_id():0); }
        echo '</ol><template id="ppg-row-template">'; self::row('__INDEX__',array('id'=>0,'description'=>'','x'=>50,'y'=>50,'zoom'=>100),0); echo '</template></div></div>';
    }
    public static function row($index,$row,$featured) {
        $prefix='ppg_slides['.$index.']';
        echo '<li class="ppg-admin-row" data-id="'.esc_attr($row['id']).'"><div class="ppg-row-heading"><span class="ppg-drag" tabindex="0" aria-label="Drag image to reorder">↕</span><span class="ppg-preview">';
        if($row['id']) { echo wp_get_attachment_image($row['id'],'thumbnail'); }
        echo '</span><span class="ppg-image-label">Image #'.esc_html($row['id']).'</span> <button type="button" class="button ppg-up">Up</button> <button type="button" class="button ppg-down">Down</button> <button type="button" class="button ppg-remove">Remove</button></div><input class="ppg-image-id" type="hidden" name="'.esc_attr($prefix.'[id]').'" value="'.esc_attr($row['id']).'">';
        echo '<label>Image description (rich paragraphs)</label><textarea class="ppg-rich" id="ppg_description_'.esc_attr($index).'" name="'.esc_attr($prefix.'[description]').'" rows="6">'.esc_textarea($row['description']).'</textarea>';
        if ($row['id'] && $row['id']===$featured) { echo '<p class="description">Featured image: the product description takes precedence over this field.</p>'; }
        foreach(array('x'=>array('Horizontal focus (%)',0,100),'y'=>array('Vertical focus (%)',0,100),'zoom'=>array('Zoom (%)',100,200)) as $key=>$spec) {
            echo '<label class="ppg-framing">'.esc_html($spec[0]).' <input type="number" min="'.esc_attr($spec[1]).'" max="'.esc_attr($spec[2]).'" name="'.esc_attr($prefix.'['.$key.']').'" value="'.esc_attr($row[$key]).'"></label>';
        }
        echo '</li>';
    }
    public static function save($id) {
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) { return; }
        if (wp_is_post_revision($id) || wp_is_post_autosave($id) || get_post_type($id)!=='product' || !current_user_can('edit_post',$id)) { return; }
        if (!isset($_POST['ppg_present'],$_POST['ppg_nonce']) || !is_string($_POST['ppg_nonce']) || !wp_verify_nonce(wp_unslash($_POST['ppg_nonce']),'ppg_save_'.$id)) { return; }
        update_post_meta($id,'_ppg_config',PPG::sanitize_config(wp_unslash($_POST['ppg_config']??array())));
        if (isset($_POST['ppg_slides_present'])) { update_post_meta($id,'_ppg_slides',PPG::sanitize_slides(wp_unslash($_POST['ppg_slides']??array()))); }
    }
    public static function menu() { add_options_page('Portare Product Gallery','Portare Gallery','manage_options','portare-product-gallery',array(__CLASS__,'page')); }
    public static function settings() {
        register_setting('ppg_settings_group','ppg_settings',array('type'=>'array','sanitize_callback'=>array('PPG','sanitize_settings'),'default'=>PPG::sanitize_settings(array())));
        add_settings_section('ppg_appearance','Typography, appearance and motion','__return_false','portare-product-gallery');
        foreach(PPG::setting_specs() as $key=>$spec) {
            add_settings_field('ppg_'.$key,ucwords(str_replace('_',' ',$key)),array(__CLASS__,'field'),'portare-product-gallery','ppg_appearance',array('key'=>$key,'spec'=>$spec));
        }
    }
    public static function field($args) {
        $s=PPG::sanitize_settings(get_option('ppg_settings',array())); $key=$args['key']; $spec=$args['spec']; $name='ppg_settings['.$key.']';
        if ($spec[0]==='select') { self::select($name,$s[$key],$spec[2]); }
        elseif ($spec[0]==='bool') { echo '<input type="hidden" name="'.esc_attr($name).'" value="0"><input type="checkbox" name="'.esc_attr($name).'" value="1" '.checked($s[$key],1,false).'>'; }
        else { echo '<input type="'.($spec[0]==='color'?'color':'number').'" name="'.esc_attr($name).'" value="'.esc_attr($s[$key]).'"'; if($spec[0]==='number') { echo ' min="'.esc_attr($spec[2]).'" max="'.esc_attr($spec[3]).'" step="0.01"'; } echo '>'; }
    }
    public static function page() {
        if (!current_user_can('manage_options')) { return; }
        echo '<div class="wrap"><h1>Portare Product Gallery</h1><p>Typography uses fixed local font stacks; no arbitrary CSS or remote fonts. Settings apply only to Portare galleries.</p><form action="options.php" method="post">';
        settings_fields('ppg_settings_group'); do_settings_sections('portare-product-gallery'); submit_button(); echo '</form></div>';
    }
}

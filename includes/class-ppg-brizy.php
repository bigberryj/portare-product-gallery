<?php
/** Runtime-only bridge: no writes to Brizy content, metadata or compiled assets. */
defined('ABSPATH') || exit;
final class PPG_Brizy {
    public static function active() {
        if (is_admin() || !is_product()) { return false; }
        if (is_callable(array('Brizy_Public_Main', 'is_editing')) && Brizy_Public_Main::is_editing()) { return false; }
        return is_callable(array('Brizy_Admin_Templates', 'getTemplate')) && (bool) Brizy_Admin_Templates::getTemplate();
    }
    public static function init() {
        add_action('wp_enqueue_scripts', array(__CLASS__, 'assets'), 30);
        add_action('wp_footer', array(__CLASS__, 'source'), 15);
    }
    public static function assets() {
        if (!self::active() || !PPG::should_auto(get_queried_object_id())) { return; }
        wp_enqueue_script('ppg-brizy', plugins_url('assets/brizy-bridge.js', PPG_PLUGIN_FILE), array('ppg-gallery'), PPG_VERSION, true);
    }
    public static function source() {
        if (!self::active() || !PPG::should_auto(get_queried_object_id())) { return; }
        echo '<template data-ppg-brizy>' . PPG::render(get_queried_object_id()) . '</template>';
    }
}

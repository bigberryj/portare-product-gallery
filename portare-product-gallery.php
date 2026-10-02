<?php
/**
 * Plugin Name: Portare Product Gallery
 * Description: Opt-in, description-led WooCommerce product galleries.
 * Version: 0.1.0
 * Requires at least: 6.5
 * Requires PHP: 7.4
 * Requires Plugins: woocommerce
 * License: MIT
 * Text Domain: portare-product-gallery
 */
defined('ABSPATH') || exit;
define('PPG_VERSION', '0.1.0');
define('PPG_PLUGIN_FILE', __FILE__);
define('PPG_PLUGIN_DIR', plugin_dir_path(__FILE__));
require_once PPG_PLUGIN_DIR . 'includes/class-ppg.php';
require_once PPG_PLUGIN_DIR . 'includes/class-ppg-admin.php';
require_once PPG_PLUGIN_DIR . 'includes/class-ppg-brizy.php';
add_action('plugins_loaded', static function () {
    if (!function_exists('wc_get_product')) { return; }
    PPG::init();
    PPG_Admin::init();
    PPG_Brizy::init();
});

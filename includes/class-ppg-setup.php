<?php
/**
 * Product setup media.
 *
 * Per-product setup pictures, a fixed 15 second image sequence and an uploaded
 * setup video, stored in the isolated `_ppg_setup` product meta key and
 * rendered below the product description, outside the main gallery and its
 * thumbnail filmstrip.
 *
 * Scope notes:
 * - The sequence presents existing illustrations. It never synthesises folding
 *   motion and is never labelled as mechanical simulation.
 * - No external service, paid API or remote media fetch is used.
 * - Uploads are accepted as MP4 only, are size/duration/dimension checked and
 *   are stored as ordinary public product media through core media handling.
 */
defined('ABSPATH') || exit;

class PPG_Setup {
    const META_KEY = '_ppg_setup';
    const DURATION_MS = 15000;
    const MAX_IMAGES = 4;
    const MIN_SEQUENCE_IMAGES = 2;
    const MAX_UPLOAD_BYTES = 26214400; // 25 MB.
    const RATE_LIMIT_SECONDS = 60;
    const MAX_SUBMITTED_IDS = 100;

    const MODES = array('pictures', 'sequence', 'video');
    /** Raster illustrations only. SVG is deliberately excluded. */
    const IMAGE_MIMES = array('image/jpeg', 'image/png', 'image/gif', 'image/webp');
    const VIDEO_MIMES = array('video/mp4', 'video/webm');

    public static function init() {
        add_action('wp_ajax_ppg_setup_upload', array(__CLASS__, 'ajax_upload'));
        // Priority 20 keeps this save after the core product meta write.
        add_action('woocommerce_process_product_meta', array(__CLASS__, 'save'), 20);
        add_action('admin_enqueue_scripts', array(__CLASS__, 'assets'));
        add_action('wp_enqueue_scripts', array(__CLASS__, 'register_assets'));
    }

    /* ---------------------------------------------------------------- read */

    /** Normalized setup configuration for a product. */
    public static function config($id) {
        $id = self::positive_id($id);
        if (!$id) { return self::defaults(); }
        return self::sanitize(get_post_meta($id, self::META_KEY, true));
    }

    /** Storage defaults: disabled, static pictures, no illustration replacement. */
    public static function defaults() {
        return array(
            'enabled' => 0,
            'mode' => 'pictures',
            'images' => array(),
            'heading' => '',
            'caption' => '',
            'motion' => 0,
            'video_id' => 0,
            'poster_id' => 0,
            'replace_illustrations' => 0,
        );
    }

    /**
     * Normalize submitted or stored setup values.
     *
     * Unknown keys are discarded, attachment references must resolve to real
     * local attachments of an allowlisted MIME type, and free text is reduced
     * to plain text with a hard length bound.
     */
    public static function sanitize($raw) {
        $raw = is_array($raw) ? $raw : array();
        $out = self::defaults();
        if (array_key_exists('enabled', $raw)) { $out['enabled'] = self::flag($raw['enabled']); }
        $out['mode'] = self::choice($raw['mode'] ?? null, self::MODES, 'pictures');
        $out['images'] = self::valid_images(self::candidate_ids($raw['images'] ?? null));
        $out['heading'] = self::text($raw['heading'] ?? '', 120);
        $out['caption'] = self::text($raw['caption'] ?? '', 500);
        if (array_key_exists('motion', $raw)) { $out['motion'] = self::flag($raw['motion']); }
        $out['video_id'] = self::valid_video_id($raw['video_id'] ?? null);
        $out['poster_id'] = self::valid_image_id($raw['poster_id'] ?? null);
        if (array_key_exists('replace_illustrations', $raw)) { $out['replace_illustrations'] = self::flag($raw['replace_illustrations']); }
        return $out;
    }

    /* -------------------------------------------------------------- render */

    /**
     * Public setup media markup for a product.
     *
     * Returns an empty string when the setup area is disabled, when the
     * product is not publicly viewable, or when there is nothing to show.
     */
    public static function render($id) {
        $id = self::positive_id($id);
        if (!$id || !self::is_public_product($id)) { return ''; }
        $raw = get_post_meta($id, self::META_KEY, true);
        $config = self::sanitize($raw);
        if (!$config['enabled']) { return ''; }

        $media = self::resolve($raw);
        $mode = $config['mode'];
        $errors = array();

        if ($mode === 'pictures' || $mode === 'sequence') {
            if ($media['missing_images']) {
                $errors[] = 'Some selected setup images are no longer available.';
            }
            if ($mode === 'sequence' && count($media['images']) < self::MIN_SEQUENCE_IMAGES) {
                $errors[] = 'A setup sequence needs at least two available images.';
            }
        }
        if ($mode === 'video' && $media['video_missing']) {
            $errors[] = 'The selected setup video is no longer available.';
        }
        if ($mode === 'video' && !$media['video'] && !$media['video_missing']) {
            $errors[] = 'The setup video is not available yet.';
        }

        $playable = false;
        if ($mode === 'pictures') { $playable = (bool) $media['images']; }
        elseif ($mode === 'sequence') { $playable = count($media['images']) >= self::MIN_SEQUENCE_IMAGES; }
        elseif ($mode === 'video') { $playable = (bool) $media['video']; }

        $has_content = $playable || $config['heading'] !== '' || $config['caption'] !== '' || (bool) $errors;
        if (!$has_content) { return ''; }

        // The authored setup illustrations are only replaced after an explicit
        // opt-in and only while real media is actually playable.
        $replace = $config['replace_illustrations'] && $playable;

        self::register_assets();
        wp_enqueue_style('ppg-setup');
        wp_enqueue_script('ppg-setup');

        $payload = array(
            'mode' => $mode,
            'images' => $media['images'],
            'motion' => $config['motion'],
            'duration' => self::DURATION_MS,
            'productId' => $id,
        );

        ob_start(); ?>
<section class="ppg-setup" data-ppg-setup="1" data-mode="<?php echo esc_attr($mode); ?>" data-product-id="<?php echo esc_attr($id); ?>" data-motion="<?php echo esc_attr($config['motion']); ?>"<?php echo $replace ? ' data-replace-illustrations="1"' : ''; ?>>
 <?php if ($config['heading'] !== '') { ?><h3 class="ppg-setup-heading"><?php echo esc_html($config['heading']); ?></h3><?php } ?>
 <?php if ($mode === 'pictures' && $media['images']) { ?><div class="ppg-setup-pictures"><?php foreach ($media['images'] as $image) { ?><img class="ppg-setup-picture" src="<?php echo esc_url($image['src']); ?>" alt="<?php echo esc_attr($image['alt']); ?>" loading="lazy" decoding="async" style="object-fit:contain"><?php } ?></div><?php } ?>
 <?php if ($mode === 'sequence' && count($media['images']) >= self::MIN_SEQUENCE_IMAGES) { ?><div class="ppg-setup-stage"><?php foreach ($media['images'] as $index => $image) { ?><img class="ppg-setup-frame" data-index="<?php echo esc_attr($index); ?>" src="<?php echo esc_url($image['src']); ?>" alt="<?php echo esc_attr($image['alt']); ?>" style="object-fit:contain"><?php } ?><button type="button" class="ppg-setup-play" aria-label="Play setup sequence" aria-pressed="false">&#9654;</button></div><?php } ?>
 <?php if ($mode === 'video' && $media['video']) { ?><video class="ppg-setup-video" controls playsinline preload="metadata" src="<?php echo esc_url($media['video']['url']); ?>"<?php echo $media['poster'] ? ' poster="' . esc_url($media['poster']) . '"' : '' ?> style="object-fit:contain"></video><?php } ?>
 <?php foreach ($errors as $error) { ?><p class="ppg-setup-note ppg-setup-error" role="alert"><?php echo esc_html($error); ?></p><?php } ?>
 <?php if ($config['caption'] !== '') { ?><p class="ppg-setup-caption"><?php echo esc_html($config['caption']); ?></p><?php } ?>
 <script class="ppg-setup-data" type="application/json"><?php echo wp_json_encode($payload, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT); ?></script>
</section>
<?php return ob_get_clean();
    }

    /* ---------------------------------------------------------------- admin */

    /**
     * Product data panel for the setup media area.
     *
     * Every control is a non-submitting button or a plain input; saving happens
     * with the regular product Update submission.
     */
    public static function panel($id) {
        $id = self::positive_id($id);
        if (!$id) { return; }
        $config = self::config($id);
        $video_id = $config['video_id'];
        $poster_id = $config['poster_id'];
        $video_url = $video_id ? self::attachment_url($video_id) : '';
        $poster_url = $poster_id ? self::image_url($poster_id) : '';
        ?>
 <div class="ppg-setup-admin" data-product-id="<?php echo esc_attr($id); ?>" data-upload-url="<?php echo esc_url(self::ajax_url()); ?>" data-upload-nonce="<?php echo esc_attr(self::export_nonce($id)); ?>">
  <h3 class="ppg-setup-admin-title">Product setup media</h3>
  <p class="description ppg-setup-admin-intro">Show up to four setup illustrations below the product description. The animated option is a 15 second image presentation of your own pictures, not a simulation of how the product folds or moves. Exporting a video runs in your browser and needs a browser with MP4 recording support; keep this tab in the foreground while it encodes. A saved video stays in the Media Library and is not published on the product until you press Update. Existing Brizy illustrations are preserved by default. Optional replacement is limited to supported automatic layouts; separate sections outside manually placed shortcodes are never removed.</p>
  <?php wp_nonce_field('ppg_setup_save_' . $id, 'ppg_setup_nonce'); ?>
  <input type="hidden" name="ppg_setup_present" value="1">
  <p class="form-field"><label for="ppg_setup_enabled"><?php echo esc_html('Show the product setup media area'); ?></label><input type="hidden" name="ppg_setup[enabled]" value="0"><input type="checkbox" id="ppg_setup_enabled" name="ppg_setup[enabled]" value="1" <?php echo checked($config['enabled'], 1, false); ?>></p>
  <p class="form-field"><label for="ppg_setup_mode"><?php echo esc_html('Media mode'); ?></label><select id="ppg_setup_mode" name="ppg_setup[mode]">
   <?php foreach (array('pictures' => 'Static setup pictures', 'sequence' => 'Animated image sequence (15 seconds)', 'video' => 'Uploaded setup video') as $value => $label) { ?><option value="<?php echo esc_attr($value); ?>" <?php echo selected($config['mode'], $value, false); ?>><?php echo esc_html($label); ?></option><?php } ?>
  </select></p>
  <p class="form-field"><label for="ppg_setup_heading"><?php echo esc_html('Heading'); ?></label><input type="text" id="ppg_setup_heading" name="ppg_setup[heading]" maxlength="120" value="<?php echo esc_attr($config['heading']); ?>"></p>
  <p class="form-field"><label for="ppg_setup_caption"><?php echo esc_html('Caption'); ?></label><textarea id="ppg_setup_caption" name="ppg_setup[caption]" maxlength="500" rows="3"><?php echo esc_textarea($config['caption']); ?></textarea></p>
  <p class="form-field"><label for="ppg_setup_motion"><?php echo esc_html('Gentle pan and zoom during the sequence'); ?></label><input type="hidden" name="ppg_setup[motion]" value="0"><input type="checkbox" id="ppg_setup_motion" name="ppg_setup[motion]" value="1" <?php echo checked($config['motion'], 1, false); ?>></p>
  <div class="ppg-setup-images">
   <p class="form-field"><label><?php echo esc_html('Setup images'); ?></label><button type="button" class="button ppg-setup-add-images"><?php echo esc_html('Add images'); ?></button></p>
   <ol class="ppg-setup-list">
    <?php foreach ($config['images'] as $image_id) {
        $src = self::image_url($image_id);
        $alt = self::attachment_alt($image_id);
        echo '<li class="ppg-setup-image" data-id="' . esc_attr($image_id) . '" data-src="' . esc_url($src) . '" data-alt="' . esc_attr($alt) . '">';
        echo wp_get_attachment_image($image_id, 'thumbnail', false, array('alt' => $alt, 'class' => 'ppg-setup-thumb'));
        echo '<span class="ppg-setup-image-label">' . esc_html('Image #' . $image_id) . '</span>';
        echo '<input type="hidden" name="ppg_setup[images][]" value="' . esc_attr($image_id) . '">';
        echo '<button type="button" class="button ppg-setup-image-up">' . esc_html('Up') . '</button>';
        echo '<button type="button" class="button ppg-setup-image-down">' . esc_html('Down') . '</button>';
        echo '<button type="button" class="button ppg-setup-image-remove">' . esc_html('Remove') . '</button>';
        echo '</li>';
    } ?>
   </ol>
   <template id="ppg-setup-image-template"><li class="ppg-setup-image" data-id="0" data-src="" data-alt=""><img class="ppg-setup-thumb" src="" alt="" hidden><span class="ppg-setup-image-label"></span><input type="hidden" name="ppg_setup[images][]" value="0"><button type="button" class="button ppg-setup-image-up"><?php echo esc_html('Up'); ?></button><button type="button" class="button ppg-setup-image-down"><?php echo esc_html('Down'); ?></button><button type="button" class="button ppg-setup-image-remove"><?php echo esc_html('Remove'); ?></button></li></template>
  </div>
  <div class="ppg-setup-media">
   <p class="form-field"><label for="ppg_setup_video_id"><?php echo esc_html('Setup video'); ?></label><input type="hidden" id="ppg_setup_video_id" name="ppg_setup[video_id]" value="<?php echo esc_attr($video_id); ?>" data-url="<?php echo esc_url($video_url); ?>"><span class="ppg-setup-video-label"><?php echo $video_id ? esc_html('Video #' . $video_id) : esc_html('No video selected'); ?></span><button type="button" class="button ppg-setup-pick-video"><?php echo esc_html('Select video'); ?></button><button type="button" class="button ppg-setup-clear-video"><?php echo esc_html('Clear video'); ?></button></p>
   <p class="form-field"><label for="ppg_setup_poster_id"><?php echo esc_html('Video poster image'); ?></label><input type="hidden" id="ppg_setup_poster_id" name="ppg_setup[poster_id]" value="<?php echo esc_attr($poster_id); ?>" data-url="<?php echo esc_url($poster_url); ?>"><span class="ppg-setup-poster-label"><?php echo $poster_id ? esc_html('Image #' . $poster_id) : esc_html('No poster selected'); ?></span><button type="button" class="button ppg-setup-pick-poster"><?php echo esc_html('Select poster'); ?></button><button type="button" class="button ppg-setup-clear-poster"><?php echo esc_html('Clear poster'); ?></button></p>
  </div>
  <p class="form-field"><label for="ppg_setup_replace_illustrations"><?php echo esc_html('Replace retained Brizy illustrations (automatic placement only)'); ?></label><input type="hidden" name="ppg_setup[replace_illustrations]" value="0"><input type="checkbox" id="ppg_setup_replace_illustrations" name="ppg_setup[replace_illustrations]" value="1" <?php echo checked($config['replace_illustrations'], 1, false); ?>><span class="description"><?php echo esc_html('Optional. Replaces only one safely identified image-only row retained by automatic gallery placement. Separate authored Brizy sections outside shortcodes stay unchanged.'); ?></span></p>
  <div class="ppg-setup-actions">
   <button type="button" class="button ppg-setup-preview-button"><?php echo esc_html('Preview'); ?></button>
   <div class="ppg-setup-preview"></div>
   <button type="button" class="button ppg-setup-export"><?php echo esc_html('Export 15 second MP4'); ?></button>
   <button type="button" class="button ppg-setup-export-cancel" disabled><?php echo esc_html('Cancel export'); ?></button>
   <button type="button" class="button ppg-setup-use-video" hidden disabled><?php echo esc_html('Use exported video'); ?></button>
   <a class="button ppg-setup-download" href="#" hidden><?php echo esc_html('Download MP4'); ?></a>
  </div>
  <p class="ppg-setup-admin-status" role="status" aria-live="polite"></p>
  <p class="ppg-setup-admin-error" role="alert"></p>
 </div>
        <?php
    }

    /* ----------------------------------------------------------------- save */

    /**
     * Persist the setup configuration on the regular product Update.
     *
     * The marker field distinguishes a submitted setup panel from a product
     * saved elsewhere, so unrelated saves never clear the stored setup.
     */
    public static function save($id) {
        $id = self::positive_id($id);
        if (!$id) { return; }
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) { return; }
        if (wp_is_post_revision($id) || wp_is_post_autosave($id) || get_post_type($id) !== 'product' || !current_user_can('edit_post', $id)) { return; }
        if (!isset($_POST['ppg_setup_present'], $_POST['ppg_setup_nonce'])) { return; }
        if (!is_string($_POST['ppg_setup_nonce']) || !wp_verify_nonce(wp_unslash($_POST['ppg_setup_nonce']), 'ppg_setup_save_' . $id)) { return; }
        $raw = isset($_POST['ppg_setup']) && is_array($_POST['ppg_setup']) ? wp_unslash($_POST['ppg_setup']) : array();
        update_post_meta($id, self::META_KEY, self::sanitize($raw));
    }

    /* --------------------------------------------------------------- assets */

    public static function register_assets() {
        wp_register_style('ppg-setup', plugins_url('assets/setup.css', PPG_PLUGIN_FILE), array(), PPG_VERSION);
        wp_register_script('ppg-setup', plugins_url('assets/setup.js', PPG_PLUGIN_FILE), array(), PPG_VERSION, true);
        wp_enqueue_style('ppg-setup');
    }

    public static function assets($hook) {
        $screen = function_exists('get_current_screen') ? get_current_screen() : null;
        if (!$screen || $screen->post_type !== 'product' || !in_array($hook, array('post.php', 'post-new.php'), true)) { return; }
        if (function_exists('wp_enqueue_media')) { wp_enqueue_media(); }
        self::register_assets();
        wp_register_script('ppg-setup-admin', plugins_url('assets/setup-admin.js', PPG_PLUGIN_FILE), array('jquery', 'ppg-setup'), PPG_VERSION, true);
        wp_enqueue_script('ppg-setup-admin');
        wp_enqueue_style('ppg-setup');
    }

    /* --------------------------------------------------------------- upload */

    /** AJAX entry point for the browser generated MP4 upload. */
    public static function ajax_upload() {
        $result = self::handle_upload();
        if ($result['status'] === 200) {
            if (function_exists('wp_send_json_success')) { wp_send_json_success($result['body']); }
            return;
        }
        if (function_exists('wp_send_json_error')) { wp_send_json_error($result['body'], $result['status']); }
    }

    /**
     * Process an upload request and return the structured outcome.
     *
     * Kept separate from the JSON transport so every failure branch is
     * explicit and testable: 400 bad request, 403 forbidden, 413 too large,
     * 415 unsupported media, 429 rate limited.
     */
    public static function handle_upload() {
        $product_id = self::positive_id($_POST['product_id'] ?? null);
        if (!$product_id || get_post_type($product_id) !== 'product') {
            return self::invalid(400, 'invalid_product', 'The product could not be verified.');
        }
        if (!current_user_can('edit_post', $product_id)) {
            return self::invalid(403, 'forbidden', 'You are not allowed to edit this product.');
        }
        if (!current_user_can('upload_files')) {
            return self::invalid(403, 'forbidden', 'You are not allowed to upload files.');
        }
        $nonce = $_POST['nonce'] ?? '';
        if (!is_string($nonce) || !wp_verify_nonce(wp_unslash($nonce), 'ppg_setup_export_' . $product_id)) {
            return self::invalid(403, 'invalid_nonce', 'The upload request expired. Reload the product and try again.');
        }

        // Cheap early size rejection before any file is read.
        $declared = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
        if ($declared > self::MAX_UPLOAD_BYTES) {
            return self::invalid(413, 'file_too_large', 'The setup video must be 25 MB or smaller.');
        }

        $lock = self::lock_key($product_id);
        if (self::transient_get($lock)) {
            return self::invalid(429, 'rate_limited', 'Please wait a minute before uploading another setup video.');
        }

        // Rate limit before inspection. Missing/interrupted uploads can retry;
        // inspected invalid media retains the lock to bound metadata work,
        // as do successful writes. Storage failures release the lock.
        self::transient_set($lock, time() + self::RATE_LIMIT_SECONDS, self::RATE_LIMIT_SECONDS);

        $file = $_FILES['setup_video'] ?? null;
        $check = self::validate_upload($file);
        if (!$check['ok']) {
            if ($check['status'] === 400) { self::transient_delete($lock); }
            return $check;
        }

        $attachment_id = self::store_upload($product_id, $file);
        if (!$attachment_id) {
            self::transient_delete($lock);
            return self::invalid(400, 'upload_failed', 'The setup video could not be saved.');
        }

        // Fail closed: only a stored, valid video attachment is a success.
        if (!self::is_video_attachment($attachment_id)) {
            if (function_exists('wp_delete_attachment')) { wp_delete_attachment($attachment_id, true); }
            return self::invalid(415, 'unsupported_type', 'The uploaded file was not stored as a supported video.');
        }

        $url = self::attachment_url($attachment_id);
        // The product configuration is not changed here; that happens with the
        // normal product Update.
        return array('ok' => true, 'status' => 200, 'code' => 'ok', 'message' => '', 'body' => array('id' => (int) $attachment_id, 'url' => $url));
    }

    /**
     * Validate an uploaded setup video.
     *
     * Checks the real file size, the MP4 container signature, the detected
     * MIME type and the video metadata (duration and frame size). Returns a
     * structured result so the failure branch is explicit.
     */
    public static function validate_upload($file) {
        if (!is_array($file) || !isset($file['error'], $file['tmp_name'])) {
            return self::invalid(400, 'missing_file', 'No setup video file was received.');
        }
        if ((int) $file['error'] !== UPLOAD_ERR_OK) {
            return self::invalid(400, 'upload_failed', 'The setup video upload did not complete.');
        }
        $path = $file['tmp_name'];
        if (!is_string($path) || $path === '' || !is_file($path)) {
            return self::invalid(400, 'upload_failed', 'The setup video upload did not complete.');
        }
        $size = (int) @filesize($path);
        if ($size <= 0) {
            return self::invalid(400, 'upload_failed', 'The setup video upload did not complete.');
        }
        if ($size > self::MAX_UPLOAD_BYTES) {
            return self::invalid(413, 'file_too_large', 'The setup video must be 25 MB or smaller.');
        }
        if (!self::has_mp4_signature($path)) {
            return self::invalid(415, 'unsupported_type', 'The setup video must be an MP4 file.');
        }
        $mime = self::detect_mime($path);
        if ($mime !== 'video/mp4') {
            return self::invalid(415, 'unsupported_type', 'The setup video must be an MP4 file.');
        }
        $meta = self::video_metadata($path);
        if (!$meta) {
            return self::invalid(415, 'unreadable_video', 'The setup video could not be read.');
        }
        $length = isset($meta['length']) ? (float) $meta['length'] : 0.0;
        if ($length < 14 || $length > 17) {
            return self::invalid(415, 'invalid_duration', 'The setup video must be about 15 seconds long.');
        }
        $width = isset($meta['width']) ? (int) $meta['width'] : 0;
        $height = isset($meta['height']) ? (int) $meta['height'] : 0;
        if ($width <= 0 || $height <= 0) {
            return self::invalid(415, 'invalid_dimensions', 'The setup video dimensions could not be read.');
        }
        if ($width > 1280 || $height > 720) {
            return self::invalid(415, 'invalid_dimensions', 'The setup video must be at most 1280x720 pixels.');
        }
        return array('ok' => true, 'status' => 200, 'code' => 'ok', 'message' => '', 'body' => array(), 'width' => $width, 'height' => $height, 'duration' => $length);
    }

    /**
     * Store the validated upload as public product media.
     *
     * The client supplied file name is never trusted: a random name is used.
     */
    private static function store_upload($product_id, $file) {
        if (!function_exists('media_handle_upload')) {
            $includes = defined('ABSPATH') ? ABSPATH . 'wp-admin/includes/' : '';
            foreach (array('file.php', 'media.php', 'image.php') as $include) {
                if ($includes && file_exists($includes . $include)) { require_once $includes . $include; }
            }
        }
        if (!function_exists('media_handle_upload')) { return 0; }
        $name = 'ppg-setup-' . self::random_token() . '.mp4';
        $original = $_FILES['setup_video'];
        $_FILES['setup_video'] = array(
            'name' => $name,
            'type' => 'video/mp4',
            'tmp_name' => $file['tmp_name'],
            'error' => (int) $file['error'],
            'size' => (int) @filesize($file['tmp_name']),
        );
        $attachment_id = media_handle_upload('setup_video', $product_id, array('post_title' => $name), array('test_form' => false, 'mimes' => array('mp4' => 'video/mp4')));
        $_FILES['setup_video'] = $original;
        if (function_exists('is_wp_error') && is_wp_error($attachment_id)) { return 0; }
        return (int) $attachment_id;
    }

    /* --------------------------------------------------------------- helpers */

    /**
     * Resolve the stored setup values into renderable media.
     *
     * Returns the resolvable images, the images that disappeared, the video and
     * the poster. Missing media is reported, never silently replaced.
     */
    private static function resolve($raw) {
        $raw = is_array($raw) ? $raw : array();
        $images = array();
        $missing_images = array();
        foreach (self::candidate_ids($raw['images'] ?? null) as $candidate) {
            $src = self::image_url($candidate);
            if ($src === '') {
                if (count($missing_images) < self::MAX_IMAGES) { $missing_images[] = $candidate; }
                continue;
            }
            if (count($images) >= self::MAX_IMAGES) { continue; }
            $images[] = array('id' => $candidate, 'src' => $src, 'alt' => self::attachment_alt($candidate));
        }
        $video = null;
        $video_missing = false;
        $video_id = self::positive_id($raw['video_id'] ?? null);
        if ($video_id) {
            if (self::is_video_attachment($video_id)) {
                $url = self::attachment_url($video_id);
                if ($url !== '') { $video = array('id' => $video_id, 'url' => $url); } else { $video_missing = true; }
            } else {
                $video_missing = true;
            }
        }
        $poster = '';
        $poster_id = self::positive_id($raw['poster_id'] ?? null);
        if ($poster_id) { $poster = self::image_url($poster_id); }
        return array(
            'images' => $images,
            'missing_images' => $missing_images,
            'video' => $video,
            'video_missing' => $video_missing,
            'poster' => $poster,
        );
    }

    /** MIME type of an attachment, empty when unknown. */
    private static function mime_type($id) {
        if (!function_exists('get_post_mime_type')) { return ''; }
        $mime = get_post_mime_type($id);
        return is_string($mime) ? $mime : '';
    }

    /** Public URL of an attachment, empty when unknown. */
    private static function attachment_url($id) {
        if (!function_exists('wp_get_attachment_url')) { return ''; }
        $url = wp_get_attachment_url($id);
        return is_string($url) ? $url : '';
    }

    /** Admin ajax endpoint used by the setup upload. */
    private static function ajax_url() {
        if (!function_exists('admin_url')) { return ''; }
        return admin_url('admin-ajax.php');
    }

    /** Nonce for the setup upload action. */
    private static function export_nonce($id) {
        if (!function_exists('wp_create_nonce')) { return ''; }
        return (string) wp_create_nonce('ppg_setup_export_' . $id);
    }

    private static function transient_get($key) {
        return function_exists('get_transient') ? get_transient($key) : false;
    }

    private static function transient_set($key, $value, $expiration) {
        if (function_exists('set_transient')) { set_transient($key, $value, $expiration); }
    }

    private static function transient_delete($key) {
        if (function_exists('delete_transient')) { delete_transient($key); }
    }

    /** Positive integer attachment id, or 0 for anything malformed. */
    private static function positive_id($value) {
        if (is_int($value)) { return $value > 0 ? $value : 0; }
        if (!is_string($value) || !preg_match('/^[1-9][0-9]*$/D', $value)) { return 0; }
        if (strlen($value) > 18) { return 0; }
        $id = (int) $value;
        return $id > 0 ? $id : 0;
    }

    /** Strict checkbox style flag. */
    private static function flag($value) {
        return in_array($value, array(1, '1', true), true) ? 1 : 0;
    }

    /** Allowlisted string choice. */
    private static function choice($value, $choices, $default) {
        return is_string($value) && in_array($value, $choices, true) ? $value : $default;
    }

    /** Plain text with a hard character bound. */
    private static function text($value, $max) {
        if (!is_string($value)) { return ''; }
        $clean = strip_tags($value);
        $clean = preg_replace('/[\x00-\x1F\x7F]/', ' ', $clean);
        $clean = preg_replace('/\s+/', ' ', $clean);
        if (!is_string($clean)) { $clean = $value; }
        $clean = trim($clean);
        if ($max > 0) {
            if (function_exists('mb_strlen')) {
                if (mb_strlen($clean, 'UTF-8') > $max) { $clean = mb_substr($clean, 0, $max, 'UTF-8'); }
            } elseif (strlen($clean) > $max) {
                $clean = substr($clean, 0, $max);
            }
        }
        return $clean;
    }

    /** Submitted image ids: positive integers, deduplicated and bounded. */
    private static function candidate_ids($value) {
        if (!is_array($value)) { $value = ($value === null || $value === '') ? array() : array($value); }
        $ids = array();
        foreach ($value as $candidate) {
            $id = self::positive_id($candidate);
            if (!$id || in_array($id, $ids, true)) { continue; }
            $ids[] = $id;
            if (count($ids) >= self::MAX_SUBMITTED_IDS) { break; }
        }
        return $ids;
    }

    /** Candidate ids that resolve to real local raster attachments. */
    private static function valid_images($ids) {
        $out = array();
        foreach ($ids as $id) {
            if (!self::is_image_attachment($id)) { continue; }
            $out[] = $id;
            if (count($out) >= self::MAX_IMAGES) { break; }
        }
        return $out;
    }

    private static function valid_image_id($value) {
        $id = self::positive_id($value);
        return ($id && self::is_image_attachment($id)) ? $id : 0;
    }

    private static function valid_video_id($value) {
        $id = self::positive_id($value);
        return ($id && self::is_video_attachment($id)) ? $id : 0;
    }

    /** True for an existing attachment with an allowlisted raster MIME type. */
    private static function is_image_attachment($id) {
        $id = self::positive_id($id);
        if (!$id) { return false; }
        if (get_post_type($id) !== 'attachment') { return false; }
        $mime = self::mime_type($id);
        return in_array($mime, self::IMAGE_MIMES, true);
    }

    /** True for an existing attachment with an allowlisted video MIME type. */
    private static function is_video_attachment($id) {
        $id = self::positive_id($id);
        if (!$id) { return false; }
        if (get_post_type($id) !== 'attachment') { return false; }
        $mime = self::mime_type($id);
        return in_array($mime, self::VIDEO_MIMES, true);
    }

    /** Original attachment rendition avoids archived derivative redirect/CORS failures during canvas export. */
    private static function image_url($id) {
        $id = self::positive_id($id);
        if (!$id || !self::is_image_attachment($id)) { return ''; }
        $source = wp_get_attachment_image_src($id, 'full');
        if (!is_array($source) || empty($source[0]) || !is_string($source[0])) { return ''; }
        return $source[0];
    }

    private static function attachment_alt($id) {
        $alt = get_post_meta(self::positive_id($id), '_wp_attachment_image_alt', true);
        return is_string($alt) ? $alt : '';
    }

    /** Public, non password protected product. */
    private static function is_public_product($id) {
        if (class_exists('PPG') && is_callable(array('PPG', 'public_product'))) {
            return (bool) PPG::public_product($id);
        }
        return get_post_type($id) === 'product' && get_post_status($id) === 'publish' && !post_password_required($id);
    }

    /** MP4/ISO base media container signature. */
    private static function has_mp4_signature($path) {
        $handle = @fopen($path, 'rb');
        if (!$handle) { return false; }
        $head = (string) fread($handle, 16);
        fclose($handle);
        return strlen($head) >= 8 && substr($head, 4, 4) === 'ftyp';
    }

    private static function detect_mime($path) {
        if (!function_exists('finfo_open')) { return ''; }
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        if (!$finfo) { return ''; }
        $mime = finfo_file($finfo, $path);
        finfo_close($finfo);
        return is_string($mime) ? strtolower(trim($mime)) : '';
    }

    /** Video metadata (duration in seconds, frame size) or an empty array. */
    private static function video_metadata($path) {
        if (!function_exists('wp_read_video_metadata') && defined('ABSPATH') && is_file(ABSPATH . 'wp-admin/includes/media.php')) {
            require_once ABSPATH . 'wp-admin/includes/media.php';
        }
        if (function_exists('wp_read_video_metadata')) {
            $meta = wp_read_video_metadata($path);
            if (is_array($meta) && !empty($meta)) {
                if (empty($meta['length'])) { $meta['length'] = self::mp4_duration($path); }
                return $meta;
            }
        }
        if (class_exists('getid3')) {
            $reader = new getid3();
            $meta = $reader->analyze($path);
            if (is_array($meta) && !empty($meta)) {
                $meta['length'] = !empty($meta['playtime_seconds']) ? (float) $meta['playtime_seconds'] : self::mp4_duration($path);
                $meta['width'] = (int) ($meta['video']['resolution_x'] ?? 0);
                $meta['height'] = (int) ($meta['video']['resolution_y'] ?? 0);
                return $meta;
            }
        }
        return array();
    }

    /** Bounded ISO-BMFF movie-header duration for native fragmented MP4s.
     * getID3 in WordPress does not support these files, even when playable.
     * No executable, network request or client-supplied duration is used.
     */
    private static function mp4_duration($path) {
        $data = @file_get_contents($path, false, null, 0, self::MAX_UPLOAD_BYTES + 1);
        if (!is_string($data) || strlen($data) > self::MAX_UPLOAD_BYTES) { return 0; }
        $u32 = static function ($offset) use ($data) {
            if ($offset < 0 || $offset + 4 > strlen($data)) { return null; }
            $value = unpack('Nvalue', substr($data, $offset, 4)); return $value['value'];
        };
        $boxes = static function ($start, $end) use ($data, $u32) {
            $out = array(); $offset = $start;
            while ($offset + 8 <= $end && count($out) < 4096) {
                $size = $u32($offset); $header = 8;
                if ($size === 1) {
                    if ($offset + 16 > $end || $u32($offset + 8) !== 0) { break; }
                    $size = $u32($offset + 12); $header = 16;
                } elseif ($size === 0) { $size = $end - $offset; }
                if ($size < $header || $offset + $size > $end) { break; }
                $out[] = array('type' => substr($data, $offset + 4, 4), 'start' => $offset + $header, 'end' => $offset + $size);
                $offset += $size;
            }
            return $out;
        };
        foreach ($boxes(0, strlen($data)) as $movie) {
            if ($movie['type'] !== 'moov') { continue; }
            foreach ($boxes($movie['start'], $movie['end']) as $atom) {
                if ($atom['type'] !== 'mvhd') { continue; }
                $p = $atom['start']; if ($p >= strlen($data)) { return 0; }
                $version = ord($data[$p]);
                if ($version !== 0 && $version !== 1) { return 0; }
                $scale_at = $p + ($version === 1 ? 20 : 12);
                $duration_at = $p + ($version === 1 ? 24 : 16);
                if ($duration_at + ($version === 1 ? 8 : 4) > $atom['end']) { return 0; }
                $scale = $u32($scale_at); if (!$scale) { return 0; }
                $ticks = $version === 1 ? $u32($duration_at) * 4294967296.0 + $u32($duration_at + 4) : $u32($duration_at);
                $seconds = $ticks / $scale;
                return is_finite($seconds) && $seconds > 0 ? $seconds : 0;
            }
        }
        return 0;
    }

    private static function random_token() {
        return bin2hex(random_bytes(8));
    }

    /** Per user and product upload lock. */
    private static function lock_key($product_id) {
        $user = function_exists('get_current_user_id') ? (int) get_current_user_id() : 0;
        return 'ppg_setup_upload_' . $user . '_' . (int) $product_id;
    }

    private static function invalid($status, $code, $message) {
        return array('ok' => false, 'status' => $status, 'code' => $code, 'message' => $message, 'body' => array('code' => $code, 'message' => $message));
    }
}

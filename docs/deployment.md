# Deployment and rollback

Only approved target: `https://portare.up.railway.app`, Railway project `portare-staging`, service `liveedge-web`. Railway calls the environment production; WordPress itself must report staging. Do not deploy to liveedgedesign.com.

Keep source on a reviewed feature branch. Transfer a runtime-only plugin archive to the existing `/var/www/html/wp-content/plugins/portare-product-gallery` directory; verify source hashes before activation. Verify WordPress environment and home URL before state changes. Enable automatic mode on product 10440 only. Keep autoplay off by default and leave real product text/images intact; don't leave synthetic QA descriptions behind.

Rollback: disable **Enable automatic gallery** for the product (shortcodes remain independent), switch to shortcode-only mode, or deactivate the plugin. Saved Brizy content and its original layout are unchanged. Preserve metadata/media and the existing Portare Quote Builder. Do not uninstall other plugins or flush unrelated global settings.

No GitHub auto-updater is included in this initial release. Install updates manually after review. Future automatic updates require separate implementation/testing.

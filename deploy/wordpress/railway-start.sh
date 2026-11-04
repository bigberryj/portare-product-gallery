#!/usr/bin/env bash
set -Eeuo pipefail

PORT="${PORT:-8080}"
DOCROOT=/var/www/html
SEED_DIR="$DOCROOT/.seed"

# Railway routes to its injected PORT over plain HTTP inside the private network.
sed -Ei "/^listener HTTP[[:space:]]*\{/,/^\}/ s#address[[:space:]]+\\*:[0-9]+#address                 *:${PORT}#" /usr/local/lsws/conf/httpd_config.conf

mkdir -p "$DOCROOT"

if [[ ! -f "$DOCROOT/wp-load.php" ]]; then
    if [[ ! -f "$SEED_DIR/site.tar.zst" ]]; then
        echo "Missing $SEED_DIR/site.tar.zst" >&2
        exit 1
    fi
    echo "Extracting WordPress seed into persistent volume..."
    tar --zstd -xf "$SEED_DIR/site.tar.zst" -C "$DOCROOT"
fi

# Refresh deployment-managed files from the immutable image on every start so
# a persistent volume cannot retain stale runtime configuration.
install -m 0640 /opt/railway/wp-config.php "$DOCROOT/wp-config.php"
install -m 0644 /opt/railway/railway-health.php "$DOCROOT/railway-health.php"
install -m 0644 /opt/railway/railway-media.php "$DOCROOT/railway-media.php"
install -m 0644 /opt/railway/htaccess "$DOCROOT/.htaccess"
mkdir -p "$DOCROOT/wp-content/mu-plugins"
install -m 0644 /opt/railway/000-staging-isolation.php "$DOCROOT/wp-content/mu-plugins/000-staging-isolation.php"
install -m 0644 /opt/railway/railway-brizy-media-hydration.php "$DOCROOT/wp-content/mu-plugins/005-railway-brizy-media-hydration.php"
install -m 0644 /opt/railway/010-brizy-editor-lock.php "$DOCROOT/wp-content/mu-plugins/010-brizy-editor-lock.php"

# The front-page rewrite MU plugin (which forced "/" to serve the Portable Event
# Furniture product-category archive) is no longer used. The site serves its real
# "Home" page again, so remove the plugin from the volume if an earlier deployment
# installed it -- a restart must not resurrect the rewrite.
rm -f "$DOCROOT/wp-content/mu-plugins/006-railway-staging-home.php" 2>/dev/null || true

# Remove any LiteSpeed Cache plugin directory and its dropped-in helpers before
# startup so a previous activation cannot resurrect its .htaccess rewrite markers
# and prematurely exhaust LSAPI workers. LiteSpeed Cache remains intentionally
# absent on this OpenLiteSpeed staging runtime.
rm -rf "$DOCROOT/wp-content/plugins/litespeed-cache" 2>/dev/null || true
rm -f "$DOCROOT/wp-content/advanced-cache.php" 2>/dev/null || true
rm -f "$DOCROOT/wp-content/object-cache.php" 2>/dev/null || true

# The restored snapshot can contain Breeze's advanced-cache.php drop-in even
# when the Breeze plugin is inactive. Under OpenLiteSpeed it can load partial
# Breeze classes before normal plugins and exhaust every LSAPI worker. This
# OpenLiteSpeed staging runtime does not use Breeze page caching, so remove
# only the positively identified Breeze drop-in. The pristine local snapshot
# remains the rollback source.
if [[ -f "$DOCROOT/wp-content/advanced-cache.php" ]] && php -r '
$source = file_get_contents($argv[1]);
exit(is_string($source) && stripos($source, "Breeze") !== false ? 0 : 1);
' "$DOCROOT/wp-content/advanced-cache.php"; then
    echo "Removing incompatible Breeze advanced-cache.php drop-in..."
    rm -f "$DOCROOT/wp-content/advanced-cache.php"
fi

required=(WORDPRESS_DB_HOST WORDPRESS_DB_NAME WORDPRESS_DB_USER WORDPRESS_DB_PASSWORD WORDPRESS_AUTH_KEY WORDPRESS_SECURE_AUTH_KEY WORDPRESS_LOGGED_IN_KEY WORDPRESS_NONCE_KEY WORDPRESS_AUTH_SALT WORDPRESS_SECURE_AUTH_SALT WORDPRESS_LOGGED_IN_SALT WORDPRESS_NONCE_SALT S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_BUCKET S3_ENDPOINT S3_REGION RAILWAY_PUBLIC_DOMAIN)
for name in "${required[@]}"; do
    if [[ -z "${!name:-}" ]]; then
        echo "Required environment variable is missing: $name" >&2
        exit 1
    fi
done

# LSAPI workers do not inherit Railway's container environment. Generate a
# protected PHP array without printing any values, then let PHP read it.
php -r '
$keys = [
  "WORDPRESS_DB_HOST", "WORDPRESS_DB_PORT", "WORDPRESS_DB_NAME", "WORDPRESS_DB_USER", "WORDPRESS_DB_PASSWORD",
  "WORDPRESS_AUTH_KEY", "WORDPRESS_SECURE_AUTH_KEY", "WORDPRESS_LOGGED_IN_KEY", "WORDPRESS_NONCE_KEY",
  "WORDPRESS_AUTH_SALT", "WORDPRESS_SECURE_AUTH_SALT", "WORDPRESS_LOGGED_IN_SALT", "WORDPRESS_NONCE_SALT",
  "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET", "S3_ENDPOINT", "S3_REGION",
  "RAILWAY_PUBLIC_DOMAIN", "WP_HOME", "WP_SITEURL", "WAN_ACCESS_KEY"
];
$values = [];
foreach ($keys as $key) {
    $value = getenv($key);
    if ($value !== false) { $values[$key] = $value; }
}
file_put_contents("/var/www/html/.railway-env.php", "<?php\nreturn " . var_export($values, true) . ";\n");
'
chown root:nogroup "$DOCROOT/.railway-env.php"
chmod 0640 "$DOCROOT/.railway-env.php"

DB_PORT="${WORDPRESS_DB_PORT:-3306}"
for attempt in $(seq 1 120); do
    if mariadb-admin --skip-ssl ping -h "$WORDPRESS_DB_HOST" -P "$DB_PORT" -u "$WORDPRESS_DB_USER" -p"$WORDPRESS_DB_PASSWORD" --silent; then
        break
    fi
    if [[ "$attempt" == 120 ]]; then
        echo "MariaDB did not become ready" >&2
        exit 1
    fi
    sleep 2
done

TABLE_EXISTS="$(mariadb --skip-ssl -N -B -h "$WORDPRESS_DB_HOST" -P "$DB_PORT" -u "$WORDPRESS_DB_USER" -p"$WORDPRESS_DB_PASSWORD" "$WORDPRESS_DB_NAME" -e "SHOW TABLES LIKE 'wpjw_options';" 2>/dev/null || true)"
if [[ -z "$TABLE_EXISTS" ]]; then
    if [[ ! -f "$SEED_DIR/database.sql.gz" ]]; then
        echo "Database is empty and $SEED_DIR/database.sql.gz is missing" >&2
        exit 1
    fi
    echo "Importing WordPress database..."
    gzip -dc "$SEED_DIR/database.sql.gz" | mariadb --skip-ssl -h "$WORDPRESS_DB_HOST" -P "$DB_PORT" -u "$WORDPRESS_DB_USER" -p"$WORDPRESS_DB_PASSWORD" "$WORDPRESS_DB_NAME"
fi

# Keep the redundant Breeze page-cache plugin disabled on this OLS staging
# runtime. This is an isolated Railway database change only.
if php /usr/local/bin/wp --path="$DOCROOT" --skip-plugins --skip-themes plugin is-active breeze; then
    php /usr/local/bin/wp --quiet --path="$DOCROOT" --skip-plugins --skip-themes plugin deactivate breeze
fi

PUBLIC_HOST="${RAILWAY_PUBLIC_DOMAIN:-}"
if [[ -n "$PUBLIC_HOST" ]]; then
    PUBLIC_URL="https://${PUBLIC_HOST}"
    URL_MARKER="$DOCROOT/.railway-public-url"
    MIGRATED_URL="$(cat "$URL_MARKER" 2>/dev/null || true)"
    if [[ "$MIGRATED_URL" != "$PUBLIC_URL" ]]; then
        echo "Applying serialization-safe staging URL migration..."

        # Replace a previous URL host with the current public host. Host-only
        # (no scheme) so both http:// and https:// forms, protocol-relative
        # forms and serialized payloads are all covered in one pass.
        migrate_url() {
            local from="$1" to="$2"
            if [[ -z "$from" || -z "$to" || "$from" == "$to" ]]; then
                return 0
            fi
            echo "  ${from} -> ${to}"
            php /usr/local/bin/wp --quiet --path="$DOCROOT" --skip-plugins --skip-themes \
                search-replace "$from" "$to" --all-tables-with-prefix --precise \
                --skip-columns=guid \
                || echo "  warning: migration from ${from} did not complete cleanly" >&2
        }

        # The original local development URL the snapshot was seeded from.
        migrate_url '100.96.13.84:8082' "$PUBLIC_HOST"
        # Whatever public domain was recorded last, so changing the Railway
        # domain is picked up automatically on the next boot.
        if [[ -n "$MIGRATED_URL" ]]; then
            migrate_url "${MIGRATED_URL#*://}" "$PUBLIC_HOST"
        fi

        php /usr/local/bin/wp --quiet --path="$DOCROOT" --skip-plugins --skip-themes option update home "$PUBLIC_URL"
        php /usr/local/bin/wp --quiet --path="$DOCROOT" --skip-plugins --skip-themes option update siteurl "$PUBLIC_URL"
        php /usr/local/bin/wp --quiet --path="$DOCROOT" --skip-plugins --skip-themes cache flush || true
        printf '%s\n' "$PUBLIC_URL" > "$URL_MARKER"
    fi
fi

mkdir -p "$DOCROOT/wp-content/uploads" "$DOCROOT/wp-content/cache" "$DOCROOT/wp-content/upgrade" "$DOCROOT/wp-content/upgrade-temp-backup"
chown -R nobody:nogroup "$DOCROOT/wp-content"
find "$DOCROOT/wp-content" -type d -exec chmod 0755 {} +
find "$DOCROOT/wp-content" -type f -exec chmod 0644 {} +
chown root:nogroup "$DOCROOT/wp-config.php" "$DOCROOT/.htaccess" "$DOCROOT/railway-media.php" "$DOCROOT/railway-health.php" "$DOCROOT/wp-content/mu-plugins/000-staging-isolation.php" "$DOCROOT/wp-content/mu-plugins/005-railway-brizy-media-hydration.php" "$DOCROOT/wp-content/mu-plugins/010-brizy-editor-lock.php"
chmod 0640 "$DOCROOT/wp-config.php"
chmod 0644 "$DOCROOT/.htaccess" "$DOCROOT/railway-media.php" "$DOCROOT/railway-health.php" "$DOCROOT/wp-content/mu-plugins/000-staging-isolation.php" "$DOCROOT/wp-content/mu-plugins/005-railway-brizy-media-hydration.php" "$DOCROOT/wp-content/mu-plugins/010-brizy-editor-lock.php"

# Seed artifacts are no longer needed after both restore steps succeed.
rm -f "$SEED_DIR/site.tar.zst" "$SEED_DIR/database.sql.gz"
rmdir "$SEED_DIR" 2>/dev/null || true

# DISABLE_WP_CRON is true so staging never runs WordPress's own scheduler, which
# leaves Action Scheduler with no runner and piles up past-due housekeeping
# actions. Start an explicit runner that executes only local housekeeping hooks.
install -m 0755 /opt/railway/railway-action-scheduler.sh /usr/local/bin/railway-action-scheduler.sh
/usr/local/bin/railway-action-scheduler.sh &

exec /entrypoint.sh

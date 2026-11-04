FROM node:22.23.4-bookworm-slim AS wan-runtime
WORKDIR /opt/portare-wan
COPY wan-runtime/package.json wan-runtime/package-lock.json ./
# No lifecycle hooks, agent-skill installation, or credentials in image layers.
RUN npm ci --omit=dev --ignore-scripts --no-fund --no-audit \
    && npm audit --omit=dev --audit-level=high

FROM litespeedtech/openlitespeed:1.9.2-lsphp83
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl less mariadb-client zstd ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar -o /usr/local/bin/wp \
    && chmod 0755 /usr/local/bin/wp
COPY --from=wan-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=wan-runtime /opt/portare-wan /opt/portare-wan
# Verify only Node here; no Wan auth, generation or uploads during image builds.
RUN /usr/local/bin/node --version \
    && mkdir -p /var/lib/portare-wan \
    && chown nobody:nogroup /var/lib/portare-wan \
    && chmod 0700 /var/lib/portare-wan
COPY runtime-config/httpd_config.conf /usr/local/lsws/conf/httpd_config.conf
COPY runtime-config/docker.conf /usr/local/lsws/conf/templates/docker.conf
COPY wp-config.railway.php /opt/railway/wp-config.php
COPY railway-health.php /opt/railway/railway-health.php
COPY railway-media.php /opt/railway/railway-media.php
COPY 000-staging-isolation.php /opt/railway/000-staging-isolation.php
COPY railway-brizy-media-hydration.php /opt/railway/railway-brizy-media-hydration.php
COPY 010-brizy-editor-lock.php /opt/railway/010-brizy-editor-lock.php
COPY railway-action-scheduler.sh /opt/railway/railway-action-scheduler.sh
COPY htaccess.railway /opt/railway/htaccess
COPY railway-start.sh /usr/local/bin/railway-start.sh
RUN chmod 0755 /usr/local/bin/railway-start.sh
ENV WP_CLI_ALLOW_ROOT=1
ENTRYPOINT []
CMD ["/usr/local/bin/railway-start.sh"]

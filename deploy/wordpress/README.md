# Portare staging WordPress + Wan runtime

This directory is the reproducible image input for the **existing** Railway
`portare-staging` / `liveedge-web` service, not a new application or public runner.
Railway's environment is named `production`; WordPress must report `staging` and
its home must be `https://portare.up.railway.app`. Never deploy this image to the
business's production site.

## Runtime
- Existing OpenLiteSpeed image: `litespeedtech/openlitespeed:1.9.2-lsphp83`.
- Node: `22.23.4` (official Node image build stage).
- Wan CLI: `@wan-ai/cli@0.0.3`, locked transitive dependencies, lifecycle scripts disabled.
- Fixed CLI file: `/opt/portare-wan/node_modules/@wan-ai/cli/dist/index.js`.
- Node executable: `/usr/local/bin/node`.
- Wan credentials are never baked into image layers. No auth, uploads, or generation run at build time.

## Credential configuration
Set **WAN_ACCESS_KEY** through Railway's variable editor on the above service.
Do not paste it into chat, add it to Git, pass it as a shell argument, or copy
`~/.wan/config.json` into this build context. The local interactive Wan login does
not authenticate the deployment. Saving a Railway variable may redeploy the
container. The startup allowlist writes this key into protected
`/var/www/html/.railway-env.php` (`root:nogroup`, 0640) so LSAPI's existing
`railway_env()` helper can read it. Missing credentials must visibly disable
generation; they do not prevent WordPress from starting.

The application runner receives only the Wan-specific environment it needs,
not database, SMTP or object-storage credentials. Its temporary work is private
and no additional network listener is needed. The Hermes lifecycle guard is
unchanged; this image does not configure an exception to it. Agent-side tests
must not use a wrapper or remote helper to execute a CLI that the guard refused.

## Restricted finished-media egress
`WP_HTTP_BLOCK_EXTERNAL` stays enabled. Only the pre-existing WordPress.org
exceptions and explicitly marked, streamed, size-limited **GET** requests for
finished Wan media are allowed. The latter require HTTPS on port443, a supported
Wan/CDN domain suffix, no credentials/custom headers, core public-IP validation,
certificate verification, no redirects and at most25MB+1 downloaded bytes.
General requests to those CDNs without the private marker are still blocked.
If Wan returns another legitimate CDN, diagnose it and review an exact allowlist
change; do not turn off isolation.

## Build/deploy
First run `php tests/wan-isolation-tests.php`, PHP syntax checks and
`bash -n deploy/wordpress/railway-start.sh` from the plugin repository. Run
`npm ci --ignore-scripts` and `npm audit --omit=dev --audit-level=high` in
`wan-runtime` when reproducing dependencies locally (no Wan execution).

Use the installed Railway CLI's `up` command with this directory as
`--path-as-root`, the exact existing project/service/environment, and a descriptive
message. Read back the **returned deployment ID** until SUCCESS; upload completion
is not proof the image built. Verify Node's version and the CLI package's version
and integrity by reading files, without submitting a render. Compare installed
runtime hashes, verify `/health` and protected-content snapshots, and test the
actual WordPress editor before calling the integration deployed.

The plugin is deployed separately with `qa/wan-stage.py deploy-plugin --approve`
after reviewed tests and packaging. The plugin's installed runtime files are on
the existing persistent WordPress volume.

## Preservation and rollback
`qa/wan-stage.py` guards the staging identity and can capture private rollback
archives and stable per-row content hashes. Baseline runtime source was read
from the existing image on2026-11-03, not reconstructed from an old snapshot.
Existing staging overrides, mail/payment quarantine, media routing, locks and
housekeeping were retained rather than redesigned.

Private rollback archive lives outside Git/webroot under
`~/.local/share/portare-backups/wan-20261103/`. It includes protected config;
never publish it. Restore only the runtime/plugin files changed by this rollout,
not product content or a whole old database. An image rollback alone also
refreshes image-managed MU files on the next start; compare both image and
volume copies. Prior successful deployment at capture time:
`71fc4e1c-ea38-43df-a6ec-6e10f710c403`.

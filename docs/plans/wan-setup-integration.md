# Wan product setup integration

Scope approved by Byron: implement in the existing Portare WordPress plugin, staging only. Preserve existing gallery, product content and Brizy templates. No automatic paid generation, no production deploy, no direct main push, no Hermes guard changes or attempts to execute its blocked CLI through another route.

## Implementation
1. Replace uncommitted MiniMax-only AI transport with a Wan adapter. Fixed runner, argv arrays (no shell); JSON stdin carries bounded structured input. Wan key is server env only. CLI schema comes from pinned @wan-ai/cli 0.0.3 bundled documentation. Keep credentials and signed URLs out of public errors.
2. Editor: explicit first and last frame among selected setup images, optional bounded prompt, supported bounded duration/resolution, unchecked per-request paid/image-transfer consent. Progress/resume and visible errors. Completed video preview plus an explicit Use this video button; only normal product Update publishes.
3. Durable per-job rows and atomic per-product submission/import locks. Store submission intent before calling Wan; ambiguous timeout stays unknown and must not auto-resubmit. Persist task identifiers immediately. Scope status/recovery to product and authorized user. Prevent concurrent paid submissions and duplicate imports.
4. Validate HTTPS output downloads against SSRF/redirects and hard byte limits, sniff MP4 and independently read metadata; import real bytes into Media Library. Never publish product metadata from generation/status handlers.
5. Stage runtime image with pinned Node 22+ and pinned Wan CLI, no automatic skill installs or lifecycle hooks. Credential comes from Railway WAN_ACCESS_KEY through the existing protected runtime env helper. No local credential copying without permission. Missing key/runtime is visible and generation disabled.
6. Offline PHP/JS/runner tests plus real authenticated browser verification without paid calls. Back up installed plugin/config and compare protected content before/after deployment. A real paid render requires explicit editor consent and configured key; never claim full provider success from mocks.
7. Document schema/API/security/deployment/migration and test evidence. Commit and push feature branch after tests and review; deploy only the verified staging target.

## Ownership during parallel implementation
- Backend implementer: includes/class-ppg-setup-ai.php; includes/class-ppg-wan.php; runtime/wan-runner.cjs; tests/setup-ai-tests.php; tests/wan-runner.test.cjs.
- Frontend implementer: includes/class-ppg-setup.php; assets/setup-ai-admin.js; assets/setup.css; tests/setup-ai.test.cjs.
- Parent: integration require, runtime build/deploy, packaging, docs, versioning and full verification. Neither child may deploy/commit/change secrets/execute live Wan.

## Gates
- Spec review, then independent security/quality review.
- Actual paid generation and deployment credential availability are separate from offline functionality. Report unverified gates explicitly.

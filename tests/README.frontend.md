# Frontend verification

These tests exercise **only** `assets/gallery.css` / `assets/gallery.js`. The HTML fixture uses synthetic product copy and real public Unsplash photographs. No WordPress installation, customer data, PQB modal integration, PHP sanitization, admin saving, or staging behavior is asserted here.

## Run

Runtime gallery assets are dependency-free. Tests require Node, `jsdom` and (for browser checks) `playwright`. Keep test dependencies outside the plugin package:

```sh
npm install --prefix "$HOME/.hermes/cache/scratch/ppg-frontend-tools" --no-audit --no-fund jsdom playwright
export NODE_PATH="$HOME/.hermes/cache/scratch/ppg-frontend-tools/node_modules"
"$HOME/.hermes/cache/scratch/ppg-frontend-tools/node_modules/.bin/playwright" install chromium
node --check assets/gallery.js
node --check tests/gallery.test.cjs
node --check tests/gallery.browser.cjs
node --test tests/gallery.test.cjs
node tests/gallery.browser.cjs
```

Run from the plugin directory. Test modules resolve source/fixtures from their own paths, so absolute-path invocation also works. Browser tests start and stop their own ephemeral loopback HTTP server. Public image access is required. `PPG_SCREENSHOTS=/path` overrides the default `tests/artifacts` output location.

Open `tests/fixtures/gallery.html` directly or via a static server for manual checks. Fixture-only query options: `?textSide=right`, `?autoplay=1`, `?transition=slide`, `?transition=none`, `?loadEffect=fade`. With JavaScript disabled, the pre-rendered title, main image, six thumbnails, description, and quote placeholder remain visible; the toolbar is hidden. The quote placeholder intentionally does not implement a modal.

## Coverage

- Unit DOM tests use controlled `Image` loads: race cancellation, failed loads/timeouts preserving prior valid content, src/srcset/sizes, rich-description fallback, aria-pressed, keyboard focus without page scrolling, autoplay/focus/hover/visibility, reduced motion, destruction, single-slide behavior, multiple/lazy instances, malformed/no-slide JSON, image transition modes, optional text fade, PHP percentage zoom.
- Real Chromium checks use public image requests: screenshot-style left/right desktop columns, four visible thumbnail widths, 24px gaps, 32px main rounding, strip overflow, keyboard/strip-only scrolling, per-image description, responsive sources, failed request recovery, mobile order/no page overflow/swipe, reduced-motion manual play/manual stop, no-JS layout, and absence of page JavaScript exceptions.
- Generated screenshots: `tests/artifacts/desktop.png` and `mobile.png`. Screenshots await entry animation completion.

## Lifecycle and contract

Markup/variables follow `docs/plans/build.md`. PHP emits zoom as a percentage (100–200); frontend also accepts 1–4 multipliers for independent fixtures. Root `data-text-fade="0"` suppresses the otherwise-default description fade. Initial inline image framing is normalized to scoped CSS variables after initialization.

The MutationObserver scans newly added subtrees for **60 seconds**, then disconnects. A builder that inserts galleries later must call `window.PortareProductGallery.init(container)`; this API is idempotent for initialized roots. Call `destroy(root)` before permanently removing a gallery after the observation window; explicit `init(root)` can reactivate it. During observation, removed roots are cleaned automatically. Pagehide cleanup and persisted-pageshow reinitialization are supported.

The only HTML sink is the description field from the PHP-sanitized local `.ppg-data` JSON. Do not supply untrusted unsanitized external JSON. No price markup is generated and no quote-button behavior is intercepted.

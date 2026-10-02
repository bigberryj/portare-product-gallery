# Security

- Product save requires valid product-scoped nonce, `edit_post` capability and product type, and rejects autosaves/revisions.
- Settings writes use the WordPress Settings API with `manage_options`.
- Attachment IDs are strictly positive decimal integers, verified as images and deduplicated; submitted rows are capped at 100.
- Rich text uses a narrow WordPress KSES allowlist without script, style, events, images or arbitrary classes. Link protocols are filtered by WordPress.
- Typography/CSS settings use fixed font stacks, strict six-digit colors, enumerated modes and finite bounded numbers. Unknown fields are discarded.
- Public rendering rejects unpublished, password-protected and non-product IDs. Output attributes/URLs/text are escaped and JSON uses all HEX flags.
- There are no arbitrary file writes/uploads, custom SQL, public write endpoints, external telemetry or secrets.
- Gallery removal deletes associations only. Deactivation/uninstall preserve authored metadata and settings.
- QA authentication uses short-lived staging-only sessions stored outside the repository; tokens are revoked after testing and never included in release evidence.

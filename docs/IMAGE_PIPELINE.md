## Image & file pipeline overview

This app stores uploads in a single `files/` folder (no date-based subdirectories). Optimized variants live under `files/<id>/__v/<width>.<format>` so originals and responsive assets stay grouped together.

### Storage & naming
- Originals: `files/<uuid>.<ext>` (or `files/<uuid>-<custom-name>`)
- Variants: `files/<uuid>/__v/<width>.<format>`
- Existing dated paths continue to work; new uploads use the flat layout.

### Runtime configuration (env overrides)
| Setting | Env var | Default |
| --- | --- | --- |
| `fileManager.maxFileSize` | `NUXT_FILE_MAX_SIZE` | 10MB |
| `fileManager.allowedMimeTypes` | `NUXT_FILE_ALLOWED_MIME_TYPES` (comma-separated) | Common image types + PDF/text |
| `fileManager.image.sizes` | `NUXT_FILE_IMAGE_SIZES` (comma-separated ints) | `150,400,800,1200,1600` |
| `fileManager.image.formats` | `NUXT_FILE_IMAGE_FORMATS` | `webp` |
| `fileManager.image.quality` | `NUXT_FILE_IMAGE_QUALITY` | `80` |
| `fileManager.image.maxProxyWidth` | `NUXT_FILE_IMAGE_MAX_PROXY_WIDTH` | `2000` |
| `fileManager.image.enableProxy` | `NUXT_FILE_IMAGE_ENABLE_PROXY` | `true` |
| `fileManager.image.requireAltText` | `NUXT_FILE_REQUIRE_ALT_TEXT` | `false` |
| `fileManager.image.altTextPlaceholder` | `NUXT_FILE_IMAGE_ALT_PLACEHOLDER` | `TODO: describe image` |

### Operational notes
- Upload validation enforces `maxFileSize` and `allowedMimeTypes`.
- Images are optimized asynchronously using the Workers-compatible `@jsquash/*` toolchain; errors are recorded in `file.optimizationStatus/optimizationError`.
- The `/api/images/:id` proxy serves pre-generated variants with long-lived cache headers and falls back to originals if needed.

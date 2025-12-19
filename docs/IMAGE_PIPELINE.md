# Image optimization pipeline (MVP)

## Runtime config / env vars

The image pipeline is configured via `runtimeConfig.fileManager` in `server/utils/runtimeConfig.ts`.

Environment overrides:

- `NUXT_FILE_MAX_SIZE` (bytes, default `10485760` / 10 MB)
- `NUXT_FILE_ALLOWED_MIME_TYPES` (comma-separated list)
- `NUXT_IMAGE_SIZES` (comma-separated widths, default `150,400,800,1200,1600`)
- `NUXT_IMAGE_FORMATS` (`webp`, optionally `avif`)
- `NUXT_IMAGE_QUALITY` (integer, default `80`)
- `NUXT_IMAGE_ENABLE_PROXY` (`true`/`false`, default `true`)
- `NUXT_IMAGE_REQUIRE_ALT_TEXT` (`true`/`false`, default `false`)
- `NUXT_IMAGE_ALT_TEXT_PLACEHOLDER` (default `TODO: describe image`)

## Adding sizes or formats

1. Update `NUXT_IMAGE_SIZES` or `NUXT_IMAGE_FORMATS`.
2. New uploads will enqueue background optimization and generate the additional variants.
3. Existing files remain unchanged unless re-optimized.

## Operational notes

- Originals remain in R2/local storage; variants are stored at `YYYY-MM-DD/uuid/__v/{width}.{format}`.
- Variants are served through `/api/images/:id` with immutable cache headers.
- `optimizationStatus` tracks the background job state; failures are recorded in `optimizationError`.
- Storage will grow with each configured size/format combination; review sizes before expanding.

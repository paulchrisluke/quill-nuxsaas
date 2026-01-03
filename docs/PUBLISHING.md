# Publishing Overview

Quillio publishes content as frontmatter + markdown and a parallel JSON export.
Both artifacts are stored via the configured file storage provider. Optional
GitHub PR publishing can be enabled per organization integration.

## Export formats

- Markdown with YAML frontmatter
  - Source: content frontmatter + body markdown
  - Filename: `content/{orgSlug}/{slug}.md`
- JSON export
  - Source: content metadata + frontmatter + body markdown
  - Filename: `content/{orgSlug}/{slug}.json`

## GitHub PR publishing

If the organization has an active GitHub integration with a `config.publish`
object and `enabled: true`, Quillio will create a PR with both files.

Required config:

```json
{
  "publish": {
    "enabled": true,
    "repoFullName": "owner/repo"
  }
}
```

Optional config (defaults shown):

```json
{
  "publish": {
    "baseBranch": "main",
    "contentPath": "content",
    "jsonPath": "content",
    "branchPrefix": "quillio/publish",
    "prTitle": "Publish: {title-or-slug}",
    "prBody": "Automated publish from Quillio."
  }
}
```

Notes:
- `contentPath` and `jsonPath` are optional; defaults are `content`.
- `prTitle` defaults to `Publish: {title-or-slug}` and `prBody` defaults to `Automated publish from Quillio.`
- `baseBranch` defaults to `main` and `branchPrefix` defaults to `quillio/publish`.
- PR creation uses the GitHub OAuth token attached to the integration account.

## GitHub import

Import reads markdown files from a GitHub repo path and creates content items.

Required config:

```json
{
  "import": {
    "repoFullName": "owner/repo",
    "contentPath": "path/to/markdown"
  }
}
```

Optional config (defaults shown):

```json
{
  "import": {
    "baseBranch": "main",
    "status": "draft"
  }
}
```

Notes:
- Import only reads markdown, so no `jsonPath` is required.
- `baseBranch` defaults to `main` and `status` defaults to `draft`.
- Import uses the GitHub OAuth token attached to the integration account.
- Markdown must include YAML frontmatter for metadata; body markdown is preserved.

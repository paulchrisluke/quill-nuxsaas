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

Optional config:

```json
{
  "publish": {
    "baseBranch": "main",
    "contentPath": "tenants/northcarolinalegalservices/articles",
    "jsonPath": "tenants/northcarolinalegalservices/articles",
    "branchPrefix": "quillio/publish",
    "prTitle": "Publish: Content update",
    "prBody": "Automated publish from Quillio."
  }
}
```

Notes:
- `contentPath` and `jsonPath` define the repo folders for each export.
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

Optional config:

```json
{
  "import": {
    "baseBranch": "main",
    "status": "draft"
  }
}
```

Notes:
- Import uses the GitHub OAuth token attached to the integration account.
- Markdown must include YAML frontmatter for metadata; body markdown is preserved.

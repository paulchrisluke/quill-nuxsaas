import { createError } from 'h3'

const GITHUB_API_BASE = 'https://api.github.com'

export interface GithubPublishConfig {
  repoFullName: string
  baseBranch?: string
  contentPath?: string
  jsonPath?: string
  branchPrefix?: string
  prTitle?: string
  prBody?: string
}

export interface GithubPublishFile {
  path: string
  content: string
}

export interface GithubPublishResult {
  branch: string
  prNumber: number
  prUrl: string
}

const normalizeBranchName = (value: string) =>
  value.replace(/[^\w./-]+/g, '-').replace(/^-+|-+$/g, '')

const createBranchName = (prefix: string, slug: string) => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const cleanedSlug = normalizeBranchName(slug || 'content')
  const cleanedPrefix = normalizeBranchName(prefix || 'quillio/publish')
  return `${cleanedPrefix}/${cleanedSlug}-${timestamp}`.replace(/\/{2,}/g, '/')
}

const parseRepoFullName = (repoFullName: string) => {
  const [owner, repo] = repoFullName.split('/')
  if (!owner || !repo) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid GitHub repo format. Expected "owner/repo".'
    })
  }
  return { owner, repo }
}

const githubRequest = async <T>(token: string, path: string, options: RequestInit = {}) => {
  if (!token || typeof token !== 'string') {
    throw createError({
      statusCode: 401,
      statusMessage: 'GitHub token is required'
    })
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch(`${GITHUB_API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      const body = await response.text()
      throw createError({
        statusCode: response.status,
        statusMessage: `GitHub API error: ${response.statusText}`,
        data: body
      })
    }

    return response.json() as Promise<T>
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw createError({
        statusCode: 504,
        statusMessage: 'GitHub API request timeout'
      })
    }
    throw error
  }
}

export const publishToGithub = async (
  token: string,
  config: GithubPublishConfig,
  options: {
    slug: string
    title: string
    files: GithubPublishFile[]
  }
): Promise<GithubPublishResult> => {
  const { owner, repo } = parseRepoFullName(config.repoFullName)
  const baseBranch = config.baseBranch || 'main'
  const branch = createBranchName(config.branchPrefix || 'quillio/publish', options.slug)
  const commitMessage = `Publish ${options.title || options.slug}`
  const prTitle = config.prTitle || `Publish: ${options.title || options.slug}`
  const prBody = config.prBody || 'Automated publish from Quillio.'

  const baseRef = await githubRequest<{ object: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`
  )

  const baseCommitSha = baseRef.object.sha
  const baseCommit = await githubRequest<{ tree: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/commits/${baseCommitSha}`
  )

  const tree = await githubRequest<{ sha: string }>(
    token,
    `/repos/${owner}/${repo}/git/trees`,
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: options.files.map(file => ({
          path: file.path,
          mode: '100644',
          type: 'blob',
          content: file.content
        }))
      })
    }
  )

  const commit = await githubRequest<{ sha: string }>(
    token,
    `/repos/${owner}/${repo}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({
        message: commitMessage,
        tree: tree.sha,
        parents: [baseCommitSha]
      })
    }
  )

  await githubRequest(
    token,
    `/repos/${owner}/${repo}/git/refs`,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: commit.sha
      })
    }
  )

  const pr = await githubRequest<{ html_url: string, number: number }>(
    token,
    `/repos/${owner}/${repo}/pulls`,
    {
      method: 'POST',
      body: JSON.stringify({
        title: prTitle,
        head: branch,
        base: baseBranch,
        body: prBody
      })
    }
  )

  return {
    branch,
    prNumber: pr.number,
    prUrl: pr.html_url
  }
}

import { Buffer } from 'buffer'
import { createError } from 'h3'

const GITHUB_API_BASE = 'https://api.github.com'

export interface GithubRepoRef {
  owner: string
  repo: string
}

export const parseGithubRepo = (repoFullName: string): GithubRepoRef => {
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
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  })

  if (!response.ok) {
    const body = await response.text()
    throw createError({
      statusCode: response.status,
      statusMessage: `GitHub API error: ${response.statusText}`,
      data: body
    })
  }

  return response.json() as Promise<T>
}

export const listRepoMarkdownFiles = async (
  token: string,
  repoFullName: string,
  baseBranch: string,
  contentPath: string
) => {
  const { owner, repo } = parseGithubRepo(repoFullName)
  const normalizedPath = contentPath.replace(/^\/+|\/+$/g, '')

  const tree = await githubRequest<{
    tree: Array<{ path: string, type: string }>
  }>(
    token,
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(baseBranch)}?recursive=1`
  )

  return tree.tree
    .filter(item => item.type === 'blob')
    .map(item => item.path)
    .filter((path) => {
      if (!normalizedPath) {
        return path.endsWith('.md')
      }
      return path.startsWith(`${normalizedPath}/`) && path.endsWith('.md')
    })
}

export const fetchRepoFileContent = async (
  token: string,
  repoFullName: string,
  path: string,
  ref: string
) => {
  const { owner, repo } = parseGithubRepo(repoFullName)
  const encodedPath = path.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const response = await githubRequest<{
    content?: string
    encoding?: string
  }>(
    token,
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`
  )

  if (!response.content || response.encoding !== 'base64') {
    throw createError({
      statusCode: 400,
      statusMessage: `Unable to read file content for ${path}.`
    })
  }

  return Buffer.from(response.content, 'base64').toString('utf8')
}

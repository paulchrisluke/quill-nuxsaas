import { Buffer } from 'buffer'
import { createError } from 'h3'

const GITHUB_API_BASE = 'https://api.github.com'

export interface GithubRepoRef {
  owner: string
  repo: string
}

export interface GithubRepoSummary {
  id: number
  fullName: string
  defaultBranch: string
  private: boolean
}

export interface GithubPullRequest {
  number: number
  state: string
  merged_at: string | null
  html_url: string
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

export const listUserRepos = async (token: string) => {
  const perPage = 100
  const maxPages = 5
  const repos: GithubRepoSummary[] = []

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await githubRequest<Array<{
      id: number
      full_name: string
      default_branch: string
      private: boolean
    }>>(
      token,
      `/user/repos?per_page=${perPage}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`
    )

    repos.push(...response.map(repo => ({
      id: repo.id,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      private: repo.private
    })))

    if (response.length < perPage) {
      break
    }
  }

  return repos
}

export const listRepoBranches = async (
  token: string,
  repoFullName: string
) => {
  const { owner, repo } = parseGithubRepo(repoFullName)
  const perPage = 100
  const branches: string[] = []
  let page = 1

  while (true) {
    const response = await githubRequest<Array<{ name: string }>>(
      token,
      `/repos/${owner}/${repo}/branches?per_page=${perPage}&page=${page}`
    )

    branches.push(...response.map(branch => branch.name))

    if (response.length < perPage) {
      break
    }
    page += 1
  }

  return branches
}

export const fetchPullRequest = async (
  token: string,
  repoFullName: string,
  pullNumber: number
) => {
  const { owner, repo } = parseGithubRepo(repoFullName)
  const response = await githubRequest<GithubPullRequest>(
    token,
    `/repos/${owner}/${repo}/pulls/${pullNumber}`
  )

  return response
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

export const listRepoMarkdownDirectories = async (
  token: string,
  repoFullName: string,
  baseBranch: string
) => {
  const { owner, repo } = parseGithubRepo(repoFullName)

  const tree = await githubRequest<{
    tree: Array<{ path: string, type: string }>
  }>(
    token,
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(baseBranch)}?recursive=1`
  )

  const dirs = new Set<string>()
  for (const item of tree.tree) {
    if (item.type !== 'blob' || !item.path.endsWith('.md')) {
      continue
    }
    const segments = item.path.split('/')
    segments.pop()
    const dir = segments.join('/')
    dirs.add(dir)
  }

  const sorted = Array.from(dirs).sort((a, b) => a.localeCompare(b))
  if (!sorted.includes('')) {
    sorted.unshift('')
  } else {
    sorted.sort((a, b) => {
      if (a === '') {
        return -1
      }
      if (b === '') {
        return 1
      }
      return a.localeCompare(b)
    })
  }
  return sorted
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

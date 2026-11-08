/** The server address a new GitLab sign-in starts with. */
export const DefaultGitLabServerURL = 'https://gitlab.com'

/** Why a GitLab server address was rejected. */
export type GitLabServerURLErrorKind = 'empty' | 'invalid' | 'insecure-protocol'

/** Thrown when a GitLab server address can't be used. */
export class GitLabServerURLError extends Error {
  public constructor(
    public readonly kind: GitLabServerURLErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'GitLabServerURLError'
  }
}

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Whether the host only reaches this computer. */
function isLoopbackHost(hostname: string): boolean {
  return loopbackHosts.has(hostname) || hostname.endsWith('.localhost')
}

/**
 * Turn what the user typed into the base URL of a GitLab server, such as
 * `https://gitlab.com` or `https://example.com/gitlab`.
 *
 * - Without a scheme, `https://` is assumed.
 * - A trailing slash and a pasted `/api/v4` suffix are dropped.
 * - Plain `http://` is only accepted for this computer (for example a local
 *   test server), because the access token would otherwise cross the network
 *   unencrypted.
 *
 * Throws a `GitLabServerURLError` when the address can't be used.
 */
export function normalizeGitLabServerURL(address: string): string {
  const trimmed = address.trim()
  if (trimmed.length === 0) {
    throw new GitLabServerURLError('empty', 'Enter your GitLab server address.')
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new GitLabServerURLError(
      'invalid',
      `"${trimmed}" isn't a valid server address.`
    )
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new GitLabServerURLError(
      'invalid',
      'The server address must start with https://.'
    )
  }

  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new GitLabServerURLError(
      'insecure-protocol',
      'Use https:// for this server. Plain http:// is only allowed for a server on this computer.'
    )
  }

  if (url.username !== '' || url.password !== '') {
    throw new GitLabServerURLError(
      'invalid',
      "Don't include a user name or password in the server address."
    )
  }

  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v4$/, '')
  return `${url.protocol}//${url.host}${path}`
}

/** The page where the user creates a personal access token on this server. */
export function getGitLabTokenSettingsURL(serverURL: string): string {
  return `${serverURL}/-/user_settings/personal_access_tokens`
}

import { isRecord } from '../is-record'

/** The GitLab user a personal access token belongs to. */
export interface IGitLabUser {
  readonly id: number
  readonly username: string
  readonly name: string
  readonly avatarURL: string | null
  readonly webURL: string | null
}

/** Why signing in to GitLab failed. */
export type GitLabSignInErrorKind =
  | 'invalid-token'
  | 'insufficient-scope'
  | 'unreachable'
  | 'not-gitlab'
  | 'unexpected'

/** Thrown when a GitLab server rejects or can't check a token. */
export class GitLabSignInError extends Error {
  public constructor(
    public readonly kind: GitLabSignInErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'GitLabSignInError'
  }
}

/** The subset of `fetch` the GitLab API client uses, so tests can stub it. */
export type GitLabFetch = (
  input: string,
  init: { readonly method: string; readonly headers: Record<string, string> }
) => Promise<Pick<Response, 'status' | 'json'>>

/** Parse a `GET /api/v4/user` response, or return null if it isn't one. */
export function parseGitLabUser(value: unknown): IGitLabUser | null {
  if (!isRecord(value)) {
    return null
  }

  const { id, username, name, avatar_url, web_url } = value
  if (typeof id !== 'number' || typeof username !== 'string') {
    return null
  }

  return {
    id,
    username,
    name: typeof name === 'string' && name.length > 0 ? name : username,
    avatarURL: typeof avatar_url === 'string' ? avatar_url : null,
    webURL: typeof web_url === 'string' ? web_url : null,
  }
}

/**
 * Look up the user a personal access token belongs to.
 *
 * Throws a `GitLabSignInError` that says what the user can do about it when
 * the server is unreachable, the token is rejected or lacks a scope, or the
 * server doesn't answer like GitLab.
 */
export async function fetchGitLabUser(
  serverURL: string,
  token: string,
  fetchImpl: GitLabFetch = (input, init) => fetch(input, init)
): Promise<IGitLabUser> {
  let response: Pick<Response, 'status' | 'json'>
  try {
    response = await fetchImpl(`${serverURL}/api/v4/user`, {
      method: 'GET',
      headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json' },
    })
  } catch (e) {
    log.warn(`[GitLab] couldn't reach ${serverURL}`, e)
    throw new GitLabSignInError(
      'unreachable',
      `Couldn't reach ${serverURL}. Check the address and your network connection.`
    )
  }

  if (response.status === 401) {
    throw new GitLabSignInError(
      'invalid-token',
      'GitLab rejected this token. Check that it is correct, active and not expired.'
    )
  }

  if (response.status === 403) {
    throw new GitLabSignInError(
      'insufficient-scope',
      'This token is missing a required scope. Create a token with the api scope.'
    )
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }

  if (response.status !== 200) {
    throw body === undefined
      ? new GitLabSignInError(
          'not-gitlab',
          `${serverURL} doesn't look like a GitLab server (HTTP ${response.status}).`
        )
      : new GitLabSignInError(
          'unexpected',
          `GitLab couldn't verify the token (HTTP ${response.status}). Try again later.`
        )
  }

  const user = parseGitLabUser(body)
  if (user === null) {
    throw new GitLabSignInError(
      'not-gitlab',
      `${serverURL} doesn't look like a GitLab server.`
    )
  }

  return user
}

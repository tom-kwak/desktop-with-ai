import { IGitLabAccount } from './gitlab-accounts-store'
import { findGitLabAccountForCredentialURL } from './gitlab-remote'

/** What the Git credential helper needs from the GitLab accounts. */
export interface IGitLabCredentialSource {
  isEnabled(): boolean
  getAll(): ReadonlyArray<IGitLabAccount>
  getToken(account: IGitLabAccount): Promise<string | null>
}

/**
 * GitLab accepts a personal access token as the password for Git over
 * HTTPS with any user name; `oauth2` is the one GitLab documents.
 */
export const GitLabGitUsername = 'oauth2'

/**
 * The user name and token for Git to use with a GitLab server the user is
 * signed in to, or null when the URL isn't on one (or GitLab is off).
 */
export async function getGitLabGitCredential(
  url: URL,
  source: IGitLabCredentialSource
): Promise<{ readonly username: string; readonly password: string } | null> {
  if (!source.isEnabled()) {
    return null
  }
  const account = findGitLabAccountForCredentialURL(url, source.getAll())
  if (account === null) {
    return null
  }
  const token = await source.getToken(account)
  return token === null
    ? null
    : { username: GitLabGitUsername, password: token }
}

/** Whether Git credentials for the URL come from a GitLab account. */
export function isGitLabAccountURL(
  url: URL,
  source: IGitLabCredentialSource
): boolean {
  return (
    source.isEnabled() &&
    findGitLabAccountForCredentialURL(url, source.getAll()) !== null
  )
}

import { TokenStore } from '../stores/token-store'
import { GitLabAccountsStore } from './gitlab-accounts-store'

let store: GitLabAccountsStore | null = null

/**
 * The app's GitLab accounts, backed by local storage and the system keychain.
 *
 * Kept outside the app store so the GitLab sign-in can't change how the
 * GitHub accounts are loaded or refreshed.
 */
export function getGitLabAccountsStore(): GitLabAccountsStore {
  if (store === null) {
    store = new GitLabAccountsStore(localStorage, TokenStore)
  }
  return store
}

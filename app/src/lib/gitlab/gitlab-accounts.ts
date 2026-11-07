import { TokenStore } from '../stores/token-store'
import { GitLabAccountsStore } from './gitlab-accounts-store'
import { GitLabProjectsStore } from './gitlab-projects'
import { GitLabSettings } from './gitlab-settings'

let store: GitLabAccountsStore | null = null
let projectsStore: GitLabProjectsStore | null = null
let settings: GitLabSettings | null = null

/** The switch for all GitLab features, stored in local storage. */
export function getGitLabSettings(): GitLabSettings {
  if (settings === null) {
    settings = new GitLabSettings(localStorage)
  }
  return settings
}

/** Whether GitLab features should be shown right now. */
export function isGitLabEnabled(): boolean {
  return getGitLabSettings().isEnabled()
}

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

/** The project lists of the signed-in GitLab accounts. */
export function getGitLabProjectsStore(): GitLabProjectsStore {
  if (projectsStore === null) {
    const accounts = getGitLabAccountsStore()
    const projects = new GitLabProjectsStore(account =>
      accounts.getToken(account)
    )
    accounts.onDidUpdate(all => projects.retainOnly(all))
    projectsStore = projects
  }
  return projectsStore
}

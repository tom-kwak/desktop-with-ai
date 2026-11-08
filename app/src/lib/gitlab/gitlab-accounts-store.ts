import { Disposable, Emitter } from 'event-kit'
import { IDataStore, ISecureStore } from '../stores/stores'
import { isRecord } from '../is-record'
import { GitLabFetch, fetchGitLabUser } from './gitlab-api'
import { normalizeGitLabServerURL } from './gitlab-server-url'

/**
 * A GitLab account signed in with a personal access token.
 *
 * The token itself lives in the system keychain, not here, so this is safe to
 * keep in local storage and pass around the UI.
 */
export interface IGitLabAccount {
  /** Base URL of the GitLab server, as from `normalizeGitLabServerURL`. */
  readonly serverURL: string
  readonly id: number
  readonly username: string
  readonly name: string
  readonly avatarURL: string | null
  readonly webURL: string | null
}

/** The local storage key holding the signed-in GitLab accounts. */
export const GitLabAccountsStorageKey = 'reviewdesk-gitlab-accounts'

/** The keychain service name for a GitLab server's token. */
export function getGitLabTokenKey(serverURL: string): string {
  const appName = __DEV__ ? 'ReviewDesk Dev GitLab' : 'ReviewDesk GitLab'
  return `${appName} - ${serverURL}`
}

function parseStoredAccount(value: unknown): IGitLabAccount | null {
  if (!isRecord(value)) {
    return null
  }

  const { serverURL, id, username, name, avatarURL, webURL } = value
  if (
    typeof serverURL !== 'string' ||
    typeof id !== 'number' ||
    typeof username !== 'string' ||
    typeof name !== 'string'
  ) {
    return null
  }

  return {
    serverURL,
    id,
    username,
    name,
    avatarURL: typeof avatarURL === 'string' ? avatarURL : null,
    webURL: typeof webURL === 'string' ? webURL : null,
  }
}

/**
 * The GitLab accounts the user has signed in to, one per server.
 *
 * This is deliberately separate from the GitHub `AccountsStore`, so GitHub
 * sign-in, token refresh and repository matching are unaffected by GitLab.
 */
export class GitLabAccountsStore {
  private readonly emitter = new Emitter()
  private accounts: ReadonlyArray<IGitLabAccount>

  public constructor(
    private readonly dataStore: IDataStore,
    private readonly secureStore: ISecureStore
  ) {
    this.accounts = this.load()
  }

  private load(): ReadonlyArray<IGitLabAccount> {
    const raw = this.dataStore.getItem(GitLabAccountsStorageKey)
    if (!raw) {
      return []
    }

    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        return []
      }
      const accounts = new Array<IGitLabAccount>()
      for (const item of parsed) {
        const account = parseStoredAccount(item)
        if (account !== null) {
          accounts.push(account)
        }
      }
      return accounts
    } catch (e) {
      log.error('[GitLab] ignoring unreadable stored accounts', e)
      return []
    }
  }

  private save(accounts: ReadonlyArray<IGitLabAccount>) {
    this.accounts = accounts
    this.dataStore.setItem(GitLabAccountsStorageKey, JSON.stringify(accounts))
    this.emitter.emit('did-update', accounts)
  }

  /** The signed-in accounts, in the order they were added. */
  public getAll(): ReadonlyArray<IGitLabAccount> {
    return this.accounts
  }

  /** Call `fn` with the new list whenever an account is added or removed. */
  public onDidUpdate(
    fn: (accounts: ReadonlyArray<IGitLabAccount>) => void
  ): Disposable {
    return this.emitter.on('did-update', fn)
  }

  /**
   * Check a personal access token with the server and remember the account.
   *
   * Signing in to a server that already has an account replaces it. Throws a
   * `GitLabServerURLError` for an unusable address and a `GitLabSignInError`
   * when the server rejects the token, leaving stored accounts unchanged.
   */
  public async signIn(
    serverAddress: string,
    token: string,
    fetchImpl?: GitLabFetch
  ): Promise<IGitLabAccount> {
    const serverURL = normalizeGitLabServerURL(serverAddress)
    const trimmedToken = token.trim()
    const user = await fetchGitLabUser(serverURL, trimmedToken, fetchImpl)

    const account: IGitLabAccount = {
      serverURL,
      id: user.id,
      username: user.username,
      name: user.name,
      avatarURL: user.avatarURL,
      webURL: user.webURL,
    }

    const previous = this.accounts.find(a => a.serverURL === serverURL)
    const key = getGitLabTokenKey(serverURL)
    await this.secureStore.setItem(key, account.username, trimmedToken)
    if (previous !== undefined && previous.username !== account.username) {
      await this.deleteToken(previous)
    }

    this.save([
      ...this.accounts.filter(a => a.serverURL !== serverURL),
      account,
    ])
    return account
  }

  /** Forget the account and delete its token from the keychain. */
  public async signOut(account: IGitLabAccount): Promise<void> {
    await this.deleteToken(account)
    this.save(this.accounts.filter(a => a.serverURL !== account.serverURL))
  }

  /** The account's token, or null if the keychain no longer has it. */
  public getToken(account: IGitLabAccount): Promise<string | null> {
    return this.secureStore.getItem(
      getGitLabTokenKey(account.serverURL),
      account.username
    )
  }

  private async deleteToken(account: IGitLabAccount) {
    try {
      await this.secureStore.deleteItem(
        getGitLabTokenKey(account.serverURL),
        account.username
      )
    } catch (e) {
      log.error(`[GitLab] couldn't delete token for ${account.serverURL}`, e)
    }
  }
}

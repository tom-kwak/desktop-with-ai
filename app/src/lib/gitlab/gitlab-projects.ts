import { Disposable, Emitter } from 'event-kit'
import { isRecord } from '../is-record'
import { IGitLabAccount } from './gitlab-accounts-store'

/** A GitLab project the signed-in user is a member of. */
export interface IGitLabProject {
  readonly id: number
  readonly name: string
  /** For example `group/subgroup/project`. */
  readonly pathWithNamespace: string
  /** For example `group/subgroup`, or the user name for personal projects. */
  readonly namespacePath: string
  /** Whether the project lives in a user's personal namespace. */
  readonly isPersonal: boolean
  readonly httpCloneURL: string
  readonly sshCloneURL: string | null
  readonly webURL: string
  /** `private`, `internal` or `public`; null when GitLab leaves it out. */
  readonly visibility: string | null
}

/** A response from the GitLab API, as much of it as the client reads. */
export interface IGitLabListResponse {
  readonly status: number
  readonly headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

/** The subset of `fetch` the project list uses, so tests can stub it. */
export type GitLabListFetch = (
  input: string,
  init: { readonly method: string; readonly headers: Record<string, string> }
) => Promise<IGitLabListResponse>

/** Thrown when GitLab can't list the user's projects. */
export class GitLabProjectsError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'GitLabProjectsError'
  }
}

/** Stop after this many pages (100 projects each) so a bad server can't loop us. */
const MaxPages = 50

/** Parse one entry of `GET /api/v4/projects`, or return null if it isn't one. */
export function parseGitLabProject(value: unknown): IGitLabProject | null {
  if (!isRecord(value)) {
    return null
  }

  const {
    id,
    name,
    path_with_namespace,
    namespace,
    http_url_to_repo,
    ssh_url_to_repo,
    web_url,
    visibility,
  } = value

  if (
    typeof id !== 'number' ||
    typeof name !== 'string' ||
    typeof path_with_namespace !== 'string' ||
    typeof http_url_to_repo !== 'string' ||
    typeof web_url !== 'string'
  ) {
    return null
  }

  const namespaceFullPath =
    isRecord(namespace) && typeof namespace.full_path === 'string'
      ? namespace.full_path
      : path_with_namespace.split('/').slice(0, -1).join('/')

  return {
    id,
    name,
    pathWithNamespace: path_with_namespace,
    namespacePath: namespaceFullPath,
    isPersonal: isRecord(namespace) && namespace.kind === 'user',
    httpCloneURL: http_url_to_repo,
    sshCloneURL: typeof ssh_url_to_repo === 'string' ? ssh_url_to_repo : null,
    webURL: web_url,
    visibility: typeof visibility === 'string' ? visibility : null,
  }
}

function projectsPageURL(serverURL: string, page: number) {
  const query = new URLSearchParams({
    membership: 'true',
    simple: 'true',
    archived: 'false',
    order_by: 'last_activity_at',
    per_page: '100',
    page: String(page),
  })
  return `${serverURL}/api/v4/projects?${query}`
}

/**
 * Load the non-archived projects the token's user is a member of, one page
 * at a time, calling `onPage` with each page as it arrives.
 *
 * Throws a `GitLabProjectsError` that says what the user can do about it.
 */
export async function fetchGitLabProjects(
  serverURL: string,
  token: string,
  onPage: (projects: ReadonlyArray<IGitLabProject>) => void,
  fetchImpl: GitLabListFetch = (input, init) => fetch(input, init)
): Promise<void> {
  let page = 1
  for (let pagesLoaded = 0; pagesLoaded < MaxPages; pagesLoaded++) {
    let response: IGitLabListResponse
    try {
      response = await fetchImpl(projectsPageURL(serverURL, page), {
        method: 'GET',
        headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json' },
      })
    } catch (e) {
      log.warn(`[GitLab] couldn't reach ${serverURL}`, e)
      throw new GitLabProjectsError(
        `Couldn't reach ${serverURL}. Check your network connection and try again.`
      )
    }

    if (response.status === 401) {
      throw new GitLabProjectsError(
        `GitLab rejected the token for ${serverURL}. It may have expired; sign in again in Preferences > Accounts.`
      )
    }

    if (response.status === 403) {
      throw new GitLabProjectsError(
        `The token for ${serverURL} can't list projects. Use a token with the api or read_api scope.`
      )
    }

    if (response.status !== 200) {
      throw new GitLabProjectsError(
        `GitLab couldn't list your projects (HTTP ${response.status}). Try again later.`
      )
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }

    if (!Array.isArray(body)) {
      throw new GitLabProjectsError(
        `${serverURL} returned an unexpected project list.`
      )
    }

    const projects = new Array<IGitLabProject>()
    for (const item of body) {
      const project = parseGitLabProject(item)
      if (project !== null) {
        projects.push(project)
      }
    }
    onPage(projects)

    const next = Number.parseInt(response.headers.get('X-Next-Page') ?? '', 10)
    if (!Number.isFinite(next) || next <= page) {
      return
    }
    page = next
  }

  log.warn(`[GitLab] stopped listing projects after ${MaxPages} pages`)
}

/** What the clone dialog knows about one server's project list. */
export interface IGitLabProjectsState {
  readonly loading: boolean
  /** Null until the first load finishes or fails. */
  readonly projects: ReadonlyArray<IGitLabProject> | null
  readonly error: Error | null
}

/** Project lists are per server and user. */
function accountKey(account: IGitLabAccount) {
  return `${account.serverURL}#${account.username}`
}

/**
 * The project lists of the signed-in GitLab accounts, kept in memory and
 * loaded on demand, like the GitHub repository list in the clone dialog.
 */
export class GitLabProjectsStore {
  private readonly emitter = new Emitter()
  private state: ReadonlyMap<string, IGitLabProjectsState> = new Map()

  public constructor(
    private readonly getToken: (
      account: IGitLabAccount
    ) => Promise<string | null>,
    private readonly fetchImpl?: GitLabListFetch
  ) {}

  /** The current state for the account's server, if it was ever loaded. */
  public getState(account: IGitLabAccount): IGitLabProjectsState | undefined {
    return this.state.get(accountKey(account))
  }

  /** Call `fn` whenever any project list changes. */
  public onDidUpdate(fn: () => void): Disposable {
    return this.emitter.on('did-update', fn)
  }

  private update(key: string, patch: Partial<IGitLabProjectsState>) {
    const previous = this.state.get(key) ?? {
      loading: false,
      projects: null,
      error: null,
    }
    const next = new Map(this.state)
    next.set(key, { ...previous, ...patch })
    this.state = next
    this.emitter.emit('did-update')
  }

  /**
   * (Re)load the account's projects. A list that was already loaded stays
   * visible until the new one is complete; a first load shows pages as
   * they arrive.
   */
  public async load(account: IGitLabAccount): Promise<void> {
    const { serverURL } = account
    const key = accountKey(account)
    const current = this.state.get(key)
    if (current?.loading) {
      return
    }

    this.update(key, { loading: true, error: null })

    try {
      const token = await this.getToken(account)
      if (token === null) {
        throw new GitLabProjectsError(
          `The token for ${serverURL} is missing from the keychain. Sign in again in Preferences > Accounts.`
        )
      }

      const firstLoad = current?.projects == null
      const loaded = new Map<number, IGitLabProject>()
      await fetchGitLabProjects(
        serverURL,
        token,
        page => {
          page.forEach(p => loaded.set(p.id, p))
          if (firstLoad) {
            this.update(key, { projects: [...loaded.values()] })
          }
        },
        this.fetchImpl
      )

      this.update(key, { loading: false, projects: [...loaded.values()] })
    } catch (e) {
      this.update(key, {
        loading: false,
        error: e instanceof Error ? e : new Error(String(e)),
      })
    }
  }

  /** Drop the lists of servers that no longer have a signed-in account. */
  public retainOnly(accounts: ReadonlyArray<IGitLabAccount>) {
    const keep = new Set(accounts.map(accountKey))
    if ([...this.state.keys()].every(k => keep.has(k))) {
      return
    }
    this.state = new Map([...this.state].filter(([k]) => keep.has(k)))
    this.emitter.emit('did-update')
  }
}

import { isRecord } from '../is-record'

/** A response from the GitLab API, as much of it as the client reads. */
export interface IGitLabResponse {
  readonly status: number
  json(): Promise<unknown>
}

/** The subset of `fetch` the merge request client uses, so tests can stub it. */
export type GitLabRequestFetch = (
  input: string,
  init: {
    readonly method: string
    readonly headers: Record<string, string>
    readonly body?: string
  }
) => Promise<IGitLabResponse>

/** A failed GitLab API request, with a message for the user. */
export class GitLabAPIError extends Error {
  public constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'GitLabAPIError'
  }
}

/** Where and as whom to call the GitLab API. */
export interface IGitLabConnection {
  readonly serverURL: string
  readonly token: string
  readonly fetch?: GitLabRequestFetch
}

/**
 * Turn a GitLab error body into one line. GitLab sends `message` as a
 * string, a list of strings, or field errors like `{ title: ["can't be
 * blank"] }`, and sometimes `error` / `error_description` instead.
 */
export function describeGitLabError(body: unknown): string | null {
  if (!isRecord(body)) {
    return null
  }

  const { message, error, error_description } = body
  if (typeof message === 'string') {
    return message
  }
  if (Array.isArray(message)) {
    return message.filter(m => typeof m === 'string').join(' ')
  }
  if (isRecord(message)) {
    return Object.entries(message)
      .map(([field, problems]) =>
        Array.isArray(problems)
          ? `${field} ${problems.filter(p => typeof p === 'string').join(', ')}`
          : field
      )
      .join('; ')
  }
  if (typeof error_description === 'string') {
    return error_description
  }
  if (typeof error === 'string') {
    return error
  }
  return null
}

async function request(
  connection: IGitLabConnection,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const fetchImpl: GitLabRequestFetch =
    connection.fetch ?? ((input, init) => fetch(input, init))
  const headers: Record<string, string> = {
    'PRIVATE-TOKEN': connection.token,
    Accept: 'application/json',
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  let response: IGitLabResponse
  try {
    response = await fetchImpl(`${connection.serverURL}/api/v4${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    log.warn(`[GitLab] ${method} ${path} failed`, e)
    throw new GitLabAPIError(
      0,
      `Couldn't reach ${connection.serverURL}. Check your network connection and try again.`
    )
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    json = undefined
  }

  if (response.status >= 200 && response.status < 300) {
    return json
  }

  const detail = describeGitLabError(json)
  switch (response.status) {
    case 401:
      throw new GitLabAPIError(
        401,
        'GitLab rejected the token. It may have expired; sign in again in Preferences > Accounts.'
      )
    case 403:
      throw new GitLabAPIError(
        403,
        `You don't have permission to do this on GitLab.${
          detail ? ` GitLab says: ${detail}` : ''
        }`
      )
    case 404:
      throw new GitLabAPIError(
        404,
        "GitLab couldn't find this project or merge request, or you can't see it."
      )
    default:
      throw new GitLabAPIError(
        response.status,
        detail ?? `GitLab returned HTTP ${response.status}.`
      )
  }
}

const projectRef = (projectPath: string) => encodeURIComponent(projectPath)

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** The bits of a GitLab project the merge request features need. */
export interface IGitLabProjectInfo {
  readonly id: number
  readonly pathWithNamespace: string
  readonly defaultBranch: string | null
  readonly webURL: string
}

/** A GitLab user, as shown next to merge requests and comments. */
export interface IGitLabUserRef {
  readonly username: string
  readonly name: string
}

/** A GitLab merge request. */
export interface IGitLabMergeRequest {
  readonly iid: number
  readonly title: string
  readonly description: string
  /** `opened`, `closed`, `merged` or `locked`. */
  readonly state: string
  readonly draft: boolean
  readonly sourceBranch: string
  readonly targetBranch: string
  readonly author: IGitLabUserRef | null
  readonly webURL: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly userNotesCount: number
}

/** A comment on a merge request. */
export interface IGitLabNote {
  readonly id: number
  readonly body: string
  readonly author: IGitLabUserRef | null
  readonly createdAt: string
  /** System notes record events such as "added 1 commit". */
  readonly system: boolean
}

function parseUser(value: unknown): IGitLabUserRef | null {
  if (!isRecord(value) || typeof value.username !== 'string') {
    return null
  }
  return {
    username: value.username,
    name: str(value.name) ?? value.username,
  }
}

export function parseProjectInfo(value: unknown): IGitLabProjectInfo | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    typeof value.path_with_namespace !== 'string' ||
    typeof value.web_url !== 'string'
  ) {
    return null
  }
  return {
    id: value.id,
    pathWithNamespace: value.path_with_namespace,
    defaultBranch: str(value.default_branch),
    webURL: value.web_url,
  }
}

export function parseMergeRequest(value: unknown): IGitLabMergeRequest | null {
  if (
    !isRecord(value) ||
    typeof value.iid !== 'number' ||
    typeof value.title !== 'string' ||
    typeof value.source_branch !== 'string' ||
    typeof value.target_branch !== 'string' ||
    typeof value.web_url !== 'string'
  ) {
    return null
  }
  return {
    iid: value.iid,
    title: value.title,
    description: str(value.description) ?? '',
    state: str(value.state) ?? 'opened',
    draft: value.draft === true || value.work_in_progress === true,
    sourceBranch: value.source_branch,
    targetBranch: value.target_branch,
    author: parseUser(value.author),
    webURL: value.web_url,
    createdAt: str(value.created_at) ?? '',
    updatedAt: str(value.updated_at) ?? '',
    userNotesCount:
      typeof value.user_notes_count === 'number' ? value.user_notes_count : 0,
  }
}

export function parseNote(value: unknown): IGitLabNote | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    typeof value.body !== 'string'
  ) {
    return null
  }
  return {
    id: value.id,
    body: value.body,
    author: parseUser(value.author),
    createdAt: str(value.created_at) ?? '',
    system: value.system === true,
  }
}

function parseList<T>(
  value: unknown,
  parse: (item: unknown) => T | null
): ReadonlyArray<T> {
  if (!Array.isArray(value)) {
    throw new GitLabAPIError(200, 'GitLab returned an unexpected response.')
  }
  const items = new Array<T>()
  for (const item of value) {
    const parsed = parse(item)
    if (parsed !== null) {
      items.push(parsed)
    }
  }
  return items
}

function parseOne<T>(value: unknown, parse: (item: unknown) => T | null): T {
  const parsed = parse(value)
  if (parsed === null) {
    throw new GitLabAPIError(200, 'GitLab returned an unexpected response.')
  }
  return parsed
}

/** Look up a project by its path, e.g. `group/subgroup/project`. */
export async function fetchProjectInfo(
  connection: IGitLabConnection,
  projectPath: string
): Promise<IGitLabProjectInfo> {
  const body = await request(
    connection,
    'GET',
    `/projects/${projectRef(projectPath)}`
  )
  return parseOne(body, parseProjectInfo)
}

/** The project's branch names, for choosing a merge request target. */
export async function fetchBranchNames(
  connection: IGitLabConnection,
  projectId: number
): Promise<ReadonlyArray<string>> {
  const body = await request(
    connection,
    'GET',
    `/projects/${projectId}/repository/branches?per_page=100`
  )
  return parseList(body, item =>
    isRecord(item) && typeof item.name === 'string' ? item.name : null
  )
}

/** The project's merge requests in the given state, most recently updated first. */
export async function fetchMergeRequests(
  connection: IGitLabConnection,
  projectId: number,
  state: 'opened' | 'merged' | 'closed' | 'all' = 'opened'
): Promise<ReadonlyArray<IGitLabMergeRequest>> {
  const body = await request(
    connection,
    'GET',
    `/projects/${projectId}/merge_requests?state=${state}&order_by=updated_at&sort=desc&per_page=50`
  )
  return parseList(body, parseMergeRequest)
}

/** Open a merge request from `sourceBranch` into `targetBranch`. */
export async function createMergeRequest(
  connection: IGitLabConnection,
  projectId: number,
  options: {
    readonly sourceBranch: string
    readonly targetBranch: string
    readonly title: string
    readonly description: string
  }
): Promise<IGitLabMergeRequest> {
  const body = await request(
    connection,
    'POST',
    `/projects/${projectId}/merge_requests`,
    {
      source_branch: options.sourceBranch,
      target_branch: options.targetBranch,
      title: options.title,
      description: options.description,
      remove_source_branch: false,
    }
  )
  return parseOne(body, parseMergeRequest)
}

/** A merge request's comments, oldest first, without system notes. */
export async function fetchMergeRequestComments(
  connection: IGitLabConnection,
  projectId: number,
  iid: number
): Promise<ReadonlyArray<IGitLabNote>> {
  const body = await request(
    connection,
    'GET',
    `/projects/${projectId}/merge_requests/${iid}/notes?sort=asc&order_by=created_at&per_page=100`
  )
  return parseList(body, parseNote).filter(n => !n.system)
}

/** Add a comment to a merge request. */
export async function addMergeRequestComment(
  connection: IGitLabConnection,
  projectId: number,
  iid: number,
  text: string
): Promise<IGitLabNote> {
  const body = await request(
    connection,
    'POST',
    `/projects/${projectId}/merge_requests/${iid}/notes`,
    { body: text }
  )
  return parseOne(body, parseNote)
}

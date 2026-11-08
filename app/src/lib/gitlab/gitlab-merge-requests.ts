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

/** Call the GitLab API and return the parsed JSON body. */
export async function request(
  connection: IGitLabConnection,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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

export function str(value: unknown): string | null {
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
  /** The latest commit of the source branch, or null if GitLab didn't say. */
  readonly headSha: string | null
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

export function parseUser(value: unknown): IGitLabUserRef | null {
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
    headSha: str(value.sha),
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

export function parseList<T>(
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

export function parseOne<T>(
  value: unknown,
  parse: (item: unknown) => T | null
): T {
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

export type GitLabMergeRequestState = 'opened' | 'merged' | 'closed' | 'all'

/** Narrow a merge request list to the ones a user wrote or reviews. */
export interface IGitLabMergeRequestFilter {
  readonly authorUsername?: string
  readonly reviewerUsername?: string
}

/** The project's merge requests in the given state, most recently updated first. */
export async function fetchMergeRequests(
  connection: IGitLabConnection,
  projectId: number,
  state: GitLabMergeRequestState = 'opened',
  filter: IGitLabMergeRequestFilter = {}
): Promise<ReadonlyArray<IGitLabMergeRequest>> {
  const query = new URLSearchParams({
    state,
    order_by: 'updated_at',
    sort: 'desc',
    per_page: '50',
  })
  if (filter.authorUsername !== undefined) {
    query.set('author_username', filter.authorUsername)
  }
  if (filter.reviewerUsername !== undefined) {
    query.set('reviewer_username', filter.reviewerUsername)
  }
  const body = await request(
    connection,
    'GET',
    `/projects/${projectId}/merge_requests?${query}`
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
    readonly reviewerIds?: ReadonlyArray<number>
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
      ...(options.reviewerIds !== undefined && options.reviewerIds.length > 0
        ? { reviewer_ids: options.reviewerIds }
        : {}),
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

/** Where in the diff a line comment was left. */
export interface IGitLabNotePosition {
  readonly oldPath: string
  readonly newPath: string
  /** Line in the old file; null for an added line. */
  readonly oldLine: number | null
  /** Line in the new file; null for a removed line. */
  readonly newLine: number | null
  /** First line of a multi-line comment, when it spans several lines. */
  readonly startOldLine: number | null
  readonly startNewLine: number | null
  /** The commit the comment was made against. */
  readonly headSha: string | null
}

/** A comment thread: a general comment, or a comment on lines of the diff. */
export interface IGitLabDiscussion {
  readonly id: string
  /** The comment and its replies, oldest first, without system notes. */
  readonly notes: ReadonlyArray<IGitLabNote>
  /** Set for comments on lines of the diff. */
  readonly position: IGitLabNotePosition | null
  readonly resolved: boolean
}

export function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

export function parseNotePosition(value: unknown): IGitLabNotePosition | null {
  if (!isRecord(value) || value.position_type !== 'text') {
    return null
  }
  const oldPath = str(value.old_path)
  const newPath = str(value.new_path)
  if (oldPath === null && newPath === null) {
    return null
  }
  const oldLine = num(value.old_line)
  const newLine = num(value.new_line)
  if (oldLine === null && newLine === null) {
    return null
  }

  const range = isRecord(value.line_range) ? value.line_range : null
  const start = range !== null && isRecord(range.start) ? range.start : null

  return {
    oldPath: oldPath ?? newPath ?? '',
    newPath: newPath ?? oldPath ?? '',
    oldLine,
    newLine,
    startOldLine: start !== null ? num(start.old_line) : null,
    startNewLine: start !== null ? num(start.new_line) : null,
    headSha: str(value.head_sha),
  }
}

export function parseDiscussion(value: unknown): IGitLabDiscussion | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !Array.isArray(value.notes)
  ) {
    return null
  }
  const all = value.notes.filter(isRecord)
  const notes = new Array<IGitLabNote>()
  for (const item of all) {
    const note = parseNote(item)
    if (note !== null && !note.system) {
      notes.push(note)
    }
  }
  if (notes.length === 0) {
    return null
  }

  const first = all[0]
  const position =
    first.type === 'DiffNote' ? parseNotePosition(first.position) : null
  const resolvable = all.filter(n => n.resolvable === true)

  return {
    id: value.id,
    notes,
    position,
    resolved: resolvable.length > 0 && resolvable.every(n => n.resolved),
  }
}

/** A merge request's comment threads, oldest first. */
export async function fetchMergeRequestDiscussions(
  connection: IGitLabConnection,
  projectId: number,
  iid: number
): Promise<ReadonlyArray<IGitLabDiscussion>> {
  const body = await request(
    connection,
    'GET',
    `/projects/${projectId}/merge_requests/${iid}/discussions?per_page=100`
  )
  return parseList(body, parseDiscussion)
}

/** One changed file of a merge request, with its unified diff. */
export interface IGitLabDiffFile {
  readonly oldPath: string
  readonly newPath: string
  /** Empty when GitLab left the diff out, e.g. because it is too large. */
  readonly diff: string
}

function parseDiffFile(value: unknown): IGitLabDiffFile | null {
  if (!isRecord(value)) {
    return null
  }
  const oldPath = str(value.old_path)
  const newPath = str(value.new_path)
  if (oldPath === null || newPath === null) {
    return null
  }
  return { oldPath, newPath, diff: str(value.diff) ?? '' }
}

/**
 * The changed files of a merge request. Uses `/diffs` (GitLab 15.7 and
 * later) and falls back to the older `/changes` endpoint.
 */
export async function fetchMergeRequestDiffs(
  connection: IGitLabConnection,
  projectId: number,
  iid: number
): Promise<ReadonlyArray<IGitLabDiffFile>> {
  const base = `/projects/${projectId}/merge_requests/${iid}`
  try {
    const body = await request(connection, 'GET', `${base}/diffs?per_page=100`)
    return parseList(body, parseDiffFile)
  } catch (e) {
    if (!(e instanceof GitLabAPIError) || e.status !== 404) {
      throw e
    }
  }
  const body = await request(connection, 'GET', `${base}/changes`)
  return parseList(isRecord(body) ? body.changes : body, parseDiffFile)
}

/** A line of a diff excerpt shown above a line comment. */
export interface IDiffExcerptLine {
  readonly kind: 'add' | 'delete' | 'context'
  readonly oldLine: number | null
  readonly newLine: number | null
  readonly text: string
  /** Whether the comment is on this line. */
  readonly commented: boolean
}

interface IParsedDiffLine extends IDiffExcerptLine {
  readonly hunk: number
}

function parseUnifiedDiff(diff: string): ReadonlyArray<IParsedDiffLine> {
  const lines = new Array<IParsedDiffLine>()
  let hunk = -1
  let oldLine = 0
  let newLine = 0

  for (const raw of diff.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (header !== null) {
      hunk++
      oldLine = parseInt(header[1], 10)
      newLine = parseInt(header[2], 10)
      continue
    }
    if (hunk < 0) {
      continue
    }
    const marker = raw.charAt(0)
    const text = raw.slice(1)
    if (marker === '+') {
      lines.push({
        kind: 'add',
        oldLine: null,
        newLine,
        text,
        commented: false,
        hunk,
      })
      newLine++
    } else if (marker === '-') {
      lines.push({
        kind: 'delete',
        oldLine,
        newLine: null,
        text,
        commented: false,
        hunk,
      })
      oldLine++
    } else if (marker === ' ') {
      lines.push({
        kind: 'context',
        oldLine,
        newLine,
        text,
        commented: false,
        hunk,
      })
      oldLine++
      newLine++
    }
  }
  return lines
}

function findLine(
  lines: ReadonlyArray<IParsedDiffLine>,
  oldLine: number | null,
  newLine: number | null
) {
  return newLine !== null
    ? lines.findIndex(l => l.newLine === newLine)
    : lines.findIndex(l => l.kind === 'delete' && l.oldLine === oldLine)
}

/**
 * The lines of a diff a line comment refers to, with a few lines of
 * context above them, like GitLab shows above a comment thread. Returns
 * null when the commented lines aren't in the diff.
 */
export function getDiffExcerpt(
  files: ReadonlyArray<IGitLabDiffFile>,
  position: IGitLabNotePosition,
  contextLines = 3
): ReadonlyArray<IDiffExcerptLine> | null {
  const file =
    files.find(f => f.newPath === position.newPath) ??
    files.find(f => f.oldPath === position.oldPath)
  if (file === undefined) {
    return null
  }

  const lines = parseUnifiedDiff(file.diff)
  const end = findLine(lines, position.oldLine, position.newLine)
  if (end < 0) {
    return null
  }

  let start = end
  if (position.startOldLine !== null || position.startNewLine !== null) {
    const found = findLine(lines, position.startOldLine, position.startNewLine)
    if (found >= 0 && found <= end && lines[found].hunk === lines[end].hunk) {
      start = found
    }
  }

  let first = Math.max(0, start - contextLines)
  while (lines[first].hunk !== lines[end].hunk) {
    first++
  }

  return lines.slice(first, end + 1).map((l, i) => ({
    kind: l.kind,
    oldLine: l.oldLine,
    newLine: l.newLine,
    text: l.text,
    commented: first + i >= start,
  }))
}

/** A row of a diff as the Changes tab shows it. */
export type DiffDisplayRow =
  | { readonly kind: 'hunk'; readonly text: string }
  | {
      readonly kind: 'add' | 'delete' | 'context'
      readonly oldLine: number | null
      readonly newLine: number | null
      readonly text: string
    }

/** Split a unified diff into hunk headers and numbered lines. */
export function parseDiffForDisplay(
  diff: string
): ReadonlyArray<DiffDisplayRow> {
  const rows = new Array<DiffDisplayRow>()
  let oldLine = 0
  let newLine = 0
  let started = false

  for (const raw of diff.split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (header !== null) {
      started = true
      oldLine = parseInt(header[1], 10)
      newLine = parseInt(header[2], 10)
      rows.push({ kind: 'hunk', text: raw })
      continue
    }
    if (!started) {
      continue
    }
    const marker = raw.charAt(0)
    const text = raw.slice(1)
    if (marker === '+') {
      rows.push({ kind: 'add', oldLine: null, newLine: newLine++, text })
    } else if (marker === '-') {
      rows.push({ kind: 'delete', oldLine: oldLine++, newLine: null, text })
    } else if (marker === ' ') {
      rows.push({
        kind: 'context',
        oldLine: oldLine++,
        newLine: newLine++,
        text,
      })
    }
  }
  return rows
}

import { isRecord } from '../is-record'
import {
  IGitLabConnection,
  IGitLabDiscussion,
  IGitLabMergeRequest,
  IGitLabNote,
  IGitLabUserRef,
  num,
  parseDiscussion,
  parseList,
  parseMergeRequest,
  parseNote,
  parseOne,
  parseUser,
  request,
  str,
} from './gitlab-merge-requests'

const mrPath = (projectId: number, iid: number) =>
  `/projects/${projectId}/merge_requests/${iid}`

/** A GitLab user that can be picked as reviewer or assignee. */
export interface IGitLabMember extends IGitLabUserRef {
  readonly id: number
}

function parseMember(value: unknown): IGitLabMember | null {
  const user = parseUser(value)
  if (user === null || !isRecord(value) || typeof value.id !== 'number') {
    return null
  }
  return { ...user, id: value.id }
}

/** The latest pipeline of a merge request. */
export interface IGitLabPipeline {
  readonly id: number
  /** e.g. `success`, `failed`, `running`, `pending`, `canceled`, `skipped`. */
  readonly status: string
  readonly webURL: string | null
}

/** The commits a merge request is based on, used to place line comments. */
export interface IGitLabDiffRefs {
  readonly baseSha: string
  readonly startSha: string
  readonly headSha: string
}

/** Everything the merge request page shows beyond the list entry. */
export interface IGitLabMergeRequestDetails {
  readonly mergeRequest: IGitLabMergeRequest
  readonly reviewers: ReadonlyArray<IGitLabMember>
  readonly assignees: ReadonlyArray<IGitLabMember>
  readonly labels: ReadonlyArray<string>
  /**
   * GitLab's verdict on whether it can merge, e.g. `mergeable`,
   * `ci_still_running`, `not_approved`, `conflict`, `draft_status`,
   * `discussions_not_resolved`, `need_rebase`, `checking`.
   */
  readonly mergeStatus: string
  readonly hasConflicts: boolean
  readonly pipeline: IGitLabPipeline | null
  readonly diffRefs: IGitLabDiffRefs | null
  readonly changesCount: string | null
  /** Whether the source branch is deleted after merging, as GitLab will do. */
  readonly forceRemoveSourceBranch: boolean
  readonly squash: boolean
  readonly mergedBy: IGitLabUserRef | null
}

function parseMembers(value: unknown): ReadonlyArray<IGitLabMember> {
  return Array.isArray(value)
    ? value.map(parseMember).filter((m): m is IGitLabMember => m !== null)
    : []
}

export function parseMergeRequestDetails(
  value: unknown
): IGitLabMergeRequestDetails | null {
  const mergeRequest = parseMergeRequest(value)
  if (mergeRequest === null || !isRecord(value)) {
    return null
  }

  const pipeline = isRecord(value.head_pipeline) ? value.head_pipeline : null
  const refs = isRecord(value.diff_refs) ? value.diff_refs : null
  const baseSha = refs !== null ? str(refs.base_sha) : null
  const startSha = refs !== null ? str(refs.start_sha) : null
  const headSha = refs !== null ? str(refs.head_sha) : null

  return {
    mergeRequest,
    reviewers: parseMembers(value.reviewers),
    assignees: parseMembers(value.assignees),
    labels: Array.isArray(value.labels)
      ? value.labels.filter((l): l is string => typeof l === 'string')
      : [],
    mergeStatus:
      str(value.detailed_merge_status) ?? str(value.merge_status) ?? 'unknown',
    hasConflicts: value.has_conflicts === true,
    pipeline:
      pipeline !== null && typeof pipeline.id === 'number'
        ? {
            id: pipeline.id,
            status: str(pipeline.status) ?? 'unknown',
            webURL: str(pipeline.web_url),
          }
        : null,
    diffRefs:
      baseSha !== null && startSha !== null && headSha !== null
        ? { baseSha, startSha, headSha }
        : null,
    changesCount: str(value.changes_count),
    forceRemoveSourceBranch: value.force_remove_source_branch === true,
    squash: value.squash === true,
    mergedBy: parseUser(value.merged_by),
  }
}

/** A merge request with reviewers, pipeline and merge status. */
export async function fetchMergeRequestDetails(
  connection: IGitLabConnection,
  projectId: number,
  iid: number
): Promise<IGitLabMergeRequestDetails> {
  const body = await request(
    connection,
    'GET',
    `${mrPath(projectId, iid)}?include_rebase_in_progress=true`
  )
  return parseOne(body, parseMergeRequestDetails)
}

/** Who approved a merge request, and how many approvals it still needs. */
export interface IGitLabApprovals {
  readonly approvedBy: ReadonlyArray<IGitLabUserRef>
  /** 0 on GitLab Free, where approvals are optional. */
  readonly approvalsLeft: number
}

export function parseApprovals(value: unknown): IGitLabApprovals | null {
  if (!isRecord(value)) {
    return null
  }
  const approvedBy = Array.isArray(value.approved_by)
    ? value.approved_by
        .map(a => (isRecord(a) ? parseUser(a.user) : null))
        .filter((u): u is IGitLabUserRef => u !== null)
    : []
  return { approvedBy, approvalsLeft: num(value.approvals_left) ?? 0 }
}

export async function fetchApprovals(
  connection: IGitLabConnection,
  projectId: number,
  iid: number
): Promise<IGitLabApprovals> {
  const body = await request(
    connection,
    'GET',
    `${mrPath(projectId, iid)}/approvals`
  )
  return parseOne(body, parseApprovals)
}

/** Approve a merge request, or take the approval back. */
export async function setApproved(
  connection: IGitLabConnection,
  projectId: number,
  iid: number,
  approved: boolean
): Promise<void> {
  await request(
    connection,
    'POST',
    `${mrPath(projectId, iid)}/${approved ? 'approve' : 'unapprove'}`
  )
}

/** Reply to a comment thread. */
export async function replyToDiscussion(
  connection: IGitLabConnection,
  projectId: number,
  iid: number,
  discussionId: string,
  text: string
): Promise<IGitLabNote> {
  const body = await request(
    connection,
    'POST',
    `${mrPath(projectId, iid)}/discussions/${discussionId}/notes`,
    { body: text }
  )
  return parseOne(body, parseNote)
}

/** Resolve or reopen a comment thread. */
export async function setDiscussionResolved(
  connection: IGitLabConnection,
  projectId: number,
  iid: number,
  discussionId: string,
  resolved: boolean
): Promise<IGitLabDiscussion> {
  const body = await request(
    connection,
    'PUT',
    `${mrPath(projectId, iid)}/discussions/${discussionId}?resolved=${resolved}`
  )
  return parseOne(body, parseDiscussion)
}

/** A line of the diff to comment on. */
export interface IGitLabLineTarget {
  readonly oldPath: string
  readonly newPath: string
  readonly oldLine: number | null
  readonly newLine: number | null
}

/** The `position` GitLab needs to attach a comment to a line of the diff. */
export function linePosition(refs: IGitLabDiffRefs, line: IGitLabLineTarget) {
  const position: Record<string, unknown> = {
    position_type: 'text',
    base_sha: refs.baseSha,
    start_sha: refs.startSha,
    head_sha: refs.headSha,
    old_path: line.oldPath,
    new_path: line.newPath,
  }
  if (line.oldLine !== null) {
    position.old_line = line.oldLine
  }
  if (line.newLine !== null) {
    position.new_line = line.newLine
  }
  return position
}

/** Start a comment thread on a line of the diff. */
export async function createLineDiscussion(
  connection: IGitLabConnection,
  projectId: number,
  iid: number,
  refs: IGitLabDiffRefs,
  line: IGitLabLineTarget,
  text: string
): Promise<IGitLabDiscussion> {
  const body = await request(
    connection,
    'POST',
    `${mrPath(projectId, iid)}/discussions`,
    { body: text, position: linePosition(refs, line) }
  )
  return parseOne(body, parseDiscussion)
}

/** A comment saved as part of a review that isn't submitted yet. */
export interface IGitLabDraftNote {
  readonly id: number
  readonly body: string
  readonly line: IGitLabLineTarget | null
}

export function parseDraftNote(value: unknown): IGitLabDraftNote | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    typeof value.note !== 'string'
  ) {
    return null
  }
  const p = isRecord(value.position) ? value.position : null
  const oldPath = p !== null ? str(p.old_path) : null
  const newPath = p !== null ? str(p.new_path) : null
  return {
    id: value.id,
    body: value.note,
    line:
      p !== null && (oldPath !== null || newPath !== null)
        ? {
            oldPath: oldPath ?? newPath ?? '',
            newPath: newPath ?? oldPath ?? '',
            oldLine: num(p.old_line),
            newLine: num(p.new_line),
          }
        : null,
  }
}

export async function fetchDraftNotes(
  connection: IGitLabConnection,
  projectId: number,
  iid: number
): Promise<ReadonlyArray<IGitLabDraftNote>> {
  const body = await request(
    connection,
    'GET',
    `${mrPath(projectId, iid)}/draft_notes`
  )
  return parseList(body, parseDraftNote)
}

/** Add a comment to the pending review, on a line or on the whole MR. */
export async function createDraftNote(
  connection: IGitLabConnection,
  projectId: number,
  iid: number,
  text: string,
  target: { refs: IGitLabDiffRefs; line: IGitLabLineTarget } | null
): Promise<IGitLabDraftNote> {
  const body = await request(
    connection,
    'POST',
    `${mrPath(projectId, iid)}/draft_notes`,
    target === null
      ? { note: text }
      : { note: text, position: linePosition(target.refs, target.line) }
  )
  return parseOne(body, parseDraftNote)
}

export async function deleteDraftNote(
  connection: IGitLabConnection,
  projectId: number,
  iid: number,
  draftId: number
): Promise<void> {
  await request(
    connection,
    'DELETE',
    `${mrPath(projectId, iid)}/draft_notes/${draftId}`
  )
}

/** Post every comment of the pending review at once. */
export async function publishDraftNotes(
  connection: IGitLabConnection,
  projectId: number,
  iid: number
): Promise<void> {
  await request(
    connection,
    'POST',
    `${mrPath(projectId, iid)}/draft_notes/bulk_publish`
  )
}

/** Fields of a merge request that can be changed; omitted ones stay. */
export interface IGitLabMergeRequestUpdate {
  readonly title?: string
  readonly description?: string
  readonly targetBranch?: string
  readonly reviewerIds?: ReadonlyArray<number>
  readonly assigneeIds?: ReadonlyArray<number>
  readonly stateEvent?: 'close' | 'reopen'
}

export async function updateMergeRequest(
  connection: IGitLabConnection,
  projectId: number,
  iid: number,
  update: IGitLabMergeRequestUpdate
): Promise<IGitLabMergeRequestDetails> {
  const fields: Record<string, unknown> = {}
  if (update.title !== undefined) {
    fields.title = update.title
  }
  if (update.description !== undefined) {
    fields.description = update.description
  }
  if (update.targetBranch !== undefined) {
    fields.target_branch = update.targetBranch
  }
  if (update.reviewerIds !== undefined) {
    // An empty list removes everyone.
    fields.reviewer_ids = update.reviewerIds
  }
  if (update.assigneeIds !== undefined) {
    fields.assignee_ids = update.assigneeIds
  }
  if (update.stateEvent !== undefined) {
    fields.state_event = update.stateEvent
  }
  const body = await request(connection, 'PUT', mrPath(projectId, iid), fields)
  return parseOne(body, parseMergeRequestDetails)
}

/** How to merge. */
export interface IGitLabMergeOptions {
  readonly squash: boolean
  readonly removeSourceBranch: boolean
  /** Merge once the running pipeline passes, instead of now. */
  readonly whenPipelineSucceeds: boolean
  /** Fail if the branch moved since the user looked at it. */
  readonly sha: string | null
}

export async function mergeMergeRequest(
  connection: IGitLabConnection,
  projectId: number,
  iid: number,
  options: IGitLabMergeOptions
): Promise<IGitLabMergeRequestDetails> {
  const fields: Record<string, unknown> = {
    squash: options.squash,
    should_remove_source_branch: options.removeSourceBranch,
    merge_when_pipeline_succeeds: options.whenPipelineSucceeds,
  }
  if (options.sha !== null) {
    fields.sha = options.sha
  }
  const body = await request(
    connection,
    'PUT',
    `${mrPath(projectId, iid)}/merge`,
    fields
  )
  return parseOne(body, parseMergeRequestDetails)
}

/** Ask GitLab to rebase the source branch onto the target branch. */
export async function rebaseMergeRequest(
  connection: IGitLabConnection,
  projectId: number,
  iid: number
): Promise<void> {
  await request(connection, 'PUT', `${mrPath(projectId, iid)}/rebase`)
}

/** People who can be picked as reviewer or assignee of the project's MRs. */
export async function fetchProjectMembers(
  connection: IGitLabConnection,
  projectId: number
): Promise<ReadonlyArray<IGitLabMember>> {
  const body = await request(
    connection,
    'GET',
    `/projects/${projectId}/members/all?per_page=100`
  )
  return parseList(body, item =>
    isRecord(item) && item.state !== 'blocked' && item.bot !== true
      ? parseMember(item)
      : null
  )
}

/** A commit of a merge request. */
export interface IGitLabCommit {
  readonly id: string
  readonly shortId: string
  readonly title: string
  readonly authorName: string
  readonly createdAt: string
}

function parseCommit(value: unknown): IGitLabCommit | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string'
  ) {
    return null
  }
  return {
    id: value.id,
    shortId: str(value.short_id) ?? value.id.slice(0, 8),
    title: value.title,
    authorName: str(value.author_name) ?? '',
    createdAt: str(value.created_at) ?? '',
  }
}

export async function fetchMergeRequestCommits(
  connection: IGitLabConnection,
  projectId: number,
  iid: number
): Promise<ReadonlyArray<IGitLabCommit>> {
  const body = await request(
    connection,
    'GET',
    `${mrPath(projectId, iid)}/commits?per_page=100`
  )
  return parseList(body, parseCommit)
}

/** Explain GitLab's merge status in a sentence, or null when it can merge. */
export function describeMergeStatus(status: string): string | null {
  switch (status) {
    case 'mergeable':
    case 'can_be_merged':
      return null
    case 'checking':
    case 'unchecked':
    case 'preparing':
    case 'approvals_syncing':
      return 'GitLab is checking whether this can be merged…'
    case 'ci_must_pass':
      return 'The pipeline must succeed before merging.'
    case 'ci_still_running':
      return 'The pipeline is still running.'
    case 'conflict':
    case 'cannot_be_merged':
      return 'The source branch has conflicts with the target branch.'
    case 'need_rebase':
      return 'The source branch must be rebased onto the target branch.'
    case 'not_approved':
      return 'This merge request needs more approvals.'
    case 'draft_status':
      return 'Mark this merge request as ready before merging.'
    case 'discussions_not_resolved':
      return 'All threads must be resolved before merging.'
    case 'blocked_status':
      return 'Another merge request blocks this one.'
    case 'not_open':
      return 'This merge request is not open.'
    case 'requested_changes':
      return 'A reviewer requested changes.'
    case 'jira_association_missing':
      return 'The title or description must reference a Jira issue.'
    case 'external_status_checks':
      return 'External status checks must pass before merging.'
    case 'security_policy_violations':
    case 'security_policy_pipeline_check':
      return 'Security policies block merging.'
    case 'commits_status':
      return 'The source branch is missing or has no commits.'
    default:
      return `GitLab can't merge this yet (${status}).`
  }
}

const DraftPrefix = /^\s*(\[draft\]|\(draft\)|draft:|draft\s*-)\s*/i

/** The title with GitLab's draft marker added or removed. */
export function setDraftInTitle(title: string, draft: boolean): string {
  const plain = title.replace(DraftPrefix, '')
  return draft ? `Draft: ${plain}` : plain
}

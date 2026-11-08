import * as React from 'react'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import { TextBox } from '../lib/text-box'
import { TextArea } from '../lib/text-area'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Loading } from '../lib/loading'
import { RelativeTime } from '../relative-time'
import { openExternal } from '../main-process-proxy'
import {
  IGitLabDiffFile,
  IGitLabDiscussion,
  IGitLabMergeRequest,
  IGitLabNotePosition,
  addMergeRequestComment,
  fetchMergeRequestDiffs,
  fetchMergeRequestDiscussions,
  getDiffExcerpt,
} from '../../lib/gitlab/gitlab-merge-requests'
import {
  IGitLabApprovals,
  IGitLabCommit,
  IGitLabDraftNote,
  IGitLabLineTarget,
  IGitLabMember,
  IGitLabMergeRequestDetails,
  IGitLabMergeRequestUpdate,
  createDraftNote,
  createLineDiscussion,
  deleteDraftNote,
  describeMergeStatus,
  fetchApprovals,
  fetchDraftNotes,
  fetchMergeRequestCommits,
  fetchMergeRequestDetails,
  fetchProjectMembers,
  mergeMergeRequest,
  publishDraftNotes,
  rebaseMergeRequest,
  replyToDiscussion,
  setApproved,
  setDiscussionResolved,
  setDraftInTitle,
  updateMergeRequest,
} from '../../lib/gitlab/gitlab-merge-request-actions'
import {
  CommentBox,
  ErrorBanner,
  IGitLabMRContext,
  MRStatePill,
  PipelineStatus,
  errorMessage,
} from './gitlab-mr-common'
import { GitLabMRThread } from './gitlab-mr-thread'
import { GitLabMRChanges } from './gitlab-mr-changes'
import { GitLabMemberPicker } from './gitlab-member-picker'

type Tab = 'overview' | 'changes' | 'commits'

interface IEditing {
  readonly title: string
  readonly description: string
}

interface IGitLabMRDetailProps {
  readonly context: IGitLabMRContext
  readonly mergeRequest: IGitLabMergeRequest
  /** Called when the merge request changed, so the list can be refreshed. */
  readonly onChanged: (mr: IGitLabMergeRequest) => void
}

interface IGitLabMRDetailState {
  readonly details: IGitLabMergeRequestDetails | null
  readonly approvals: IGitLabApprovals | null
  readonly discussions: ReadonlyArray<IGitLabDiscussion> | null
  readonly diffs: ReadonlyArray<IGitLabDiffFile> | null
  readonly drafts: ReadonlyArray<IGitLabDraftNote>
  readonly commits: ReadonlyArray<IGitLabCommit> | null
  readonly members: ReadonlyArray<IGitLabMember> | null
  readonly loadError: string | null

  readonly tab: Tab
  readonly focus: IGitLabNotePosition | null
  readonly busy: boolean
  readonly actionError: string | null
  readonly notice: string | null

  readonly editing: IEditing | null
  readonly squash: boolean
  readonly removeSourceBranch: boolean
  readonly confirmingMerge: boolean
}

/** One merge request: overview, changes and commits, like on GitLab. */
export class GitLabMRDetail extends React.Component<
  IGitLabMRDetailProps,
  IGitLabMRDetailState
> {
  private mounted = false

  public constructor(props: IGitLabMRDetailProps) {
    super(props)
    this.state = {
      details: null,
      approvals: null,
      discussions: null,
      diffs: null,
      drafts: [],
      commits: null,
      members: null,
      loadError: null,
      tab: 'overview',
      focus: null,
      busy: false,
      actionError: null,
      notice: null,
      editing: null,
      squash: false,
      removeSourceBranch: true,
      confirmingMerge: false,
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.load()
  }

  public componentWillUnmount() {
    this.mounted = false
  }

  private get api() {
    const { connection, project } = this.props.context
    return {
      connection,
      projectId: project.id,
      iid: this.props.mergeRequest.iid,
    }
  }

  private get mr(): IGitLabMergeRequest {
    return this.state.details?.mergeRequest ?? this.props.mergeRequest
  }

  // ---- Loading -----------------------------------------------------------

  private async load() {
    const { connection, projectId, iid } = this.api

    // Each part fails on its own so one missing permission or older server
    // doesn't hide the rest.
    fetchMergeRequestDiffs(connection, projectId, iid)
      .then(diffs => this.mounted && this.setState({ diffs }))
      .catch(e => {
        log.warn('[GitLab] could not load the diff', e)
        if (this.mounted) {
          this.setState({ diffs: [] })
        }
      })
    fetchProjectMembers(connection, projectId)
      .then(members => this.mounted && this.setState({ members }))
      .catch(() => this.mounted && this.setState({ members: [] }))

    await Promise.all([
      this.loadDetails(),
      this.loadApprovals(),
      this.loadDiscussions(),
      this.loadDrafts(),
    ])
  }

  private async loadDetails() {
    const { connection, projectId, iid } = this.api
    try {
      const details = await fetchMergeRequestDetails(connection, projectId, iid)
      if (this.mounted) {
        if (this.state.details === null) {
          this.setState({
            details,
            squash: details.squash,
            removeSourceBranch:
              details.forceRemoveSourceBranch ||
              details.mergeRequest.state === 'opened',
          })
        } else {
          this.setState({ details })
        }
      }
    } catch (e) {
      if (this.mounted) {
        this.setState({ loadError: errorMessage(e) })
      }
    }
  }

  private async loadApprovals() {
    const { connection, projectId, iid } = this.api
    try {
      const approvals = await fetchApprovals(connection, projectId, iid)
      if (this.mounted) {
        this.setState({ approvals })
      }
    } catch (e) {
      log.warn('[GitLab] could not load approvals', e)
    }
  }

  private async loadDiscussions() {
    const { connection, projectId, iid } = this.api
    try {
      const discussions = await fetchMergeRequestDiscussions(
        connection,
        projectId,
        iid
      )
      if (this.mounted) {
        this.setState({ discussions })
      }
    } catch (e) {
      if (this.mounted) {
        this.setState({ discussions: [], actionError: errorMessage(e) })
      }
    }
  }

  private async loadDrafts() {
    const { connection, projectId, iid } = this.api
    try {
      const drafts = await fetchDraftNotes(connection, projectId, iid)
      if (this.mounted) {
        this.setState({ drafts })
      }
    } catch (e) {
      log.warn('[GitLab] could not load pending review comments', e)
    }
  }

  private async loadCommits() {
    const { connection, projectId, iid } = this.api
    try {
      const commits = await fetchMergeRequestCommits(connection, projectId, iid)
      if (this.mounted) {
        this.setState({ commits })
      }
    } catch (e) {
      if (this.mounted) {
        this.setState({ commits: [], actionError: errorMessage(e) })
      }
    }
  }

  /**
   * Run an action with the buttons disabled and show its error, if any.
   * Returns whether it succeeded.
   */
  private async run(
    action: () => Promise<void>,
    notice?: string
  ): Promise<boolean> {
    this.setState({ busy: true, actionError: null, notice: null })
    try {
      await action()
      if (this.mounted) {
        this.setState({ busy: false, notice: notice ?? null })
      }
      return true
    } catch (e) {
      if (this.mounted) {
        this.setState({ busy: false, actionError: errorMessage(e) })
      }
      return false
    }
  }

  private applyDetails(details: IGitLabMergeRequestDetails) {
    if (this.mounted) {
      this.setState({ details })
      this.props.onChanged(details.mergeRequest)
    }
  }

  // ---- Actions -----------------------------------------------------------

  private setTab = (tab: Tab) => () => {
    this.setState({ tab, focus: null })
    if (tab === 'commits' && this.state.commits === null) {
      this.loadCommits()
    }
  }

  private showInDiff = (focus: IGitLabNotePosition) =>
    this.setState({ tab: 'changes', focus })

  private dismissError = () => this.setState({ actionError: null })
  private dismissNotice = () => this.setState({ notice: null })

  private toggleApproval = () => {
    const approved = this.isApprovedByMe()
    const { connection, projectId, iid } = this.api
    this.run(async () => {
      await setApproved(connection, projectId, iid, !approved)
      await Promise.all([this.loadApprovals(), this.loadDetails()])
    })
  }

  private isApprovedByMe() {
    const me = this.props.context.account.username
    return (
      this.state.approvals?.approvedBy.some(u => u.username === me) ?? false
    )
  }

  private postComment = (text: string) => {
    const { connection, projectId, iid } = this.api
    return this.run(async () => {
      const note = await addMergeRequestComment(
        connection,
        projectId,
        iid,
        text
      )
      this.setState(s => ({
        discussions: [
          ...(s.discussions ?? []),
          {
            id: `note-${note.id}`,
            notes: [note],
            position: null,
            resolved: false,
          },
        ],
      }))
    })
  }

  private addGeneralDraft = (text: string) => {
    const { connection, projectId, iid } = this.api
    return this.run(async () => {
      const draft = await createDraftNote(
        connection,
        projectId,
        iid,
        text,
        null
      )
      this.setState(s => ({ drafts: [...s.drafts, draft] }))
    }, 'Added to your pending review.')
  }

  private onReply = (discussion: IGitLabDiscussion, text: string) => {
    const { connection, projectId, iid } = this.api
    return this.run(async () => {
      const note = await replyToDiscussion(
        connection,
        projectId,
        iid,
        discussion.id,
        text
      )
      this.replaceDiscussion(discussion.id, d => ({
        ...d,
        notes: [...d.notes, note],
      }))
    })
  }

  private onResolve = (discussion: IGitLabDiscussion, resolved: boolean) => {
    const { connection, projectId, iid } = this.api
    this.run(async () => {
      const updated = await setDiscussionResolved(
        connection,
        projectId,
        iid,
        discussion.id,
        resolved
      )
      this.replaceDiscussion(discussion.id, () => updated)
      await this.loadDetails()
    })
  }

  private replaceDiscussion(
    id: string,
    update: (d: IGitLabDiscussion) => IGitLabDiscussion
  ) {
    this.setState(s => ({
      discussions: (s.discussions ?? []).map(d =>
        d.id === id ? update(d) : d
      ),
    }))
  }

  private onLineComment = (
    line: IGitLabLineTarget,
    text: string,
    asDraft: boolean
  ) => {
    const refs = this.state.details?.diffRefs
    if (refs == null) {
      return Promise.resolve(false)
    }
    const { connection, projectId, iid } = this.api
    return this.run(async () => {
      if (asDraft) {
        const draft = await createDraftNote(connection, projectId, iid, text, {
          refs,
          line,
        })
        this.setState(s => ({ drafts: [...s.drafts, draft] }))
      } else {
        const discussion = await createLineDiscussion(
          connection,
          projectId,
          iid,
          refs,
          line,
          text
        )
        this.setState(s => ({
          discussions: [...(s.discussions ?? []), discussion],
        }))
      }
    })
  }

  private onDeleteDraft = (draft: IGitLabDraftNote) => {
    const { connection, projectId, iid } = this.api
    this.run(async () => {
      await deleteDraftNote(connection, projectId, iid, draft.id)
      this.setState(s => ({ drafts: s.drafts.filter(d => d.id !== draft.id) }))
    })
  }

  private submitReview = () => {
    const { connection, projectId, iid } = this.api
    const count = this.state.drafts.length
    this.run(async () => {
      await publishDraftNotes(connection, projectId, iid)
      this.setState({ drafts: [] })
      await this.loadDiscussions()
    }, `Submitted your review with ${count} comment${count === 1 ? '' : 's'}.`)
  }

  private discardReview = () => {
    const { connection, projectId, iid } = this.api
    const drafts = this.state.drafts
    this.run(async () => {
      for (const d of drafts) {
        await deleteDraftNote(connection, projectId, iid, d.id)
      }
      this.setState({ drafts: [] })
    }, 'Discarded your pending review.')
  }

  private update(update: IGitLabMergeRequestUpdate, notice?: string) {
    const { connection, projectId, iid } = this.api
    return this.run(async () => {
      this.applyDetails(
        await updateMergeRequest(connection, projectId, iid, update)
      )
    }, notice)
  }

  private setDraft = (draft: boolean) => () =>
    this.update(
      { title: setDraftInTitle(this.mr.title, draft) },
      draft ? 'Marked as draft.' : 'Marked as ready.'
    )

  private closeMR = () => this.update({ stateEvent: 'close' }, 'Closed.')
  private reopenMR = () => this.update({ stateEvent: 'reopen' }, 'Reopened.')

  private onReviewersChanged = (people: ReadonlyArray<IGitLabMember>) =>
    this.update({ reviewerIds: people.map(p => p.id) })

  private onAssigneesChanged = (people: ReadonlyArray<IGitLabMember>) =>
    this.update({ assigneeIds: people.map(p => p.id) })

  private startEditing = () =>
    this.setState({
      editing: { title: this.mr.title, description: this.mr.description },
    })

  private cancelEditing = () => this.setState({ editing: null })

  private onEditTitle = (title: string) =>
    this.setState(s => ({ editing: s.editing && { ...s.editing, title } }))

  private onEditDescription = (description: string) =>
    this.setState(s => ({
      editing: s.editing && { ...s.editing, description },
    }))

  private saveEditing = async () => {
    const { editing } = this.state
    if (editing === null || editing.title.trim().length === 0) {
      return
    }
    const ok = await this.update({
      title: editing.title.trim(),
      description: editing.description,
    })
    if (ok && this.mounted) {
      this.setState({ editing: null })
    }
  }

  private onSquashChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ squash: event.currentTarget.checked })

  private onRemoveBranchChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ removeSourceBranch: event.currentTarget.checked })

  private askMerge = () => this.setState({ confirmingMerge: true })
  private cancelMerge = () => this.setState({ confirmingMerge: false })

  private merge = (whenPipelineSucceeds: boolean) => () => {
    const { connection, projectId, iid } = this.api
    const { squash, removeSourceBranch, details } = this.state
    this.setState({ confirmingMerge: false })
    this.run(
      async () => {
        this.applyDetails(
          await mergeMergeRequest(connection, projectId, iid, {
            squash,
            removeSourceBranch,
            whenPipelineSucceeds,
            sha: details?.diffRefs?.headSha ?? null,
          })
        )
      },
      whenPipelineSucceeds
        ? 'GitLab will merge this when the pipeline succeeds.'
        : `Merged into ${this.mr.targetBranch}. Pull ${this.mr.targetBranch} to get the changes.`
    )
  }

  private rebase = () => {
    const { connection, projectId, iid } = this.api
    this.run(async () => {
      await rebaseMergeRequest(connection, projectId, iid)
      // GitLab rebases in the background.
      window.setTimeout(() => this.mounted && this.loadDetails(), 3000)
    }, 'GitLab is rebasing the source branch. Fetch before pushing again.')
  }

  private openURL = (url: string) => () => openExternal(url)

  // ---- Rendering ---------------------------------------------------------

  public render() {
    const { loadError, actionError, notice, tab, discussions, diffs, commits } =
      this.state

    if (loadError !== null) {
      return (
        <div className="gl-empty">
          <Octicon symbol={octicons.alert} />
          <p>{loadError}</p>
        </div>
      )
    }

    const commentCount = (discussions ?? []).reduce(
      (n, d) => n + d.notes.length,
      0
    )

    return (
      <div className="gl-mr-detail">
        {this.renderHeader()}
        {actionError !== null && (
          <ErrorBanner message={actionError} onDismiss={this.dismissError} />
        )}
        {notice !== null && (
          <div className="gl-notice" role="status">
            <Octicon symbol={octicons.checkCircle} />
            <span>{notice}</span>
            <Button
              size="small"
              onClick={this.dismissNotice}
              ariaLabel="Dismiss"
            >
              <Octicon symbol={octicons.x} />
            </Button>
          </div>
        )}
        {this.renderPendingReview()}
        <div className="gl-tabs" role="tablist">
          {this.renderTab('overview', 'Overview', commentCount)}
          {this.renderTab('changes', 'Changes', diffs?.length ?? null)}
          {this.renderTab('commits', 'Commits', commits?.length ?? null)}
        </div>
        <div className="gl-tab-panel" role="tabpanel">
          {tab === 'overview' && this.renderOverview()}
          {tab === 'changes' && this.renderChanges()}
          {tab === 'commits' && this.renderCommits()}
        </div>
      </div>
    )
  }

  private renderTab(tab: Tab, label: string, count: number | null) {
    const selected = this.state.tab === tab
    return (
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        className={classNames('gl-tab', { selected })}
        onClick={this.setTab(tab)}
      >
        {label}
        {count !== null && <span className="gl-tab-count">{count}</span>}
      </button>
    )
  }

  private renderHeader() {
    const mr = this.mr
    const { editing, busy } = this.state

    return (
      <div className="gl-mr-header">
        {editing === null ? (
          <div className="gl-mr-title-row">
            <MRStatePill mr={mr} />
            <h2 className="gl-mr-title">{mr.title}</h2>
            {mr.state === 'opened' && (
              <Button
                size="small"
                onClick={this.startEditing}
                disabled={busy}
                tooltip="Edit title and description"
              >
                <Octicon symbol={octicons.pencil} /> Edit
              </Button>
            )}
            <Button
              size="small"
              onClick={this.openURL(mr.webURL)}
              tooltip="Open in GitLab"
            >
              <Octicon symbol={octicons.linkExternal} />
            </Button>
          </div>
        ) : (
          <div className="gl-mr-edit">
            <TextBox
              label="Title"
              value={editing.title}
              onValueChanged={this.onEditTitle}
              autoFocus={true}
            />
          </div>
        )}
        <div className="gl-meta">
          !{mr.iid}
          {mr.author !== null && (
            <>
              {' · '}
              <strong>{mr.author.name}</strong> wants to merge
            </>
          )}{' '}
          <code className="gl-branch">{mr.sourceBranch}</code> into{' '}
          <code className="gl-branch">{mr.targetBranch}</code>
          {mr.createdAt !== '' && (
            <>
              {' · opened '}
              <RelativeTime date={new Date(mr.createdAt)} />
            </>
          )}
        </div>
      </div>
    )
  }

  private renderPendingReview() {
    const { drafts, busy } = this.state
    if (drafts.length === 0) {
      return null
    }
    return (
      <div className="gl-review-bar">
        <Octicon symbol={octicons.commentDiscussion} />
        <span>
          You have <strong>{drafts.length}</strong> pending comment
          {drafts.length === 1 ? '' : 's'}. Others can't see them until you
          submit your review.
        </span>
        <Button size="small" onClick={this.discardReview} disabled={busy}>
          Discard
        </Button>
        <Button
          size="small"
          className="gl-primary"
          onClick={this.submitReview}
          disabled={busy}
        >
          Submit review
        </Button>
      </div>
    )
  }

  private renderOverview() {
    const mr = this.mr
    const { editing, discussions, drafts, busy } = this.state
    const general = drafts.filter(d => d.line === null)

    return (
      <div className="gl-overview">
        <div className="gl-overview-main">
          {editing !== null ? (
            <div className="gl-mr-edit">
              <TextArea
                label="Description"
                value={editing.description}
                onValueChanged={this.onEditDescription}
                rows={8}
              />
              <div className="gl-row-end">
                <Button
                  size="small"
                  onClick={this.cancelEditing}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  size="small"
                  className="gl-primary"
                  onClick={this.saveEditing}
                  disabled={busy || editing.title.trim().length === 0}
                >
                  Save changes
                </Button>
              </div>
            </div>
          ) : (
            <div
              className={classNames('gl-description', {
                empty: mr.description.trim().length === 0,
              })}
            >
              {mr.description.trim().length > 0
                ? mr.description
                : 'No description.'}
            </div>
          )}

          {this.renderMergeBox()}

          <h3 className="gl-section-title">Activity</h3>
          {discussions === null ? (
            <div className="gl-empty">
              <Loading /> Loading comments…
            </div>
          ) : discussions.length === 0 ? (
            <p className="gl-meta">No comments yet.</p>
          ) : (
            discussions.map(d => this.renderThread(d))
          )}
          {general.map(d => (
            <div key={d.id} className="gl-draft">
              <span className="gl-tag gl-tag-pending">Pending</span>
              <span className="gl-note-body">{d.body}</span>
              <Button
                size="small"
                onClick={this.deleteDraft(d)}
                disabled={busy}
                ariaLabel="Delete pending comment"
              >
                <Octicon symbol={octicons.trash} />
              </Button>
            </div>
          ))}

          <CommentBox
            placeholder="Write a comment"
            submitLabel="Comment"
            secondaryLabel={drafts.length > 0 ? 'Add to review' : undefined}
            onSecondary={drafts.length > 0 ? this.addGeneralDraft : undefined}
            busy={busy}
            onSubmit={this.postComment}
          />
        </div>
        {this.renderSidebar()}
      </div>
    )
  }

  private deleteDraft = (draft: IGitLabDraftNote) => () =>
    this.onDeleteDraft(draft)

  private renderThread(d: IGitLabDiscussion) {
    const { diffs, details, busy } = this.state
    const headSha = details?.diffRefs?.headSha ?? this.mr.headSha
    const outdated =
      d.position !== null &&
      d.position.headSha !== null &&
      headSha !== null &&
      d.position.headSha !== headSha
    const excerpt =
      d.position !== null && diffs !== null && !outdated
        ? getDiffExcerpt(diffs, d.position)
        : null
    return (
      <GitLabMRThread
        key={d.id}
        discussion={d}
        excerpt={excerpt}
        outdated={outdated}
        busy={busy}
        onReply={this.onReply}
        onResolve={this.onResolve}
        onShowInDiff={this.showInDiff}
      />
    )
  }

  private renderMergeBox() {
    const mr = this.mr
    const { details, approvals, busy } = this.state

    if (mr.state === 'merged') {
      return (
        <div className="gl-merge-box gl-merge-box-merged">
          <div className="gl-merge-row">
            <Octicon symbol={octicons.gitMerge} />
            <span>
              Merged
              {details?.mergedBy
                ? ` by ${details.mergedBy.name}`
                : ''} into <code className="gl-branch">{mr.targetBranch}</code>.
            </span>
          </div>
        </div>
      )
    }

    if (mr.state === 'closed' || mr.state === 'locked') {
      return (
        <div className="gl-merge-box gl-merge-box-closed">
          <div className="gl-merge-row">
            <Octicon symbol={octicons.gitPullRequestClosed} />
            <span>This merge request is closed.</span>
            <Button size="small" onClick={this.reopenMR} disabled={busy}>
              Reopen
            </Button>
          </div>
        </div>
      )
    }

    if (details === null) {
      return (
        <div className="gl-merge-box">
          <div className="gl-merge-row">
            <Loading /> Checking merge status…
          </div>
        </div>
      )
    }

    const blocker = describeMergeStatus(details.mergeStatus)
    const approvedByMe = this.isApprovedByMe()
    const pipelineRunning =
      details.pipeline !== null &&
      ['running', 'pending', 'created'].includes(details.pipeline.status)
    const canMergeNow = blocker === null
    const canAutoMerge =
      !canMergeNow &&
      (details.mergeStatus === 'ci_still_running' ||
        (details.mergeStatus === 'ci_must_pass' && pipelineRunning))

    return (
      <div
        className={classNames('gl-merge-box', {
          'gl-merge-box-ready': canMergeNow,
        })}
      >
        {details.pipeline !== null && (
          <div className="gl-merge-row">
            <PipelineStatus pipeline={details.pipeline} />
            {details.pipeline.webURL !== null && (
              <button
                type="button"
                className="gl-link-button"
                onClick={this.openURL(details.pipeline.webURL)}
              >
                View pipeline
              </button>
            )}
          </div>
        )}

        <div className="gl-merge-row">
          <Octicon
            symbol={octicons.thumbsup}
            className={classNames({
              'gl-ok': (approvals?.approvedBy.length ?? 0) > 0,
            })}
          />
          <span className="gl-merge-row-text">{this.describeApprovals()}</span>
          <Button
            size="small"
            className={approvedByMe ? undefined : 'gl-primary'}
            onClick={this.toggleApproval}
            disabled={busy || approvals === null}
          >
            {approvedByMe ? 'Revoke approval' : 'Approve'}
          </Button>
        </div>

        <div className="gl-merge-row">
          <Octicon
            symbol={canMergeNow ? octicons.checkCircle : octicons.alert}
            className={canMergeNow ? 'gl-ok' : 'gl-warn'}
          />
          <span className="gl-merge-row-text">
            {canMergeNow ? <strong>Ready to merge!</strong> : blocker}
          </span>
          {mr.draft && (
            <Button size="small" onClick={this.setDraft(false)} disabled={busy}>
              Mark as ready
            </Button>
          )}
          {details.mergeStatus === 'need_rebase' && (
            <Button size="small" onClick={this.rebase} disabled={busy}>
              Rebase
            </Button>
          )}
        </div>

        {(canMergeNow || canAutoMerge) && this.renderMergeActions(canMergeNow)}

        <div className="gl-merge-footer">
          {!mr.draft && (
            <button
              type="button"
              className="gl-link-button"
              onClick={this.setDraft(true)}
              disabled={busy}
            >
              Mark as draft
            </button>
          )}
          <button
            type="button"
            className="gl-link-button gl-danger-link"
            onClick={this.closeMR}
            disabled={busy}
          >
            Close merge request
          </button>
        </div>
      </div>
    )
  }

  private renderMergeActions(canMergeNow: boolean) {
    const { squash, removeSourceBranch, confirmingMerge, busy } = this.state
    const mr = this.mr

    return (
      <div className="gl-merge-actions">
        <Checkbox
          label="Delete source branch"
          value={removeSourceBranch ? CheckboxValue.On : CheckboxValue.Off}
          onChange={this.onRemoveBranchChanged}
          disabled={busy}
        />
        <Checkbox
          label="Squash commits"
          value={squash ? CheckboxValue.On : CheckboxValue.Off}
          onChange={this.onSquashChanged}
          disabled={busy}
        />
        <div className="gl-row-end">
          {!canMergeNow ? (
            <Button
              className="gl-primary"
              onClick={this.merge(true)}
              disabled={busy}
            >
              Set to auto-merge
            </Button>
          ) : confirmingMerge ? (
            <>
              <span className="gl-meta">
                Merge <code className="gl-branch">{mr.sourceBranch}</code> into{' '}
                <code className="gl-branch">{mr.targetBranch}</code>?
              </span>
              <Button size="small" onClick={this.cancelMerge} disabled={busy}>
                Cancel
              </Button>
              <Button
                className="gl-primary gl-merge-button"
                onClick={this.merge(false)}
                disabled={busy}
              >
                Confirm merge
              </Button>
            </>
          ) : (
            <Button
              className="gl-primary gl-merge-button"
              onClick={this.askMerge}
              disabled={busy}
            >
              <Octicon symbol={octicons.gitMerge} /> Merge
            </Button>
          )}
        </div>
      </div>
    )
  }

  private describeApprovals() {
    const { approvals } = this.state
    if (approvals === null) {
      return 'Approvals'
    }
    const names = approvals.approvedBy.map(u => u.name)
    const by = names.length > 0 ? `Approved by ${names.join(', ')}` : null
    if (approvals.approvalsLeft > 0) {
      const left = `Requires ${approvals.approvalsLeft} more approval${
        approvals.approvalsLeft === 1 ? '' : 's'
      }`
      return by !== null ? `${by}. ${left}.` : `${left}.`
    }
    return by ?? 'Approval is optional.'
  }

  private renderSidebar() {
    const { details, members, busy } = this.state
    const canEdit = this.mr.state === 'opened' && details !== null
    return (
      <aside className="gl-sidebar">
        <GitLabMemberPicker
          label="Reviewers"
          members={members}
          selected={details?.reviewers ?? []}
          onChange={this.onReviewersChanged}
          disabled={!canEdit || busy}
        />
        <GitLabMemberPicker
          label="Assignees"
          members={members}
          selected={details?.assignees ?? []}
          onChange={this.onAssigneesChanged}
          disabled={!canEdit || busy}
        />
        {details !== null && details.labels.length > 0 && (
          <div className="gl-sidebar-section">
            <span className="gl-field-label">Labels</span>
            <div className="gl-labels">
              {details.labels.map(l => (
                <span key={l} className="gl-label">
                  {l}
                </span>
              ))}
            </div>
          </div>
        )}
      </aside>
    )
  }

  private renderChanges() {
    const { diffs, discussions, drafts, details, busy, focus } = this.state
    return (
      <GitLabMRChanges
        files={diffs}
        discussions={discussions ?? []}
        drafts={drafts}
        headSha={details?.diffRefs?.headSha ?? this.mr.headSha}
        busy={busy}
        canComment={details?.diffRefs != null && this.mr.state === 'opened'}
        focus={focus}
        onComment={this.onLineComment}
        onReply={this.onReply}
        onResolve={this.onResolve}
        onDeleteDraft={this.onDeleteDraft}
      />
    )
  }

  private renderCommits() {
    const { commits } = this.state
    if (commits === null) {
      return (
        <div className="gl-empty">
          <Loading /> Loading commits…
        </div>
      )
    }
    if (commits.length === 0) {
      return <div className="gl-empty">No commits.</div>
    }
    return (
      <ul className="gl-commits">
        {commits.map(c => (
          <li key={c.id}>
            <Octicon symbol={octicons.gitCommit} />
            <span className="gl-commit-title">{c.title}</span>
            <span className="gl-meta">
              {c.authorName}
              {c.createdAt !== '' && (
                <>
                  {' · '}
                  <RelativeTime date={new Date(c.createdAt)} />
                </>
              )}
            </span>
            <code className="gl-sha">{c.shortId}</code>
          </li>
        ))}
      </ul>
    )
  }
}

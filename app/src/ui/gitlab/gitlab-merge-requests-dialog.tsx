import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Button } from '../lib/button'
import { TextBox } from '../lib/text-box'
import { TextArea } from '../lib/text-area'
import { Select } from '../lib/select'
import { Loading } from '../lib/loading'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { RelativeTime } from '../relative-time'
import { openExternal } from '../main-process-proxy'
import { Repository } from '../../models/repository'
import { git } from '../../lib/git/core'
import { getCurrentBranchName } from '../../lib/git/ai-analysis-input'
import { IGitLabRemoteMatch } from '../../lib/gitlab/gitlab-remote'
import { getGitLabAccountsStore } from '../../lib/gitlab/gitlab-accounts'
import {
  IGitLabConnection,
  IGitLabMergeRequest,
  IGitLabNote,
  IGitLabProjectInfo,
  addMergeRequestComment,
  createMergeRequest,
  fetchBranchNames,
  fetchMergeRequestComments,
  fetchMergeRequests,
  fetchProjectInfo,
} from '../../lib/gitlab/gitlab-merge-requests'

interface IGitLabMergeRequestsDialogProps {
  readonly repository: Repository
  readonly match: IGitLabRemoteMatch
  readonly onDismissed: () => void
}

type View =
  | { readonly kind: 'list' }
  | { readonly kind: 'create' }
  | { readonly kind: 'detail'; readonly mergeRequest: IGitLabMergeRequest }

interface IContext {
  readonly connection: IGitLabConnection
  readonly project: IGitLabProjectInfo
  /** The checked-out branch, or null when HEAD is detached. */
  readonly currentBranch: string | null
}

interface IGitLabMergeRequestsDialogState {
  readonly context: IContext | null
  readonly loadError: string | null
  readonly mergeRequests: ReadonlyArray<IGitLabMergeRequest> | null
  readonly view: View

  // Create form
  readonly branches: ReadonlyArray<string>
  readonly title: string
  readonly description: string
  readonly targetBranch: string
  readonly busy: boolean
  readonly formError: string | null

  // Detail view
  readonly comments: ReadonlyArray<IGitLabNote> | null
  readonly commentsError: string | null
  readonly commentDraft: string
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Merge requests of the GitLab project a repository's remote points at:
 * the open merge requests, creating one for the current branch, and reading
 * and adding comments.
 */
export class GitLabMergeRequestsDialog extends React.Component<
  IGitLabMergeRequestsDialogProps,
  IGitLabMergeRequestsDialogState
> {
  private mounted = false

  public constructor(props: IGitLabMergeRequestsDialogProps) {
    super(props)
    this.state = {
      context: null,
      loadError: null,
      mergeRequests: null,
      view: { kind: 'list' },
      branches: [],
      title: '',
      description: '',
      targetBranch: '',
      busy: false,
      formError: null,
      comments: null,
      commentsError: null,
      commentDraft: '',
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.load()
  }

  public componentWillUnmount() {
    this.mounted = false
  }

  private async load() {
    const { match, repository } = this.props
    try {
      const token = await getGitLabAccountsStore().getToken(match.account)
      if (token === null) {
        throw new Error(
          `The token for ${match.account.serverURL} is missing from the keychain. Sign in again in Preferences > Accounts.`
        )
      }
      const connection = { serverURL: match.account.serverURL, token }
      const [project, branch] = await Promise.all([
        fetchProjectInfo(connection, match.projectPath),
        getCurrentBranchName(repository),
      ])
      const context = {
        connection,
        project,
        currentBranch: branch === 'HEAD' ? null : branch,
      }
      if (this.mounted) {
        this.setState({ context })
      }
      await this.loadMergeRequests(context)
    } catch (e) {
      if (this.mounted) {
        this.setState({ loadError: errorMessage(e) })
      }
    }
  }

  private async loadMergeRequests(context: IContext) {
    const mergeRequests = await fetchMergeRequests(
      context.connection,
      context.project.id
    )
    if (this.mounted) {
      this.setState({ mergeRequests })
    }
  }

  private refresh = () => {
    const { context } = this.state
    if (context === null) {
      return
    }
    this.setState({ mergeRequests: null, loadError: null })
    this.loadMergeRequests(context).catch(e => {
      if (this.mounted) {
        this.setState({ loadError: errorMessage(e) })
      }
    })
  }

  private get currentBranchMergeRequest() {
    const { context, mergeRequests } = this.state
    if (context?.currentBranch == null || mergeRequests === null) {
      return undefined
    }
    return mergeRequests.find(m => m.sourceBranch === context.currentBranch)
  }

  // ---- Navigation --------------------------------------------------------

  private showList = () => {
    this.setState({ view: { kind: 'list' }, formError: null })
  }

  private showCreate = async () => {
    const { context } = this.state
    if (context === null || context.currentBranch === null) {
      return
    }

    const summary = await git(
      ['log', '-1', '--format=%s'],
      this.props.repository.path,
      'gitLabMergeRequestTitle'
    )
      .then(r => r.stdout.trim())
      .catch(() => '')

    this.setState({
      view: { kind: 'create' },
      title: summary || context.currentBranch,
      description: '',
      targetBranch: context.project.defaultBranch ?? '',
      formError: null,
    })

    try {
      const branches = await fetchBranchNames(
        context.connection,
        context.project.id
      )
      if (this.mounted) {
        this.setState(s => ({
          branches: branches.filter(b => b !== context.currentBranch),
          targetBranch: s.targetBranch || branches[0] || '',
        }))
      }
    } catch (e) {
      log.warn('[GitLab] could not list branches', e)
    }
  }

  private showDetail = (mergeRequest: IGitLabMergeRequest) => {
    this.setState({
      view: { kind: 'detail', mergeRequest },
      comments: null,
      commentsError: null,
      commentDraft: '',
    })
    this.loadComments(mergeRequest)
  }

  private async loadComments(mergeRequest: IGitLabMergeRequest) {
    const { context } = this.state
    if (context === null) {
      return
    }
    try {
      const comments = await fetchMergeRequestComments(
        context.connection,
        context.project.id,
        mergeRequest.iid
      )
      if (this.mounted) {
        this.setState({ comments })
      }
    } catch (e) {
      if (this.mounted) {
        this.setState({ commentsError: errorMessage(e) })
      }
    }
  }

  // ---- Actions -----------------------------------------------------------

  private onSubmit = () => {
    if (this.state.view.kind === 'create') {
      this.submitMergeRequest()
    } else {
      this.props.onDismissed()
    }
  }

  private submitMergeRequest = async () => {
    const { context, title, description, targetBranch } = this.state
    if (context === null || context.currentBranch === null) {
      return
    }

    this.setState({ busy: true, formError: null })
    try {
      const mergeRequest = await createMergeRequest(
        context.connection,
        context.project.id,
        {
          sourceBranch: context.currentBranch,
          targetBranch,
          title: title.trim(),
          description,
        }
      )
      if (!this.mounted) {
        return
      }
      this.setState(s => ({
        busy: false,
        mergeRequests: [mergeRequest, ...(s.mergeRequests ?? [])],
      }))
      this.showDetail(mergeRequest)
    } catch (e) {
      if (this.mounted) {
        this.setState({ busy: false, formError: errorMessage(e) })
      }
    }
  }

  private postComment = async () => {
    const { context, view, commentDraft } = this.state
    if (context === null || view.kind !== 'detail') {
      return
    }

    this.setState({ busy: true, commentsError: null })
    try {
      const note = await addMergeRequestComment(
        context.connection,
        context.project.id,
        view.mergeRequest.iid,
        commentDraft.trim()
      )
      if (this.mounted) {
        this.setState(s => ({
          busy: false,
          commentDraft: '',
          comments: [...(s.comments ?? []), note],
        }))
      }
    } catch (e) {
      if (this.mounted) {
        this.setState({ busy: false, commentsError: errorMessage(e) })
      }
    }
  }

  private openInGitLab = (url: string) => () => openExternal(url)

  private onTitleChanged = (title: string) => this.setState({ title })
  private onDescriptionChanged = (description: string) =>
    this.setState({ description })
  private onTargetChanged = (event: React.FormEvent<HTMLSelectElement>) =>
    this.setState({ targetBranch: event.currentTarget.value })
  private onCommentChanged = (commentDraft: string) =>
    this.setState({ commentDraft })

  // ---- Rendering ---------------------------------------------------------

  public render() {
    const { view, busy } = this.state
    return (
      <Dialog
        id="gitlab-merge-requests"
        title={this.renderTitle()}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={busy}
      >
        <DialogContent>{this.renderBody()}</DialogContent>
        {view.kind === 'create'
          ? this.renderCreateFooter()
          : this.renderDefaultFooter()}
      </Dialog>
    )
  }

  private renderTitle() {
    const { view } = this.state
    switch (view.kind) {
      case 'create':
        return __DARWIN__ ? 'New Merge Request' : 'New merge request'
      case 'detail':
        return `!${view.mergeRequest.iid} ${view.mergeRequest.title}`
      case 'list':
        return __DARWIN__ ? 'GitLab Merge Requests' : 'GitLab merge requests'
    }
  }

  private renderBody() {
    const { context, loadError, view } = this.state

    if (loadError !== null) {
      return (
        <div className="gitlab-mr-error">
          <p>{loadError}</p>
          {context !== null && (
            <Button onClick={this.refresh}>Try again</Button>
          )}
        </div>
      )
    }

    if (context === null) {
      return (
        <p className="gitlab-mr-loading">
          <Loading /> Loading {this.props.match.projectPath}…
        </p>
      )
    }

    switch (view.kind) {
      case 'list':
        return this.renderList(context)
      case 'create':
        return this.renderCreate(context)
      case 'detail':
        return this.renderDetail(view.mergeRequest)
    }
  }

  private renderList(context: IContext) {
    const { mergeRequests } = this.state
    const current = this.currentBranchMergeRequest

    return (
      <div className="gitlab-mr-list">
        <div className="gitlab-mr-project">
          <span>{context.project.pathWithNamespace}</span>
          <Button onClick={this.refresh} tooltip="Refresh">
            <Octicon symbol={octicons.sync} />
          </Button>
        </div>

        {context.currentBranch !== null && mergeRequests !== null && (
          <div className="gitlab-mr-current">
            {current === undefined ? (
              <>
                <span>
                  No open merge request for <code>{context.currentBranch}</code>
                  .
                </span>
                <Button onClick={this.showCreate}>
                  <Octicon symbol={octicons.gitPullRequest} /> Create merge
                  request
                </Button>
              </>
            ) : (
              <span>
                <code>{context.currentBranch}</code> is in{' '}
                <Button onClick={this.showDetailFor(current)}>
                  !{current.iid}
                </Button>
              </span>
            )}
          </div>
        )}

        {mergeRequests === null ? (
          <p className="gitlab-mr-loading">
            <Loading /> Loading merge requests…
          </p>
        ) : mergeRequests.length === 0 ? (
          <p>There are no open merge requests.</p>
        ) : (
          <ul className="gitlab-mr-items">
            {mergeRequests.map(mr => (
              <li key={mr.iid}>
                <button
                  type="button"
                  className="gitlab-mr-item"
                  onClick={this.showDetailFor(mr)}
                >
                  <span className="gitlab-mr-item-title">
                    !{mr.iid} {mr.draft ? '[Draft] ' : ''}
                    {mr.title}
                  </span>
                  <span className="gitlab-mr-item-meta">
                    {mr.sourceBranch} → {mr.targetBranch}
                    {mr.author ? ` · @${mr.author.username}` : ''}
                    {mr.userNotesCount > 0
                      ? ` · ${mr.userNotesCount} comment${
                          mr.userNotesCount === 1 ? '' : 's'
                        }`
                      : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  private showDetailFor = (mergeRequest: IGitLabMergeRequest) => () =>
    this.showDetail(mergeRequest)

  private renderCreate(context: IContext) {
    const { branches, title, description, targetBranch, formError, busy } =
      this.state
    const targets =
      targetBranch !== '' && !branches.includes(targetBranch)
        ? [targetBranch, ...branches]
        : branches

    return (
      <div className="gitlab-mr-create">
        <p>
          From <code>{context.currentBranch}</code>. Push the branch first if
          GitLab doesn't have it yet.
        </p>
        <Select
          label="Target branch"
          value={targetBranch}
          onChange={this.onTargetChanged}
          disabled={busy}
        >
          {targets.map(b => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
        <TextBox
          label="Title"
          value={title}
          onValueChanged={this.onTitleChanged}
          disabled={busy}
          autoFocus={true}
        />
        <TextArea
          label="Description"
          value={description}
          onValueChanged={this.onDescriptionChanged}
          rows={6}
          disabled={busy}
        />
        {formError !== null && <p className="gitlab-mr-error">{formError}</p>}
      </div>
    )
  }

  private renderDetail(mr: IGitLabMergeRequest) {
    const { comments, commentsError, commentDraft, busy } = this.state

    return (
      <div className="gitlab-mr-detail">
        <p className="gitlab-mr-item-meta">
          {mr.state}
          {mr.draft ? ' · draft' : ''} · {mr.sourceBranch} → {mr.targetBranch}
          {mr.author ? ` · opened by @${mr.author.username}` : ''}
          {mr.createdAt ? (
            <>
              {' '}
              <RelativeTime date={new Date(mr.createdAt)} />
            </>
          ) : null}
        </p>
        <div className="gitlab-mr-text">
          {mr.description.trim().length > 0
            ? mr.description
            : 'No description.'}
        </div>

        <h3>Comments{comments !== null ? ` (${comments.length})` : ''}</h3>
        {commentsError !== null && (
          <p className="gitlab-mr-error">{commentsError}</p>
        )}
        {comments === null && commentsError === null ? (
          <p className="gitlab-mr-loading">
            <Loading /> Loading comments…
          </p>
        ) : (
          <ul className="gitlab-mr-comments">
            {(comments ?? []).map(note => (
              <li key={note.id}>
                <div className="gitlab-mr-item-meta">
                  {note.author ? `@${note.author.username}` : 'Someone'}
                  {note.createdAt ? (
                    <>
                      {' · '}
                      <RelativeTime date={new Date(note.createdAt)} />
                    </>
                  ) : null}
                </div>
                <div className="gitlab-mr-text">{note.body}</div>
              </li>
            ))}
          </ul>
        )}

        <TextArea
          label="Add a comment"
          value={commentDraft}
          onValueChanged={this.onCommentChanged}
          rows={3}
          disabled={busy}
        />
        <div className="gitlab-mr-comment-actions">
          <Button
            onClick={this.postComment}
            disabled={busy || commentDraft.trim().length === 0}
          >
            Comment
          </Button>
        </div>
      </div>
    )
  }

  private renderCreateFooter() {
    const { title, targetBranch, busy } = this.state
    return (
      <DialogFooter>
        <OkCancelButtonGroup
          okButtonText={
            __DARWIN__ ? 'Create Merge Request' : 'Create merge request'
          }
          okButtonDisabled={
            busy || title.trim().length === 0 || targetBranch.length === 0
          }
          cancelButtonText="Back"
          onCancelButtonClick={this.showList}
        />
      </DialogFooter>
    )
  }

  private renderDefaultFooter() {
    const { view, context } = this.state
    const webURL =
      view.kind === 'detail'
        ? view.mergeRequest.webURL
        : context?.project.webURL

    return (
      <DialogFooter>
        <div className="gitlab-mr-footer">
          {view.kind === 'detail' && (
            <Button onClick={this.showList}>Back</Button>
          )}
          {webURL !== undefined && (
            <Button onClick={this.openInGitLab(webURL)}>
              Open in GitLab <Octicon symbol={octicons.linkExternal} />
            </Button>
          )}
          <Button type="submit">Close</Button>
        </div>
      </DialogFooter>
    )
  }
}

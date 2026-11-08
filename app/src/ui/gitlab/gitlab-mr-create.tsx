import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { TextBox } from '../lib/text-box'
import { GitLabMarkdownEditor } from './gitlab-markdown-editor'
import { GitLabMarkdownContext } from './gitlab-markdown'
import { Select } from '../lib/select'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { git } from '../../lib/git/core'
import {
  IGitLabMergeRequest,
  createMergeRequest,
  fetchBranchNames,
  fetchMergeRequests,
} from '../../lib/gitlab/gitlab-merge-requests'
import {
  ICreateMergeRequestProblem,
  getCreateMergeRequestProblem,
  pickDefaultTarget,
} from '../../lib/gitlab/gitlab-mr-create-checks'
import { Button } from '../lib/button'
import {
  IGitLabMember,
  fetchProjectMembers,
  setDraftInTitle,
} from '../../lib/gitlab/gitlab-merge-request-actions'
import { ErrorBanner, IGitLabMRContext, errorMessage } from './gitlab-mr-common'
import { GitLabMemberPicker } from './gitlab-member-picker'

interface IGitLabMRCreateProps {
  readonly context: IGitLabMRContext
  /** The branch to merge; the dialog only offers creating with one. */
  readonly sourceBranch: string
  readonly onBusyChanged: (busy: boolean) => void
  readonly onCreated: (mr: IGitLabMergeRequest) => void
  /** Tells the dialog what blocks creating, for its footer. */
  readonly onProblemChanged: (
    problem: ICreateMergeRequestProblem | null
  ) => void
  /** Show the branch's existing merge request instead. */
  readonly onOpenExisting: (mr: IGitLabMergeRequest) => void
}

interface IGitLabMRCreateState {
  readonly branches: ReadonlyArray<string> | null
  readonly targetBranch: string
  readonly title: string
  readonly description: string
  readonly draft: boolean
  readonly reviewers: ReadonlyArray<IGitLabMember>
  readonly members: ReadonlyArray<IGitLabMember> | null
  readonly busy: boolean
  readonly error: string | null
  /** The branch's open merge request; undefined while checking. */
  readonly existing: IGitLabMergeRequest | null | undefined
  readonly commitsAhead: number | null
}

/**
 * The new merge request form. The title starts as the latest commit's
 * subject and the description as the list of commits on the branch.
 */
export class GitLabMRCreate extends React.Component<
  IGitLabMRCreateProps,
  IGitLabMRCreateState
> {
  private mounted = false
  /** Whether the user typed a description, so we don't overwrite it. */
  private descriptionEdited = false
  private errorBanner: HTMLDivElement | null = null
  /** The last problem reported to the dialog, to report only changes. */
  private lastProblem: string | null = null

  public constructor(props: IGitLabMRCreateProps) {
    super(props)
    this.state = {
      branches: null,
      targetBranch: props.context.project.defaultBranch ?? '',
      title: props.sourceBranch,
      description: '',
      draft: false,
      reviewers: [],
      members: null,
      busy: false,
      error: null,
      existing: undefined,
      commitsAhead: null,
    }
  }

  public async componentDidMount() {
    this.mounted = true
    const { connection, project, repository } = this.props.context

    git(['log', '-1', '--format=%s'], repository.path, 'gitLabMRTitle')
      .then(r => {
        const subject = r.stdout.trim()
        if (this.mounted && subject.length > 0) {
          this.setState(s =>
            s.title === this.props.sourceBranch ? { title: subject } : null
          )
        }
      })
      .catch(() => undefined)

    fetchProjectMembers(connection, project.id)
      .then(members => this.mounted && this.setState({ members }))
      .catch(() => this.mounted && this.setState({ members: [] }))

    this.fillDescription(this.state.targetBranch)
    this.countCommitsAhead(this.state.targetBranch)

    fetchMergeRequests(connection, project.id, 'opened')
      .then(open => {
        if (this.mounted) {
          this.setState({
            existing:
              open.find(m => m.sourceBranch === this.props.sourceBranch) ??
              null,
          })
        }
      })
      .catch(() => this.mounted && this.setState({ existing: null }))

    try {
      const branches = await fetchBranchNames(connection, project.id)
      if (this.mounted) {
        const { targetBranch } = this.state
        const fallback =
          targetBranch === '' ||
          targetBranch === this.props.sourceBranch ||
          !branches.includes(targetBranch)
        this.setState({ branches })
        if (fallback) {
          const target = pickDefaultTarget(
            project.defaultBranch,
            this.props.sourceBranch,
            branches
          )
          if (target !== targetBranch) {
            this.setState({ targetBranch: target })
            this.fillDescription(target)
            this.countCommitsAhead(target)
          }
        }
      }
    } catch (e) {
      log.warn('[GitLab] could not list branches', e)
      if (this.mounted) {
        this.setState({ branches: [] })
      }
    }
  }

  public componentDidUpdate() {
    const problem = this.problem()
    const key = problem === null ? null : problem.message
    if (key !== this.lastProblem) {
      this.lastProblem = key
      this.props.onProblemChanged(problem)
    }
  }

  public componentWillUnmount() {
    this.mounted = false
  }

  private problem(): ICreateMergeRequestProblem | null {
    const { title, targetBranch, branches, existing, commitsAhead } = this.state
    return getCreateMergeRequestProblem({
      title,
      sourceBranch: this.props.sourceBranch,
      targetBranch,
      remoteBranches: branches,
      existingIid: existing?.iid ?? null,
      commitsAhead,
    })
  }

  /** How many local commits the target branch on GitLab doesn't have. */
  private async countCommitsAhead(target: string) {
    if (target.length === 0) {
      return
    }
    const { repository } = this.props.context
    try {
      const result = await git(
        ['rev-list', '--count', `refs/remotes/origin/${target}..HEAD`],
        repository.path,
        'gitLabMRCommitsAhead',
        { successExitCodes: new Set([0, 128]) }
      )
      if (this.mounted && this.state.targetBranch === target) {
        this.setState({
          commitsAhead:
            result.exitCode === 0 ? parseInt(result.stdout.trim(), 10) : null,
        })
      }
    } catch {
      // Unknown; don't warn.
    }
  }

  /** List the branch's commits that aren't on the target yet. */
  private async fillDescription(target: string) {
    if (this.descriptionEdited || target.length === 0) {
      return
    }
    const { repository } = this.props.context
    try {
      const result = await git(
        [
          'log',
          '--reverse',
          '--format=- %s',
          '--max-count=30',
          `refs/remotes/origin/${target}..HEAD`,
        ],
        repository.path,
        'gitLabMRDescription',
        { successExitCodes: new Set([0, 128]) }
      )
      const lines = result.stdout.trim()
      if (this.mounted && !this.descriptionEdited && result.exitCode === 0) {
        this.setState({ description: lines })
      }
    } catch {
      // No remote-tracking branch for the target; leave it empty.
    }
  }

  /** Called by the dialog when its primary button is pressed. */
  public submit = async () => {
    const { connection, project } = this.props.context
    const { title, description, targetBranch, draft, reviewers, busy } =
      this.state
    const problem = this.problem()
    if (busy || (problem !== null && problem.blocking)) {
      // The reason is shown next to the button and in the form.
      return
    }

    this.setBusy(true)
    this.setState({ error: null })
    try {
      const mr = await createMergeRequest(connection, project.id, {
        sourceBranch: this.props.sourceBranch,
        targetBranch,
        title: setDraftInTitle(title.trim(), draft),
        description,
        reviewerIds: reviewers.map(r => r.id),
      })
      if (this.mounted) {
        this.setBusy(false)
        this.props.onCreated(mr)
      }
    } catch (e) {
      if (this.mounted) {
        this.setBusy(false)
        this.setState({ error: errorMessage(e) }, () =>
          this.errorBanner?.scrollIntoView({ block: 'nearest' })
        )
      }
    }
  }

  private setBusy(busy: boolean) {
    this.setState({ busy })
    this.props.onBusyChanged(busy)
  }

  private onTitleChanged = (title: string) => this.setState({ title })

  private onDescriptionChanged = (description: string) => {
    this.descriptionEdited = true
    this.setState({ description })
  }

  private onTargetChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const targetBranch = event.currentTarget.value
    this.setState({ targetBranch, commitsAhead: null })
    this.fillDescription(targetBranch)
    this.countCommitsAhead(targetBranch)
  }

  private onErrorBannerRef = (el: HTMLDivElement | null) => {
    this.errorBanner = el
  }

  private openExisting = () => {
    if (this.state.existing != null) {
      this.props.onOpenExisting(this.state.existing)
    }
  }

  private onDraftChanged = (event: React.FormEvent<HTMLInputElement>) =>
    this.setState({ draft: event.currentTarget.checked })

  private onReviewersChanged = (reviewers: ReadonlyArray<IGitLabMember>) =>
    this.setState({ reviewers })

  private dismissError = () => this.setState({ error: null })

  public render() {
    const { sourceBranch } = this.props
    const {
      branches,
      targetBranch,
      title,
      description,
      draft,
      reviewers,
      members,
      busy,
      error,
    } = this.state

    const targets = (branches ?? []).filter(b => b !== sourceBranch)
    if (targetBranch !== '' && !targets.includes(targetBranch)) {
      targets.unshift(targetBranch)
    }
    const problem = this.problem()

    const links = {
      projectURL: this.props.context.project.webURL,
      serverURL: this.props.context.connection.serverURL,
    }

    return (
      <GitLabMarkdownContext.Provider value={links}>
        <div className="gl-mr-create">
          {error !== null && (
            <div ref={this.onErrorBannerRef}>
              <ErrorBanner
                message={`GitLab couldn't create the merge request: ${error}`}
                onDismiss={this.dismissError}
              />
            </div>
          )}
          <div className="gl-branch-flow">
            <code className="gl-branch">{sourceBranch}</code>
            <Octicon symbol={octicons.arrowRight} />
            <Select
              label="Into"
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
          </div>
          {problem !== null && (
            <div
              className={problem.blocking ? 'gl-error-banner' : 'gl-warning'}
              role="status"
            >
              <Octicon symbol={octicons.alert} />
              <span>{problem.message}</span>
              {problem.existingIid !== undefined && (
                <Button size="small" onClick={this.openExisting}>
                  View !{problem.existingIid}
                </Button>
              )}
            </div>
          )}
          <div className="gl-create-grid">
            <div className="gl-create-main">
              <TextBox
                label="Title"
                value={title}
                onValueChanged={this.onTitleChanged}
                disabled={busy}
                autoFocus={true}
              />
              <GitLabMarkdownEditor
                label="Description"
                placeholder="Describe the goal of the changes and what reviewers should be aware of."
                value={description}
                onChange={this.onDescriptionChanged}
                minRows={8}
                disabled={busy}
                onSubmitShortcut={this.submit}
              />
              <Checkbox
                label="Mark as draft (can't be merged until marked ready)"
                value={draft ? CheckboxValue.On : CheckboxValue.Off}
                onChange={this.onDraftChanged}
                disabled={busy}
              />
            </div>
            <aside className="gl-sidebar">
              <GitLabMemberPicker
                label="Reviewers"
                members={members}
                selected={reviewers}
                onChange={this.onReviewersChanged}
                disabled={busy}
              />
            </aside>
          </div>
        </div>
      </GitLabMarkdownContext.Provider>
    )
  }
}

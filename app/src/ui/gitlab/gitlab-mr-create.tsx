import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { TextBox } from '../lib/text-box'
import { TextArea } from '../lib/text-area'
import { Select } from '../lib/select'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { git } from '../../lib/git/core'
import {
  IGitLabMergeRequest,
  createMergeRequest,
  fetchBranchNames,
} from '../../lib/gitlab/gitlab-merge-requests'
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

    try {
      const branches = await fetchBranchNames(connection, project.id)
      if (this.mounted) {
        this.setState({ branches })
      }
    } catch (e) {
      log.warn('[GitLab] could not list branches', e)
      if (this.mounted) {
        this.setState({ branches: [] })
      }
    }
  }

  public componentWillUnmount() {
    this.mounted = false
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
    const { title, description, targetBranch, draft, reviewers } = this.state
    if (!this.canSubmit()) {
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
        this.setState({ error: errorMessage(e) })
      }
    }
  }

  public canSubmit() {
    const { title, targetBranch, busy } = this.state
    return (
      !busy &&
      title.trim().length > 0 &&
      targetBranch.length > 0 &&
      targetBranch !== this.props.sourceBranch
    )
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
    this.setState({ targetBranch })
    this.fillDescription(targetBranch)
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
    const notPushed = branches !== null && !branches.includes(sourceBranch)

    return (
      <div className="gl-mr-create">
        {error !== null && (
          <ErrorBanner message={error} onDismiss={this.dismissError} />
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
        {notPushed && (
          <div className="gl-warning" role="status">
            <Octicon symbol={octicons.alert} />
            <span>
              GitLab doesn't have <code>{sourceBranch}</code> yet. Push the
              branch first, then create the merge request.
            </span>
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
            <TextArea
              label="Description"
              value={description}
              onValueChanged={this.onDescriptionChanged}
              rows={8}
              disabled={busy}
              placeholder="What does this change and why?"
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
    )
  }
}

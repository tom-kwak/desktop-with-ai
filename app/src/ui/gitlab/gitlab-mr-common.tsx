import * as React from 'react'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import { GitLabMarkdownEditor } from './gitlab-markdown-editor'
import { Repository } from '../../models/repository'
import { IGitLabAccount } from '../../lib/gitlab/gitlab-accounts-store'
import {
  IGitLabConnection,
  IGitLabMergeRequest,
  IGitLabProjectInfo,
  IGitLabUserRef,
} from '../../lib/gitlab/gitlab-merge-requests'
import { IGitLabPipeline } from '../../lib/gitlab/gitlab-merge-request-actions'

/** What every part of the merge request window needs to talk to GitLab. */
export interface IGitLabMRContext {
  readonly repository: Repository
  readonly connection: IGitLabConnection
  readonly project: IGitLabProjectInfo
  readonly account: IGitLabAccount
  /** The checked-out branch, or null when HEAD is detached. */
  readonly currentBranch: string | null
}

export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

/** Open, merged, closed or draft, colored like GitLab does. */
export function MRStatePill(props: { readonly mr: IGitLabMergeRequest }) {
  const { mr } = props
  const state = mr.state === 'opened' && mr.draft ? 'draft' : mr.state
  const icon =
    state === 'merged'
      ? octicons.gitMerge
      : state === 'closed' || state === 'locked'
      ? octicons.gitPullRequestClosed
      : state === 'draft'
      ? octicons.gitPullRequestDraft
      : octicons.gitPullRequest
  const label =
    state === 'opened' ? 'Open' : state.charAt(0).toUpperCase() + state.slice(1)
  return (
    <span className={classNames('gl-pill', `gl-pill-${state}`)}>
      <Octicon symbol={icon} />
      {label}
    </span>
  )
}

/** A round badge with the user's initials, in a color derived from the name. */
export function UserAvatar(props: {
  readonly user: IGitLabUserRef
  readonly size?: 'small' | 'normal'
}) {
  const { user, size = 'normal' } = props
  const words = user.name.trim().split(/\s+/)
  const initials = (
    words.length > 1 ? words[0][0] + words[words.length - 1][0] : user.name[0]
  ).toUpperCase()
  let hash = 0
  for (const c of user.username) {
    hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  }
  return (
    <span
      className={classNames(
        'gl-avatar',
        `gl-avatar-${size}`,
        `gl-hue-${hash % 6}`
      )}
      aria-hidden={true}
    >
      {initials}
    </span>
  )
}

const pipelineIcons: Record<string, typeof octicons.check> = {
  success: octicons.checkCircle,
  failed: octicons.xCircle,
  running: octicons.sync,
  pending: octicons.clock,
  created: octicons.clock,
  waiting_for_resource: octicons.clock,
  preparing: octicons.clock,
  scheduled: octicons.clock,
  manual: octicons.play,
  canceled: octicons.stop,
  canceling: octicons.stop,
  skipped: octicons.skip,
}

/** A CI status (pipeline, stage or job) as an icon in its color. */
export function CIStatusIcon(props: { readonly status: string }) {
  const { status } = props
  return (
    <span
      className={classNames('gl-ci-icon', `gl-pipeline-${status}`)}
      role="img"
      aria-label={status.replace(/_/g, ' ')}
    >
      <Octicon symbol={pipelineIcons[status] ?? octicons.circle} />
    </span>
  )
}

/** The pipeline status with an icon in the status color. */
export function PipelineStatus(props: { readonly pipeline: IGitLabPipeline }) {
  const { status } = props.pipeline
  const label =
    status === 'success'
      ? 'Pipeline passed'
      : status === 'failed'
      ? 'Pipeline failed'
      : `Pipeline ${status.replace(/_/g, ' ')}`
  return (
    <span className={classNames('gl-pipeline', `gl-pipeline-${status}`)}>
      <Octicon symbol={pipelineIcons[status] ?? octicons.circle} />
      {label}
    </span>
  )
}

interface ICommentBoxProps {
  readonly placeholder: string
  readonly submitLabel: string
  readonly busy: boolean
  readonly onSubmit: (text: string) => Promise<boolean>
  readonly onCancel?: () => void
  /** A second action, e.g. "Add to review". */
  readonly secondaryLabel?: string
  readonly onSecondary?: (text: string) => Promise<boolean>
  readonly autoFocus?: boolean
  readonly rows?: number
}

interface ICommentBoxState {
  readonly text: string
}

/**
 * A markdown comment editor with its buttons. ⌘/Ctrl+Enter posts, Escape
 * cancels, and the text is only cleared once posting succeeded.
 */
export class CommentBox extends React.Component<
  ICommentBoxProps,
  ICommentBoxState
> {
  public state: ICommentBoxState = { text: '' }

  public render() {
    const { placeholder, submitLabel, busy, onCancel, secondaryLabel } =
      this.props
    const empty = this.state.text.trim().length === 0
    return (
      <div className="gl-comment-box">
        <GitLabMarkdownEditor
          placeholder={placeholder}
          value={this.state.text}
          onChange={this.onChanged}
          onSubmitShortcut={this.onSubmit}
          onCancelShortcut={onCancel}
          minRows={this.props.rows ?? 3}
          disabled={busy}
          autoFocus={this.props.autoFocus}
        />
        <div className="gl-comment-box-actions">
          {onCancel !== undefined && (
            <Button onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
          {secondaryLabel !== undefined && (
            <Button onClick={this.onSecondary} disabled={busy || empty}>
              {secondaryLabel}
            </Button>
          )}
          <Button
            className="gl-primary"
            onClick={this.onSubmit}
            disabled={busy || empty}
            tooltip={`${__DARWIN__ ? '⌘' : 'Ctrl+'}Enter`}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    )
  }

  private onChanged = (text: string) => this.setState({ text })

  private onSubmit = () => this.send(this.props.onSubmit)

  private onSecondary = () => {
    if (this.props.onSecondary !== undefined) {
      this.send(this.props.onSecondary)
    }
  }

  private async send(action: (text: string) => Promise<boolean>) {
    const text = this.state.text.trim()
    if (text.length === 0 || this.props.busy) {
      return
    }
    if (await action(text)) {
      this.setState({ text: '' })
    }
  }
}

/** A dismissible error line shown above the content. */
export function ErrorBanner(props: {
  readonly message: string
  readonly onDismiss: () => void
}) {
  return (
    <div className="gl-error-banner" role="alert">
      <Octicon symbol={octicons.alert} />
      <span>{props.message}</span>
      <Button onClick={props.onDismiss} size="small" ariaLabel="Dismiss">
        <Octicon symbol={octicons.x} />
      </Button>
    </div>
  )
}

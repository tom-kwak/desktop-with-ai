import * as React from 'react'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import { RelativeTime } from '../relative-time'
import {
  IDiffExcerptLine,
  IGitLabDiscussion,
  IGitLabNote,
  IGitLabNotePosition,
} from '../../lib/gitlab/gitlab-merge-requests'
import { CommentBox, UserAvatar } from './gitlab-mr-common'

interface IGitLabMRThreadProps {
  readonly discussion: IGitLabDiscussion
  /** Diff lines above a line comment; null to show only the location. */
  readonly excerpt: ReadonlyArray<IDiffExcerptLine> | null
  /** The comment was made on an older version of the branch. */
  readonly outdated: boolean
  /** Hide the file and code, e.g. when shown inside the diff itself. */
  readonly inline?: boolean
  readonly busy: boolean
  readonly onReply: (
    discussion: IGitLabDiscussion,
    text: string
  ) => Promise<boolean>
  readonly onResolve: (discussion: IGitLabDiscussion, resolved: boolean) => void
  readonly onShowInDiff?: (position: IGitLabNotePosition) => void
}

interface IGitLabMRThreadState {
  readonly replying: boolean
  /** Resolved threads start collapsed, like on GitLab. */
  readonly expanded: boolean
}

/** `src/app.ts:12`, or `src/app.ts:10-12` for a comment on several lines. */
export function describePosition(position: IGitLabNotePosition) {
  const end = position.newLine ?? position.oldLine
  const start = position.startNewLine ?? position.startOldLine
  const lines = start !== null && start !== end ? `${start}-${end}` : `${end}`
  const path = position.newLine !== null ? position.newPath : position.oldPath
  return `${path}:${lines}`
}

/** A comment thread: the comment, its replies, and reply/resolve actions. */
export class GitLabMRThread extends React.Component<
  IGitLabMRThreadProps,
  IGitLabMRThreadState
> {
  public constructor(props: IGitLabMRThreadProps) {
    super(props)
    this.state = { replying: false, expanded: !props.discussion.resolved }
  }

  private startReply = () => this.setState({ replying: true })
  private cancelReply = () => this.setState({ replying: false })
  private toggleExpanded = () => this.setState(s => ({ expanded: !s.expanded }))

  private onReply = async (text: string) => {
    const ok = await this.props.onReply(this.props.discussion, text)
    if (ok) {
      this.setState({ replying: false })
    }
    return ok
  }

  private toggleResolved = () => {
    const { discussion } = this.props
    this.props.onResolve(discussion, !discussion.resolved)
    this.setState({ expanded: discussion.resolved })
  }

  private showInDiff = () => {
    const { position } = this.props.discussion
    if (position !== null && this.props.onShowInDiff !== undefined) {
      this.props.onShowInDiff(position)
    }
  }

  public render() {
    const { discussion, inline } = this.props
    const [first, ...replies] = discussion.notes
    const resolvable =
      discussion.position !== null || discussion.notes.length > 1

    return (
      <div
        className={classNames('gl-thread', {
          resolved: discussion.resolved,
          'gl-thread-inline': inline,
        })}
      >
        {discussion.position !== null && !inline && this.renderLocation()}
        {discussion.resolved && !this.state.expanded ? (
          <button
            type="button"
            className="gl-thread-collapsed"
            onClick={this.toggleExpanded}
          >
            <Octicon symbol={octicons.checkCircle} />
            Resolved thread · {discussion.notes.length} comment
            {discussion.notes.length === 1 ? '' : 's'} · Show
          </button>
        ) : (
          <>
            {this.renderNote(first)}
            {replies.length > 0 && (
              <div className="gl-thread-replies">
                {replies.map(n => this.renderNote(n))}
              </div>
            )}
            {this.renderActions(resolvable)}
          </>
        )}
      </div>
    )
  }

  private renderLocation() {
    const { discussion, excerpt, outdated } = this.props
    const position = discussion.position as IGitLabNotePosition
    return (
      <div className="gl-thread-location">
        <div className="gl-thread-file">
          <Octicon symbol={octicons.fileDiff} />
          {this.props.onShowInDiff !== undefined && !outdated ? (
            <button
              type="button"
              className="gl-link-button"
              onClick={this.showInDiff}
              aria-label={`Show ${describePosition(position)} in Changes`}
            >
              {describePosition(position)}
            </button>
          ) : (
            <span>{describePosition(position)}</span>
          )}
          {outdated && <span className="gl-tag">outdated</span>}
          {discussion.resolved && (
            <span className="gl-tag gl-tag-success">resolved</span>
          )}
        </div>
        {excerpt !== null && <DiffExcerpt lines={excerpt} />}
      </div>
    )
  }

  private renderNote(note: IGitLabNote) {
    return (
      <div key={note.id} className="gl-note">
        {note.author !== null && <UserAvatar user={note.author} />}
        <div className="gl-note-content">
          <div className="gl-meta">
            <strong>{note.author?.name ?? 'Someone'}</strong>
            {note.author !== null && ` @${note.author.username}`}
            {note.createdAt !== '' && (
              <>
                {' · '}
                <RelativeTime date={new Date(note.createdAt)} />
              </>
            )}
          </div>
          <div className="gl-note-body">{note.body}</div>
        </div>
      </div>
    )
  }

  private renderActions(resolvable: boolean) {
    const { busy, discussion } = this.props
    if (this.state.replying) {
      return (
        <div className="gl-thread-reply">
          <CommentBox
            placeholder="Write a reply"
            submitLabel="Reply"
            busy={busy}
            onSubmit={this.onReply}
            onCancel={this.cancelReply}
            autoFocus={true}
            rows={2}
          />
        </div>
      )
    }
    return (
      <div className="gl-thread-actions">
        <button
          type="button"
          className="gl-reply-placeholder"
          onClick={this.startReply}
          disabled={busy}
        >
          <Octicon symbol={octicons.reply} />
          Reply…
        </button>
        {resolvable && (
          <Button size="small" onClick={this.toggleResolved} disabled={busy}>
            <Octicon symbol={octicons.checkCircle} />
            {discussion.resolved ? 'Unresolve' : 'Resolve thread'}
          </Button>
        )}
      </div>
    )
  }
}

/** A few diff lines with line numbers, for showing what a comment is on. */
export function DiffExcerpt(props: {
  readonly lines: ReadonlyArray<IDiffExcerptLine>
}) {
  return (
    <table className="gl-diff gl-diff-excerpt">
      <tbody>
        {props.lines.map((line, i) => (
          <tr
            key={i}
            className={classNames(`gl-diff-${line.kind}`, {
              commented: line.commented,
            })}
          >
            <td className="gl-diff-num">{line.oldLine ?? ''}</td>
            <td className="gl-diff-num">{line.newLine ?? ''}</td>
            <td className="gl-diff-text">
              <span className="gl-diff-marker">
                {line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' '}
              </span>
              {line.text}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

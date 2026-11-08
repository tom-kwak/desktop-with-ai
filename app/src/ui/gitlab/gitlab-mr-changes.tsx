import * as React from 'react'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import {
  DiffDisplayRow,
  IGitLabDiffFile,
  IGitLabDiscussion,
  IGitLabNotePosition,
  parseDiffForDisplay,
} from '../../lib/gitlab/gitlab-merge-requests'
import {
  IGitLabDraftNote,
  IGitLabLineTarget,
} from '../../lib/gitlab/gitlab-merge-request-actions'
import { CommentBox } from './gitlab-mr-common'
import { GitLabMRThread } from './gitlab-mr-thread'

interface IGitLabMRChangesProps {
  readonly files: ReadonlyArray<IGitLabDiffFile> | null
  readonly discussions: ReadonlyArray<IGitLabDiscussion>
  readonly drafts: ReadonlyArray<IGitLabDraftNote>
  /** The MR's current head; comments on other commits aren't placed. */
  readonly headSha: string | null
  readonly busy: boolean
  /** Whether line comments can be added (needs the MR's diff refs). */
  readonly canComment: boolean
  /** A line to scroll to and highlight, e.g. from the Overview tab. */
  readonly focus: IGitLabNotePosition | null
  readonly onComment: (
    line: IGitLabLineTarget,
    text: string,
    asDraft: boolean
  ) => Promise<boolean>
  readonly onReply: (d: IGitLabDiscussion, text: string) => Promise<boolean>
  readonly onResolve: (d: IGitLabDiscussion, resolved: boolean) => void
  readonly onDeleteDraft: (draft: IGitLabDraftNote) => void
}

interface IGitLabMRChangesState {
  readonly collapsed: ReadonlySet<string>
  /** The line the comment form is open on, as `file|old|new`. */
  readonly commentingOn: string | null
}

type LineRow = Exclude<DiffDisplayRow, { kind: 'hunk' }>

const fileKey = (f: IGitLabDiffFile) => `${f.oldPath}\u0000${f.newPath}`
const lineKey = (f: IGitLabDiffFile, row: LineRow) =>
  `${fileKey(f)}|${row.oldLine ?? ''}|${row.newLine ?? ''}`

/** Whether a comment anchored at `line` belongs on this diff row. */
function isOnRow(
  file: IGitLabDiffFile,
  row: LineRow,
  line: {
    oldPath: string
    newPath: string
    oldLine: number | null
    newLine: number | null
  }
) {
  if (line.newPath !== file.newPath && line.oldPath !== file.oldPath) {
    return false
  }
  return line.newLine !== null
    ? row.newLine === line.newLine
    : row.kind === 'delete' && row.oldLine === line.oldLine
}

/** The diff of a merge request, with comments where they were left. */
export class GitLabMRChanges extends React.Component<
  IGitLabMRChangesProps,
  IGitLabMRChangesState
> {
  public state: IGitLabMRChangesState = {
    collapsed: new Set(),
    commentingOn: null,
  }

  private focusedRow: HTMLTableRowElement | null = null

  public componentDidMount() {
    this.scrollToFocus()
  }

  public componentDidUpdate(prevProps: IGitLabMRChangesProps) {
    if (
      prevProps.focus !== this.props.focus ||
      prevProps.files !== this.props.files
    ) {
      this.scrollToFocus()
    }
  }

  private scrollToFocus() {
    this.focusedRow?.scrollIntoView({ block: 'center' })
  }

  private onFocusedRowRef = (row: HTMLTableRowElement | null) => {
    this.focusedRow = row
  }

  private toggleFile = (file: IGitLabDiffFile) => () =>
    this.setState(s => {
      const collapsed = new Set(s.collapsed)
      const key = fileKey(file)
      if (collapsed.has(key)) {
        collapsed.delete(key)
      } else {
        collapsed.add(key)
      }
      return { collapsed }
    })

  private openComment = (key: string) => () =>
    this.setState({ commentingOn: key })

  private closeComment = () => this.setState({ commentingOn: null })

  private comment =
    (file: IGitLabDiffFile, row: LineRow, asDraft: boolean) =>
    async (text: string) => {
      const ok = await this.props.onComment(
        {
          oldPath: file.oldPath,
          newPath: file.newPath,
          // GitLab wants both numbers for unchanged lines, one otherwise.
          oldLine: row.kind === 'add' ? null : row.oldLine,
          newLine: row.kind === 'delete' ? null : row.newLine,
        },
        text,
        asDraft
      )
      if (ok) {
        this.setState({ commentingOn: null })
      }
      return ok
    }

  private deleteDraft = (draft: IGitLabDraftNote) => () =>
    this.props.onDeleteDraft(draft)

  public render() {
    const { files } = this.props
    if (files === null) {
      return <div className="gl-empty">Loading changes…</div>
    }
    if (files.length === 0) {
      return <div className="gl-empty">No changes.</div>
    }

    const placed = this.props.discussions.filter(
      d =>
        d.position !== null &&
        (d.position.headSha === null ||
          this.props.headSha === null ||
          d.position.headSha === this.props.headSha)
    )

    return (
      <div className="gl-changes">
        <div className="gl-meta gl-changes-summary">
          {files.length} changed file{files.length === 1 ? '' : 's'}
          {this.props.canComment &&
            ' · Hover over a line and click + to comment on it'}
        </div>
        {files.map(file => this.renderFile(file, placed))}
      </div>
    )
  }

  private renderFile(
    file: IGitLabDiffFile,
    discussions: ReadonlyArray<IGitLabDiscussion>
  ) {
    const key = fileKey(file)
    const collapsed = this.state.collapsed.has(key)
    const rows = parseDiffForDisplay(file.diff)
    const lines = rows.filter((r): r is LineRow => r.kind !== 'hunk')
    const added = lines.filter(r => r.kind === 'add').length
    const removed = lines.filter(r => r.kind === 'delete').length
    const name =
      file.oldPath === file.newPath
        ? file.newPath
        : `${file.oldPath} → ${file.newPath}`

    return (
      <section key={key} className="gl-file">
        <button
          type="button"
          className="gl-file-header"
          onClick={this.toggleFile(file)}
          aria-expanded={!collapsed}
        >
          <Octicon
            symbol={collapsed ? octicons.chevronRight : octicons.chevronDown}
          />
          <span className="gl-file-name">{name}</span>
          <span className="gl-diffstat">
            <span className="gl-diffstat-add">+{added}</span>
            <span className="gl-diffstat-del">−{removed}</span>
          </span>
        </button>
        {!collapsed &&
          (rows.length === 0 ? (
            <div className="gl-meta gl-file-empty">
              GitLab didn't send this diff (it may be binary or too large).
            </div>
          ) : (
            <table className="gl-diff">
              <tbody>
                {rows.map((row, i) =>
                  row.kind === 'hunk' ? (
                    <tr key={i} className="gl-diff-hunk">
                      <td colSpan={3}>{row.text}</td>
                    </tr>
                  ) : (
                    this.renderLine(file, row, i, discussions)
                  )
                )}
              </tbody>
            </table>
          ))}
      </section>
    )
  }

  private renderLine(
    file: IGitLabDiffFile,
    row: LineRow,
    index: number,
    discussions: ReadonlyArray<IGitLabDiscussion>
  ) {
    const { canComment, busy, focus } = this.props
    const key = lineKey(file, row)
    const threads = discussions.filter(
      d => d.position !== null && isOnRow(file, row, d.position)
    )
    const drafts = this.props.drafts.filter(
      d => d.line !== null && isOnRow(file, row, d.line)
    )
    const focused = focus !== null && isOnRow(file, row, focus)
    const commenting = this.state.commentingOn === key

    const extras = new Array<JSX.Element>()
    if (threads.length > 0 || drafts.length > 0 || commenting) {
      extras.push(
        <tr key={`${index}-extra`} className="gl-diff-comments">
          <td colSpan={3}>
            {threads.map(d => (
              <GitLabMRThread
                key={d.id}
                discussion={d}
                excerpt={null}
                outdated={false}
                inline={true}
                busy={busy}
                onReply={this.props.onReply}
                onResolve={this.props.onResolve}
              />
            ))}
            {drafts.map(d => (
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
            {commenting && (
              <CommentBox
                placeholder="Comment on this line"
                submitLabel="Add comment now"
                secondaryLabel={
                  this.props.drafts.length > 0
                    ? 'Add to review'
                    : 'Start a review'
                }
                busy={busy}
                onSubmit={this.comment(file, row, false)}
                onSecondary={this.comment(file, row, true)}
                onCancel={this.closeComment}
                autoFocus={true}
                rows={2}
              />
            )}
          </td>
        </tr>
      )
    }

    return [
      <tr
        key={index}
        ref={focused ? this.onFocusedRowRef : undefined}
        className={classNames(`gl-diff-${row.kind}`, { focused })}
      >
        <td className="gl-diff-num">{row.oldLine ?? ''}</td>
        <td className="gl-diff-num">
          {row.newLine ?? ''}
          {canComment && !commenting && (
            <button
              type="button"
              className="gl-add-comment"
              aria-label="Comment on this line"
              onClick={this.openComment(key)}
            >
              <Octicon symbol={octicons.plus} />
            </button>
          )}
        </td>
        <td className="gl-diff-text">
          <span className="gl-diff-marker">
            {row.kind === 'add' ? '+' : row.kind === 'delete' ? '-' : ' '}
          </span>
          {row.text}
        </td>
      </tr>,
      ...extras,
    ]
  }
}

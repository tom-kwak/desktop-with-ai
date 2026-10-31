import * as React from 'react'
import { Dialog, DialogContent } from '../dialog'
import { DefaultDialogFooter } from '../dialog/default-dialog-footer'
import { Button } from '../lib/button'
import { Select } from '../lib/select'
import { TextBox } from '../lib/text-box'
import { Repository } from '../../models/repository'
import {
  IReviewFilter,
  IReviewHistoryEntry,
  NoReviewFilter,
  ReviewKind,
  deleteReview,
  describeReviewEntry,
  filterReviews,
  getReviewKind,
  loadAllReviewHistory,
} from '../../lib/ai/ai-review-history'
import { AIAgentId, AIAgents } from '../../lib/ai/ai-settings'
import { AIReviewMarkdown } from './ai-review-markdown'

interface IAIReviewHistoryDialogProps {
  readonly repository: Repository
  readonly onDismissed: () => void
}

interface IAIReviewHistoryDialogState {
  /** Every saved review of the repository, newest first. */
  readonly entries: ReadonlyArray<IReviewHistoryEntry>
  readonly filter: IReviewFilter
  readonly selectedId: string | null
}

/** Commit messages are shown open when there are only a few commits. */
const MaxCommitsShownOpen = 3

function describeKind(entry: IReviewHistoryEntry) {
  return getReviewKind(entry) === 'branch' ? 'Branch' : 'Commits'
}

/** Browses every review saved for a repository, not just those of one input. */
export class AIReviewHistoryDialog extends React.Component<
  IAIReviewHistoryDialogProps,
  IAIReviewHistoryDialogState
> {
  public constructor(props: IAIReviewHistoryDialogProps) {
    super(props)

    const entries = loadAllReviewHistory(props.repository)
    this.state = {
      entries,
      filter: NoReviewFilter,
      selectedId: entries[0]?.id ?? null,
    }
  }

  private get visible() {
    return filterReviews(this.state.entries, this.state.filter)
  }

  /** The review shown: the selected one if the filter still lets it through. */
  private get selected(): IReviewHistoryEntry | undefined {
    const { visible } = this
    return visible.find(e => e.id === this.state.selectedId) ?? visible[0]
  }

  private onTextChanged = (text: string) => {
    this.setState({ filter: { ...this.state.filter, text } })
  }

  private onKindChanged = (e: React.FormEvent<HTMLSelectElement>) => {
    const kind = e.currentTarget.value as ReviewKind | 'all'
    this.setState({ filter: { ...this.state.filter, kind } })
  }

  private onAgentChanged = (e: React.FormEvent<HTMLSelectElement>) => {
    const agent = e.currentTarget.value as AIAgentId | 'all'
    this.setState({ filter: { ...this.state.filter, agent } })
  }

  private onClearFilter = () => {
    this.setState({ filter: NoReviewFilter })
  }

  private onDelete = () => {
    const { selected, visible } = this
    if (selected === undefined) {
      return
    }

    deleteReview(this.props.repository, selected.id)

    // Show the review that took the deleted one's place in the list.
    const index = visible.indexOf(selected)
    const remaining = visible.filter(e => e !== selected)
    this.setState({
      entries: this.state.entries.filter(e => e.id !== selected.id),
      selectedId: (remaining[index] ?? remaining[index - 1])?.id ?? null,
    })
  }

  private renderFilter() {
    const { filter } = this.state

    return (
      <div className="ai-past-filter">
        <TextBox
          label="Filter"
          value={filter.text}
          placeholder="Commit, message, branch or review text"
          onValueChanged={this.onTextChanged}
        />
        <Select label="Type" value={filter.kind} onChange={this.onKindChanged}>
          <option value="all">All</option>
          <option value="commits">Commits</option>
          <option value="branch">Branch</option>
        </Select>
        <Select
          label="Agent"
          value={filter.agent}
          onChange={this.onAgentChanged}
        >
          <option value="all">All</option>
          {AIAgents.map(a => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </Select>
        <Button onClick={this.onClearFilter}>Clear</Button>
      </div>
    )
  }

  private renderList(selected: IReviewHistoryEntry | undefined) {
    return (
      <ul className="ai-past-list" aria-label="Saved reviews">
        {this.visible.map(e => (
          <li key={e.id}>
            <ReviewListItem
              entry={e}
              isSelected={e === selected}
              onSelected={this.onSelected}
            />
          </li>
        ))}
      </ul>
    )
  }

  private onSelected = (selectedId: string) => {
    this.setState({ selectedId })
  }

  private renderCommits(entry: IReviewHistoryEntry) {
    const { commits, branch } = entry

    if (commits === undefined) {
      return (
        <p className="ai-analysis-meta">
          Which commits were reviewed was not recorded for this review.
        </p>
      )
    }

    return (
      <section className="ai-past-commits">
        <h3>
          Reviewed commits ({commits.length}
          {branch !== undefined && ` since ${branch.baseRef}`})
        </h3>
        {commits.length === 0 && <p>No commits, only changes were reviewed.</p>}
        {commits.map(c => (
          <details key={c.sha} open={commits.length <= MaxCommitsShownOpen}>
            <summary>
              <code>{c.shortSha}</code> {c.summary}
            </summary>
            <pre className="ai-past-message">
              {c.body === '' ? c.summary : `${c.summary}\n\n${c.body}`}
            </pre>
          </details>
        ))}
      </section>
    )
  }

  private renderDetail(selected: IReviewHistoryEntry) {
    return (
      <div className="ai-past-detail">
        <h3>{selected.subject ?? 'Review'}</h3>
        <p className="ai-analysis-meta">
          {describeKind(selected)}
          {selected.branch &&
            ` · ${selected.branch.name} against ${selected.branch.baseRef}`}{' '}
          · {describeReviewEntry(selected)}
          {selected.repositoryAccess ? ' · reads repository' : ''}
        </p>
        {this.renderCommits(selected)}
        <AIReviewMarkdown markdown={selected.text} />
        <div className="ai-past-actions">
          <Button onClick={this.onDelete}>Delete this review</Button>
        </div>
      </div>
    )
  }

  private renderBody() {
    const { entries } = this.state
    const selected = this.selected

    if (entries.length === 0) {
      return <p>There are no saved reviews for this repository yet.</p>
    }

    return (
      <>
        {this.renderFilter()}
        <p className="ai-analysis-meta">
          {this.visible.length} of {entries.length} reviews
        </p>
        {selected === undefined ? (
          <p>No saved review matches the filter.</p>
        ) : (
          <div className="ai-past-layout">
            {this.renderList(selected)}
            {this.renderDetail(selected)}
          </div>
        )}
      </>
    )
  }

  public render() {
    return (
      <Dialog
        id="ai-past-reviews"
        title={__DARWIN__ ? 'Past AI Reviews' : 'Past AI reviews'}
        onSubmit={this.props.onDismissed}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>{this.renderBody()}</DialogContent>
        <DefaultDialogFooter />
      </Dialog>
    )
  }
}

interface IReviewListItemProps {
  readonly entry: IReviewHistoryEntry
  readonly isSelected: boolean
  readonly onSelected: (id: string) => void
}

/** One saved review in the list: what it covered and when it was made. */
class ReviewListItem extends React.Component<IReviewListItemProps> {
  private onClick = () => {
    this.props.onSelected(this.props.entry.id)
  }

  public render() {
    const { entry, isSelected } = this.props

    return (
      <button
        type="button"
        className={isSelected ? 'ai-past-item selected' : 'ai-past-item'}
        aria-pressed={isSelected}
        onClick={this.onClick}
      >
        <span className="ai-past-item-title">{entry.subject ?? 'Review'}</span>
        <span className="ai-past-item-meta">
          {describeKind(entry)} · {new Date(entry.createdAt).toLocaleString()}
        </span>
      </button>
    )
  }
}

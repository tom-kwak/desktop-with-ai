import * as React from 'react'
import { Dialog, DialogContent } from '../dialog'
import { DefaultDialogFooter } from '../dialog/default-dialog-footer'
import { Button } from '../lib/button'
import { Select } from '../lib/select'
import { Repository } from '../../models/repository'
import {
  IReviewHistoryEntry,
  deleteReview,
  describeReviewEntry,
  loadAllReviewHistory,
} from '../../lib/ai/ai-review-history'
import { AIReviewMarkdown } from './ai-review-markdown'

interface IAIReviewHistoryDialogProps {
  readonly repository: Repository
  readonly onDismissed: () => void
}

interface IAIReviewHistoryDialogState {
  /** Every saved review of the repository, newest first. */
  readonly entries: ReadonlyArray<IReviewHistoryEntry>
  readonly selectedId: string | null
}

const MaxSubjectLength = 60

function describeSubject(entry: IReviewHistoryEntry) {
  const subject = entry.subject ?? 'Review'
  return subject.length > MaxSubjectLength
    ? `${subject.slice(0, MaxSubjectLength)}…`
    : subject
}

/** Browses every review saved for a repository, not just those of one input. */
export class AIReviewHistoryDialog extends React.Component<
  IAIReviewHistoryDialogProps,
  IAIReviewHistoryDialogState
> {
  public constructor(props: IAIReviewHistoryDialogProps) {
    super(props)

    const entries = loadAllReviewHistory(props.repository)
    this.state = { entries, selectedId: entries[0]?.id ?? null }
  }

  private onSelected = (e: React.FormEvent<HTMLSelectElement>) => {
    this.setState({ selectedId: e.currentTarget.value })
  }

  private onDelete = () => {
    const { entries, selectedId } = this.state
    if (selectedId === null) {
      return
    }

    deleteReview(this.props.repository, selectedId)

    // Show the review that took the deleted one's place in the list.
    const index = entries.findIndex(e => e.id === selectedId)
    const remaining = entries.filter(e => e.id !== selectedId)
    this.setState({
      entries: remaining,
      selectedId: (remaining[index] ?? remaining[index - 1])?.id ?? null,
    })
  }

  private renderEntries() {
    const { entries, selectedId } = this.state
    const selected = entries.find(e => e.id === selectedId)

    if (selected === undefined) {
      return <p>There are no saved reviews for this repository yet.</p>
    }

    return (
      <>
        <div className="ai-review-history">
          <Select
            label="Saved reviews"
            value={selected.id}
            onChange={this.onSelected}
          >
            {entries.map(e => (
              <option key={e.id} value={e.id}>
                {new Date(e.createdAt).toLocaleString()} · {describeSubject(e)}
              </option>
            ))}
          </Select>
          <Button onClick={this.onDelete}>Delete</Button>
        </div>
        <p className="ai-analysis-meta">
          {selected.subject !== undefined && `${selected.subject} · `}
          {describeReviewEntry(selected)}
          {selected.repositoryAccess ? ' · reads repository' : ''}
        </p>
        <AIReviewMarkdown markdown={selected.text} />
      </>
    )
  }

  public render() {
    return (
      <Dialog
        id="ai-analysis"
        title={__DARWIN__ ? 'Past AI Reviews' : 'Past AI reviews'}
        onSubmit={this.props.onDismissed}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>{this.renderEntries()}</DialogContent>
        <DefaultDialogFooter />
      </Dialog>
    )
  }
}

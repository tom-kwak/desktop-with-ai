import * as React from 'react'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { DialogStackContext } from '../dialog'
import { Repository } from '../../models/repository'
import { Commit } from '../../models/commit'
import { getAIAnalysisInput } from '../../lib/git/ai-analysis-input'
import { AIAnalysisDialog } from './ai-analysis-dialog'
import { AIBranchReviewDialog } from './ai-branch-review-dialog'
import { AIReviewHistoryDialog } from './ai-review-history-dialog'
import { AISettingsDialog } from './ai-settings-dialog'

/** Short description of the commits for the review dialog and its history. */
function describeCommits(commits: ReadonlyArray<Commit>): string {
  const [first] = commits
  const more = commits.length > 1 ? ` (+${commits.length - 1} more)` : ''
  return `${first.shortSha} ${first.summary}${more}`
}

interface IAIAnalysisBarProps {
  readonly repository: Repository
  /** The selected commits; empty when there is no valid selection. */
  readonly commits: ReadonlyArray<Commit>

  /**
   * When given, the bar is rendered above this content in a column, for
   * history views that have no bar of their own (e.g. nothing selected).
   */
  readonly children?: React.ReactNode
}

/** The AI dialog currently shown, if any. */
type AIDialog = 'commits' | 'branch' | 'history' | 'settings'

interface IAIAnalysisBarState {
  readonly dialog: AIDialog | null
  /** The commits being reviewed, which stay put if the selection changes. */
  readonly reviewedCommits: ReadonlyArray<Commit>
}

/**
 * The buttons of the history view that open the AI settings, the branch
 * review and the review of the selected commits, plus the dialogs they open.
 */
export class AIAnalysisBar extends React.Component<
  IAIAnalysisBarProps,
  IAIAnalysisBarState
> {
  public constructor(props: IAIAnalysisBarProps) {
    super(props)
    this.state = { dialog: null, reviewedCommits: [] }
  }

  private onOpenCommits = () =>
    this.setState({ dialog: 'commits', reviewedCommits: this.props.commits })

  private onOpenBranch = () => this.setState({ dialog: 'branch' })

  private onOpenHistory = () => this.setState({ dialog: 'history' })

  private onOpenSettings = () => this.setState({ dialog: 'settings' })

  private onCloseDialog = () => this.setState({ dialog: null })

  private getCommitsInput = () =>
    getAIAnalysisInput(this.props.repository, this.state.reviewedCommits)

  private renderDialog() {
    const { repository } = this.props
    const { reviewedCommits } = this.state

    // These dialogs aren't part of the app's popup stack, so each one has to
    // declare itself top-most or `Dialog` never calls `showModal()`.
    switch (this.state.dialog) {
      case null:
        return null
      case 'commits':
        return (
          <DialogStackContext.Provider value={{ isTopMost: true }}>
            <AIAnalysisDialog
              repository={repository}
              title={__DARWIN__ ? 'AI Commit Review' : 'AI commit review'}
              subject={describeCommits(reviewedCommits)}
              getInput={this.getCommitsInput}
              onDismissed={this.onCloseDialog}
            />
          </DialogStackContext.Provider>
        )
      case 'branch':
        return (
          <DialogStackContext.Provider value={{ isTopMost: true }}>
            <AIBranchReviewDialog
              repository={repository}
              onDismissed={this.onCloseDialog}
            />
          </DialogStackContext.Provider>
        )
      case 'history':
        return (
          <DialogStackContext.Provider value={{ isTopMost: true }}>
            <AIReviewHistoryDialog
              repository={repository}
              onDismissed={this.onCloseDialog}
            />
          </DialogStackContext.Provider>
        )
      case 'settings':
        return (
          <DialogStackContext.Provider value={{ isTopMost: true }}>
            <AISettingsDialog
              repository={repository}
              onDismissed={this.onCloseDialog}
            />
          </DialogStackContext.Provider>
        )
    }
  }

  private renderBar() {
    const { commits } = this.props
    const count = commits.length

    return (
      <div className="ai-analysis-bar">
        <Button
          onClick={this.onOpenSettings}
          tooltip="AI review settings"
          ariaLabel="AI review settings"
        >
          <Octicon symbol={octicons.gear} />
        </Button>
        <Button onClick={this.onOpenHistory}>
          <Octicon symbol={octicons.history} /> Past reviews
        </Button>
        <Button onClick={this.onOpenBranch}>
          <Octicon symbol={octicons.gitBranch} /> Review branch
        </Button>
        <Button onClick={this.onOpenCommits} disabled={count === 0}>
          <Octicon symbol={octicons.copilot} /> Review{' '}
          {count > 0 ? `${count} commit${count > 1 ? 's' : ''}` : 'commits'}
        </Button>
        {this.renderDialog()}
      </div>
    )
  }

  public render() {
    const { children } = this.props

    if (children === undefined) {
      return this.renderBar()
    }

    return (
      <div className="ai-history-empty">
        {this.renderBar()}
        {children}
      </div>
    )
  }
}

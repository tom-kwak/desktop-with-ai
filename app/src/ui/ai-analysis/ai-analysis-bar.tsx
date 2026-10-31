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
import { AISettingsDialog } from './ai-settings-dialog'

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
type AIDialog = 'commits' | 'branch' | 'settings'

interface IAIAnalysisBarState {
  readonly dialog: AIDialog | null
}

/**
 * The buttons of the history view that open the AI settings, the branch
 * review and the analysis of the selected commits, plus the dialogs they open.
 */
export class AIAnalysisBar extends React.Component<
  IAIAnalysisBarProps,
  IAIAnalysisBarState
> {
  public constructor(props: IAIAnalysisBarProps) {
    super(props)
    this.state = { dialog: null }
  }

  private onOpenCommits = () => this.setState({ dialog: 'commits' })

  private onOpenBranch = () => this.setState({ dialog: 'branch' })

  private onOpenSettings = () => this.setState({ dialog: 'settings' })

  private onCloseDialog = () => this.setState({ dialog: null })

  private renderDialog() {
    const { repository, commits } = this.props

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
              title={__DARWIN__ ? 'AI Commit Analysis' : 'AI commit analysis'}
              subject={`${commits.length} commit(s)`}
              getInput={() => getAIAnalysisInput(repository, commits)}
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
          tooltip="AI analysis settings"
          ariaLabel="AI analysis settings"
        >
          <Octicon symbol={octicons.gear} />
        </Button>
        <Button onClick={this.onOpenBranch}>
          <Octicon symbol={octicons.gitBranch} /> Review branch
        </Button>
        <Button onClick={this.onOpenCommits} disabled={count === 0}>
          <Octicon symbol={octicons.copilot} /> Analyze{' '}
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

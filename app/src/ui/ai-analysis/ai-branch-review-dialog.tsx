import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Select } from '../lib/select'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Repository } from '../../models/repository'
import { getBranches } from '../../lib/git/for-each-ref'
import {
  IBranchReviewOptions,
  getBranchAnalysisInput,
  getCurrentBranchName,
  getDefaultReviewBaseRef,
} from '../../lib/git/ai-analysis-input'
import { AIAnalysisDialog } from './ai-analysis-dialog'

interface IAIBranchReviewDialogProps {
  readonly repository: Repository
  readonly onDismissed: () => void
}

interface IAIBranchReviewDialogState {
  /** Local and remote branch names the user can pick from. */
  readonly branchNames: ReadonlyArray<string>
  /** The checked-out branch, or `HEAD` when detached. */
  readonly currentBranch: string
  /** The branch to review. Defaults to the current branch. */
  readonly branch: string
  readonly baseRef: string
  readonly includeUncommitted: boolean
  /** Set once the user starts the review. */
  readonly started: IBranchReviewOptions | null
}

/**
 * Asks which branch to review and which branch to compare it against, then
 * reviews everything the reviewed branch changes relative to the base.
 */
export class AIBranchReviewDialog extends React.Component<
  IAIBranchReviewDialogProps,
  IAIBranchReviewDialogState
> {
  private unmounted = false

  public constructor(props: IAIBranchReviewDialogProps) {
    super(props)
    this.state = {
      branchNames: [],
      currentBranch: '',
      branch: '',
      baseRef: '',
      includeUncommitted: false,
      started: null,
    }
  }

  public async componentDidMount() {
    const { repository } = this.props
    try {
      const [currentBranch, baseRef, branches] = await Promise.all([
        getCurrentBranchName(repository),
        getDefaultReviewBaseRef(repository),
        getBranches(repository, 'refs/heads', 'refs/remotes'),
      ])
      if (!this.unmounted) {
        this.setState({
          currentBranch,
          branch: currentBranch,
          baseRef,
          branchNames: branches.map(b => b.name),
        })
      }
    } catch {
      // The selects stay empty and the user can still pick a branch later.
    }
  }

  public componentWillUnmount() {
    this.unmounted = true
  }

  private getInput = () => {
    const { started } = this.state
    return started === null
      ? Promise.reject(new Error('The review has not been started'))
      : getBranchAnalysisInput(this.props.repository, started)
  }

  private onBranchChanged = (e: React.FormEvent<HTMLSelectElement>) =>
    this.setState({ branch: e.currentTarget.value })

  private onBaseRefChanged = (e: React.FormEvent<HTMLSelectElement>) =>
    this.setState({ baseRef: e.currentTarget.value })

  private onIncludeUncommittedChanged = (
    e: React.FormEvent<HTMLInputElement>
  ) => this.setState({ includeUncommitted: e.currentTarget.checked })

  private onSubmit = () => {
    const { branch, baseRef, includeUncommitted } = this.state
    if (branch !== '' && baseRef !== '') {
      this.setState({
        started: { branch, baseRef, includeUncommitted },
      })
    }
  }

  /**
   * The options for a select, with `selected` included even when it isn't a
   * listed branch (such as `HEAD` on a detached checkout).
   */
  private getOptions(selected: string): ReadonlyArray<string> {
    const { branchNames } = this.state
    return selected === '' || branchNames.includes(selected)
      ? branchNames
      : [selected, ...branchNames]
  }

  private renderBranchOptions(selected: string) {
    return this.getOptions(selected).map(name => (
      <option key={name} value={name}>
        {name}
      </option>
    ))
  }

  public render() {
    const { repository, onDismissed } = this.props
    const { started, branch, baseRef, currentBranch } = this.state
    const title = __DARWIN__ ? 'AI Branch Review' : 'AI branch review'

    if (started !== null) {
      return (
        <AIAnalysisDialog
          repository={repository}
          title={title}
          subject={`${started.branch} against ${started.baseRef}`}
          getInput={this.getInput}
          onDismissed={onDismissed}
        />
      )
    }

    // Uncommitted changes only exist for the checked-out branch.
    const canIncludeUncommitted = branch === currentBranch

    return (
      <Dialog
        id="ai-branch-review"
        title={title}
        onSubmit={this.onSubmit}
        onDismissed={onDismissed}
      >
        <DialogContent>
          <p>
            Review the changes on the selected branch compared to a base branch,
            the way a pull request would show them.
          </p>
          <Select
            label="Branch to review"
            value={branch}
            onChange={this.onBranchChanged}
          >
            {this.renderBranchOptions(branch)}
          </Select>
          <Select
            label="Base branch"
            value={baseRef}
            onChange={this.onBaseRefChanged}
          >
            {baseRef === '' ? <option value="">Choose a branch</option> : null}
            {this.renderBranchOptions(baseRef)}
          </Select>
          <Checkbox
            label="Include uncommitted changes to tracked files"
            value={
              this.state.includeUncommitted && canIncludeUncommitted
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            disabled={!canIncludeUncommitted}
            onChange={this.onIncludeUncommittedChanged}
          />
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Review"
            okButtonDisabled={branch === '' || baseRef === ''}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}

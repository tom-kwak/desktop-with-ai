import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { TextBox } from '../lib/text-box'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Ref } from '../lib/ref'
import { Repository } from '../../models/repository'
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
  readonly branchName: string | null
  readonly baseRef: string
  readonly includeUncommitted: boolean
  /** Set once the user starts the review. */
  readonly started: IBranchReviewOptions | null
}

/**
 * Asks which branch to compare against, then reviews everything the current
 * branch changes relative to it.
 */
export class AIBranchReviewDialog extends React.Component<
  IAIBranchReviewDialogProps,
  IAIBranchReviewDialogState
> {
  private unmounted = false

  public constructor(props: IAIBranchReviewDialogProps) {
    super(props)
    this.state = {
      branchName: null,
      baseRef: '',
      includeUncommitted: false,
      started: null,
    }
  }

  public async componentDidMount() {
    const { repository } = this.props
    try {
      const [branchName, baseRef] = await Promise.all([
        getCurrentBranchName(repository),
        getDefaultReviewBaseRef(repository),
      ])
      if (!this.unmounted) {
        this.setState({ branchName, baseRef })
      }
    } catch {
      // The fields stay empty and the user can fill them in.
    }
  }

  public componentWillUnmount() {
    this.unmounted = true
  }

  private onBaseRefChanged = (baseRef: string) => this.setState({ baseRef })

  private onIncludeUncommittedChanged = (
    e: React.FormEvent<HTMLInputElement>
  ) => this.setState({ includeUncommitted: e.currentTarget.checked })

  private onSubmit = () => {
    const baseRef = this.state.baseRef.trim()
    if (baseRef !== '') {
      this.setState({
        started: {
          baseRef,
          includeUncommitted: this.state.includeUncommitted,
        },
      })
    }
  }

  public render() {
    const { repository, onDismissed } = this.props
    const { started, branchName } = this.state
    const title = __DARWIN__ ? 'AI Branch Review' : 'AI branch review'

    if (started !== null) {
      return (
        <AIAnalysisDialog
          repository={repository}
          title={title}
          subject={`${branchName ?? 'the current branch'} against ${
            started.baseRef
          }`}
          getInput={() => getBranchAnalysisInput(repository, started)}
          onDismissed={onDismissed}
        />
      )
    }

    return (
      <Dialog
        id="ai-branch-review"
        title={title}
        onSubmit={this.onSubmit}
        onDismissed={onDismissed}
      >
        <DialogContent>
          <p>
            Review the changes on <Ref>{branchName ?? '…'}</Ref> compared to a
            base branch, the way a pull request would show them.
          </p>
          <TextBox
            label="Base branch"
            value={this.state.baseRef}
            placeholder="origin/main"
            autoFocus={true}
            onValueChanged={this.onBaseRefChanged}
          />
          <Checkbox
            label="Include uncommitted changes to tracked files"
            value={
              this.state.includeUncommitted
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onIncludeUncommittedChanged}
          />
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup okButtonText="Review" />
        </DialogFooter>
      </Dialog>
    )
  }
}

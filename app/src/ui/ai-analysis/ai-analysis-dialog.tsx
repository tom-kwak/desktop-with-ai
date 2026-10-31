import * as React from 'react'
import { Dialog, DialogContent } from '../dialog'
import { DefaultDialogFooter } from '../dialog/default-dialog-footer'
import { Button } from '../lib/button'
import { Loading } from '../lib/loading'
import { Select } from '../lib/select'
import { AIReviewMarkdown } from './ai-review-markdown'
import { Repository } from '../../models/repository'
import { getRepositoryStateKey } from '../../lib/git/ai-analysis-input'
import { IAIAnalysisInput, analyzeWithAgent } from '../../lib/ai/ai-analysis'
import {
  IReviewHistoryEntry,
  describeReviewEntry,
  getReviewConditionKey,
  getReviewInputHash,
  loadReviewHistory,
  saveReview,
} from '../../lib/ai/ai-review-history'
import {
  getAIAgent,
  getSelectedModel,
  getSelectedReviewPrompt,
  loadEffectiveAIAnalysisSettings,
} from '../../lib/ai/ai-settings'

interface IAIAnalysisDialogProps {
  readonly repository: Repository
  readonly title: string
  /** What is being reviewed, e.g. "3 commits". */
  readonly subject: string
  /** Gathers the commit log and patch to send to the agent. */
  readonly getInput: () => Promise<IAIAnalysisInput>
  readonly onDismissed: () => void
}

type AnalysisState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'done'; readonly text: string }
  | { readonly kind: 'error'; readonly message: string }

interface IAIAnalysisDialogState {
  readonly analysis: AnalysisState
  /** Saved reviews of this same input, newest first. */
  readonly history: ReadonlyArray<IReviewHistoryEntry>
  /** The saved review being shown, or null while a new one is running. */
  readonly selectedId: string | null
  /** Whether the review shown was loaded from history, not just run. */
  readonly isFromHistory: boolean
  /** Whether the review just run couldn't be kept in the history. */
  readonly isNotSaved: boolean
}

/**
 * Reviews the input from `getInput` with the configured agent. If the same
 * input was already reviewed under the same conditions, that saved review is
 * shown instead; every review that is run is kept so it can be looked at again
 * and a new one can be requested.
 */
export class AIAnalysisDialog extends React.Component<
  IAIAnalysisDialogProps,
  IAIAnalysisDialogState
> {
  private abortController = new AbortController()
  private input: IAIAnalysisInput | null = null
  private readonly effective = loadEffectiveAIAnalysisSettings(
    this.props.repository
  )

  public constructor(props: IAIAnalysisDialogProps) {
    super(props)
    this.state = {
      analysis: { kind: 'loading' },
      history: [],
      selectedId: null,
      isFromHistory: false,
      isNotSaved: false,
    }
  }

  public componentDidMount() {
    this.showSavedOrReview()
  }

  public componentWillUnmount() {
    this.abortController.abort()
  }

  /** Starts a run, cancelling the previous one, and returns its signal. */
  private startRun(): AbortSignal {
    this.abortController.abort()
    this.abortController = new AbortController()
    this.setState({
      analysis: { kind: 'loading' },
      selectedId: null,
      isFromHistory: false,
      isNotSaved: false,
    })
    return this.abortController.signal
  }

  private async getInput(): Promise<IAIAnalysisInput> {
    this.input ??= await this.props.getInput()
    return this.input
  }

  /**
   * What a saved review has to match to be reused besides the input and the
   * settings: when the agent can read the repository, the state of its files.
   */
  private async getConditionKey(): Promise<string> {
    const { settings } = this.effective
    const repositoryState = settings.repositoryAccess
      ? await getRepositoryStateKey(this.props.repository)
      : null
    return getReviewConditionKey(settings, repositoryState)
  }

  /** Shows the saved review made under the same conditions, if there is one. */
  private async showSavedOrReview() {
    const { signal } = this.abortController

    try {
      const input = await this.getInput()
      const history = loadReviewHistory(
        this.props.repository,
        getReviewInputHash(input)
      )
      const conditionKey = await this.getConditionKey()
      const saved = history.find(e => e.conditionKey === conditionKey)

      if (signal.aborted) {
        return
      }

      if (saved === undefined) {
        this.setState({ history })
        this.review()
      } else {
        this.setState({
          analysis: { kind: 'done', text: saved.text },
          history,
          selectedId: saved.id,
          isFromHistory: true,
        })
      }
    } catch (e) {
      this.showError(e, signal)
    }
  }

  /** Runs a new review and adds it to the history. */
  private async review() {
    const signal = this.startRun()

    try {
      const input = await this.getInput()
      // Taken before the agent starts, so the review is filed under the state
      // of the repository it was given.
      const conditionKey = await this.getConditionKey()
      const text = await analyzeWithAgent(
        input,
        this.effective.settings,
        this.props.repository.path,
        signal
      )
      if (signal.aborted) {
        return
      }

      const { entry, saved } = saveReview(
        this.props.repository,
        input,
        this.effective.settings,
        conditionKey,
        text,
        this.props.subject
      )
      const stored = loadReviewHistory(this.props.repository, entry.inputHash)
      this.setState({
        analysis: { kind: 'done', text },
        // A review that couldn't be kept is still listed while the dialog is
        // open, so what is shown matches the list.
        history: saved ? stored : [entry, ...stored],
        selectedId: entry.id,
        isNotSaved: !saved,
      })
    } catch (e) {
      this.showError(e, signal)
    }
  }

  private showError(e: unknown, signal: AbortSignal) {
    if (!signal.aborted) {
      const message = e instanceof Error ? e.message : String(e)
      this.setState({ analysis: { kind: 'error', message } })
    }
  }

  private onReviewAgain = () => {
    this.review()
  }

  private onHistorySelected = (e: React.FormEvent<HTMLSelectElement>) => {
    const entry = this.state.history.find(h => h.id === e.currentTarget.value)
    if (entry !== undefined) {
      // Picking a saved review cancels a run that is still in progress.
      this.abortController.abort()
      this.setState({
        analysis: { kind: 'done', text: entry.text },
        selectedId: entry.id,
        isFromHistory: true,
      })
    }
  }

  private renderSummary() {
    const { settings, isProjectSpecific } = this.effective
    const { history, selectedId, isFromHistory } = this.state
    const entry = history.find(h => h.id === selectedId)

    // Describe the review shown, which may have been made with other settings.
    const agent = entry?.agent ?? settings.agent
    const model = entry ? entry.model : getSelectedModel(settings)
    const promptName =
      entry?.promptName ?? getSelectedReviewPrompt(settings).name
    const repositoryAccess =
      entry?.repositoryAccess ?? settings.repositoryAccess

    return (
      <>
        <p className="ai-analysis-meta">
          {getAIAgent(agent).label} · {model || 'default model'} · prompt:{' '}
          {promptName} · {repositoryAccess ? 'reads repository · ' : ''}
          {isProjectSpecific ? 'project settings' : 'global settings'}
        </p>
        {this.state.isNotSaved && (
          <p className="ai-analysis-error">
            This review couldn't be saved to the history because the storage is
            full, so it won't be shown again after this dialog is closed.
          </p>
        )}
        {isFromHistory && entry && (
          <p className="ai-analysis-meta">
            Saved review from {new Date(entry.createdAt).toLocaleString()}. Use
            “Review again” to run a new one.
          </p>
        )}
      </>
    )
  }

  private renderHistory() {
    const { history, selectedId, analysis } = this.state

    return (
      <div className="ai-review-history">
        {history.length > 0 && (
          <Select
            label="History"
            value={selectedId ?? ''}
            onChange={this.onHistorySelected}
          >
            {selectedId === null && (
              <option value="" disabled={true}>
                New review…
              </option>
            )}
            {history.map(h => (
              <option key={h.id} value={h.id}>
                {describeReviewEntry(h)}
              </option>
            ))}
          </Select>
        )}
        <Button
          onClick={this.onReviewAgain}
          disabled={analysis.kind === 'loading'}
        >
          Review again
        </Button>
      </div>
    )
  }

  private renderBody() {
    const { analysis } = this.state

    switch (analysis.kind) {
      case 'loading':
        return (
          <p>
            <Loading /> Reviewing {this.props.subject}…
          </p>
        )
      case 'error':
        return <p className="ai-analysis-error">{analysis.message}</p>
      case 'done':
        return <AIReviewMarkdown markdown={analysis.text} />
    }
  }

  public render() {
    return (
      <Dialog
        id="ai-analysis"
        title={this.props.title}
        onSubmit={this.props.onDismissed}
        onDismissed={this.props.onDismissed}
        loading={this.state.analysis.kind === 'loading'}
      >
        <DialogContent>
          {this.renderSummary()}
          {this.renderHistory()}
          {this.renderBody()}
        </DialogContent>
        <DefaultDialogFooter />
      </Dialog>
    )
  }
}

import * as React from 'react'
import { Dialog, DialogContent } from '../dialog'
import { DefaultDialogFooter } from '../dialog/default-dialog-footer'
import { Loading } from '../lib/loading'
import { Repository } from '../../models/repository'
import { IAIAnalysisInput, analyzeWithAgent } from '../../lib/ai/ai-analysis'
import {
  getAIAgent,
  getSelectedModel,
  getSelectedReviewPrompt,
  loadEffectiveAIAnalysisSettings,
} from '../../lib/ai/ai-settings'

interface IAIAnalysisDialogProps {
  readonly repository: Repository
  readonly title: string
  /** What is being analyzed, e.g. "3 commits". */
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
}

/**
 * Runs the configured agent over the input from `getInput` and shows the
 * resulting analysis.
 */
export class AIAnalysisDialog extends React.Component<
  IAIAnalysisDialogProps,
  IAIAnalysisDialogState
> {
  private readonly abortController = new AbortController()
  private readonly effective = loadEffectiveAIAnalysisSettings(
    this.props.repository.path
  )

  public constructor(props: IAIAnalysisDialogProps) {
    super(props)
    this.state = { analysis: { kind: 'loading' } }
  }

  public componentDidMount() {
    this.analyze()
  }

  public componentWillUnmount() {
    this.abortController.abort()
  }

  private async analyze() {
    const { signal } = this.abortController

    try {
      const input = await this.props.getInput()
      const text = await analyzeWithAgent(
        input,
        this.effective.settings,
        signal
      )
      if (!signal.aborted) {
        this.setState({ analysis: { kind: 'done', text } })
      }
    } catch (e) {
      if (!signal.aborted) {
        const message = e instanceof Error ? e.message : String(e)
        this.setState({ analysis: { kind: 'error', message } })
      }
    }
  }

  private renderSummary() {
    const { settings, isProjectSpecific } = this.effective
    const model = getSelectedModel(settings)
    return (
      <p className="ai-analysis-meta">
        {getAIAgent(settings.agent).label} · {model || 'default model'} ·
        prompt: {getSelectedReviewPrompt(settings).name} ·{' '}
        {isProjectSpecific ? 'project settings' : 'global settings'}
      </p>
    )
  }

  private renderBody() {
    const { analysis } = this.state

    switch (analysis.kind) {
      case 'loading':
        return (
          <p>
            <Loading /> Analyzing {this.props.subject}…
          </p>
        )
      case 'error':
        return <p className="ai-analysis-error">{analysis.message}</p>
      case 'done':
        return <pre className="ai-analysis-text">{analysis.text}</pre>
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
          {this.renderBody()}
        </DialogContent>
        <DefaultDialogFooter />
      </Dialog>
    )
  }
}

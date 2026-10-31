import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Select } from '../lib/select'
import { TextBox } from '../lib/text-box'
import { TextArea } from '../lib/text-area'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Repository } from '../../models/repository'
import {
  AIAgentId,
  AIAgents,
  DefaultAIAnalysisSettings,
  DefaultReviewPrompt,
  DefaultReviewPromptId,
  IAIAnalysisSettings,
  IReviewPrompt,
  getAIAgent,
  getReviewPrompts,
  loadGlobalAIAnalysisSettings,
  loadProjectAIAnalysisSettings,
  saveGlobalAIAnalysisSettings,
  saveProjectAIAnalysisSettings,
} from '../../lib/ai/ai-settings'

interface IAISettingsDialogProps {
  readonly repository: Repository
  readonly onDismissed: () => void
}

type SettingsScope = 'project' | 'global'

interface IAISettingsDialogState {
  /** Which settings the form is showing and editing. */
  readonly scope: SettingsScope
  readonly global: IAIAnalysisSettings
  /** Null when the project has no settings of its own. */
  readonly project: IAIAnalysisSettings | null
}

/**
 * Lets the user pick the agent, its model and the review prompt, either for
 * every project or just for the current one.
 */
export class AISettingsDialog extends React.Component<
  IAISettingsDialogProps,
  IAISettingsDialogState
> {
  public constructor(props: IAISettingsDialogProps) {
    super(props)
    this.state = {
      scope: 'project',
      global: loadGlobalAIAnalysisSettings(),
      project: loadProjectAIAnalysisSettings(props.repository.path),
    }
  }

  /** The settings the form shows: the project's own, else the global ones. */
  private get shown(): IAIAnalysisSettings {
    const { scope, global, project } = this.state
    return scope === 'project' && project !== null ? project : global
  }

  /** The form is read-only while a project just inherits the global settings. */
  private get isEditable(): boolean {
    return this.state.scope === 'global' || this.state.project !== null
  }

  private update(changes: Partial<IAIAnalysisSettings>) {
    if (!this.isEditable) {
      return
    }

    const next = { ...this.shown, ...changes }
    if (this.state.scope === 'project') {
      this.setState({ ...this.state, project: next })
    } else {
      this.setState({ ...this.state, global: next })
    }
  }

  private onScopeChanged = (e: React.FormEvent<HTMLSelectElement>) => {
    this.setState({ scope: e.currentTarget.value as SettingsScope })
  }

  private onProjectSpecificChanged = (e: React.FormEvent<HTMLInputElement>) => {
    // Start from the global settings so nothing changes until edited.
    this.setState({ project: e.currentTarget.checked ? this.state.global : null })
  }

  private onAgentChanged = (e: React.FormEvent<HTMLSelectElement>) => {
    this.update({ agent: e.currentTarget.value as AIAgentId })
  }

  private onModelChanged = (model: string) => {
    const { agent, models } = this.shown
    this.update({ models: { ...models, [agent]: model } })
  }

  private onPromptSelected = (e: React.FormEvent<HTMLSelectElement>) => {
    this.update({ promptId: e.currentTarget.value })
  }

  private updateSelectedPrompt(changes: Partial<IReviewPrompt>) {
    const { customPrompts, promptId } = this.shown
    this.update({
      customPrompts: customPrompts.map(p =>
        p.id === promptId ? { ...p, ...changes } : p
      ),
    })
  }

  private onPromptNameChanged = (name: string) => {
    this.updateSelectedPrompt({ name })
  }

  private onPromptTextChanged = (text: string) => {
    this.updateSelectedPrompt({ text })
  }

  private onAddPrompt = () => {
    const { customPrompts } = this.shown
    const prompt: IReviewPrompt = {
      id: `custom-${Date.now()}`,
      name: `Custom ${customPrompts.length + 1}`,
      // Start from the built-in prompt so the output format is kept.
      text: DefaultReviewPrompt.text,
    }
    this.update({
      customPrompts: [...customPrompts, prompt],
      promptId: prompt.id,
    })
  }

  private onDeletePrompt = () => {
    const { customPrompts, promptId } = this.shown
    this.update({
      customPrompts: customPrompts.filter(p => p.id !== promptId),
      promptId: DefaultReviewPromptId,
    })
  }

  private onRepositoryAccessChanged = (e: React.FormEvent<HTMLInputElement>) => {
    this.update({ repositoryAccess: e.currentTarget.checked })
  }

  private onResetToDefaults = () => {
    // Keep the user's custom prompts; only restore the selections.
    this.update({
      ...DefaultAIAnalysisSettings,
      customPrompts: this.shown.customPrompts,
    })
  }

  private onSubmit = () => {
    const { global, project } = this.state
    saveGlobalAIAnalysisSettings(global)
    saveProjectAIAnalysisSettings(this.props.repository.path, project)
    this.props.onDismissed()
  }

  private renderScope() {
    const { scope, project } = this.state

    return (
      <>
        <Select label="Settings for" value={scope} onChange={this.onScopeChanged}>
          <option value="project">This project ({this.props.repository.name})</option>
          <option value="global">All projects (default)</option>
        </Select>
        {scope === 'project' && (
          <Checkbox
            label="Use settings specific to this project"
            value={project !== null ? CheckboxValue.On : CheckboxValue.Off}
            onChange={this.onProjectSpecificChanged}
          />
        )}
        {scope === 'project' && project === null && (
          <p className="ai-settings-help">
            This project uses the settings for all projects, shown below.
          </p>
        )}
      </>
    )
  }

  private renderRepositoryAccess() {
    return (
      <>
        <Checkbox
          label="Let the agent read files in the repository"
          value={
            this.shown.repositoryAccess ? CheckboxValue.On : CheckboxValue.Off
          }
          disabled={!this.isEditable}
          onChange={this.onRepositoryAccessChanged}
          ariaDescribedBy="ai-repository-access-help"
        />
        <p id="ai-repository-access-help" className="ai-settings-help">
          Besides the diff, the agent can look at other files, such as callers
          and tests. It cannot change files or run commands. Anything it reads
          is sent to the agent, so leave this off for repositories with secrets
          you don't want shared. Reviews take longer.
        </p>
      </>
    )
  }

  private renderModel() {
    const settings = this.shown
    const agent = getAIAgent(settings.agent)
    const suggestions =
      agent.suggestedModels.length > 0
        ? ` For example: ${agent.suggestedModels.join(', ')}.`
        : ''

    return (
      <>
        <TextBox
          label="Model"
          value={settings.models[agent.id] ?? ''}
          placeholder={`Default (${agent.label} decides)`}
          disabled={!this.isEditable}
          onValueChanged={this.onModelChanged}
          ariaDescribedBy="ai-model-help"
        />
        <p id="ai-model-help" className="ai-settings-help">
          Leave empty to use the model {agent.label} is configured with.
          {suggestions}
        </p>
      </>
    )
  }

  private renderPrompt() {
    const settings = this.shown
    const prompts = getReviewPrompts(settings)
    const selected =
      prompts.find(p => p.id === settings.promptId) ?? DefaultReviewPrompt
    const isBuiltIn = selected.id === DefaultReviewPromptId
    const isEditable = this.isEditable

    return (
      <>
        <Select
          label="Review prompt"
          value={selected.id}
          disabled={!isEditable}
          onChange={this.onPromptSelected}
        >
          {prompts.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {!isBuiltIn && (
          <TextBox
            label="Prompt name"
            value={selected.name}
            disabled={!isEditable}
            onValueChanged={this.onPromptNameChanged}
          />
        )}
        <TextArea
          label="Prompt"
          value={selected.text}
          rows={9}
          disabled={isBuiltIn || !isEditable}
          onValueChanged={this.onPromptTextChanged}
        />
        <div className="ai-settings-prompt-actions">
          <Button onClick={this.onAddPrompt} disabled={!isEditable}>
            New prompt
          </Button>
          <Button
            onClick={this.onDeletePrompt}
            disabled={isBuiltIn || !isEditable}
          >
            Delete prompt
          </Button>
        </div>
      </>
    )
  }

  public render() {
    return (
      <Dialog
        id="ai-settings"
        title={__DARWIN__ ? 'AI Analysis Settings' : 'AI analysis settings'}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>
          {this.renderScope()}
          <Select
            label="Agent"
            value={this.shown.agent}
            disabled={!this.isEditable}
            onChange={this.onAgentChanged}
          >
            {AIAgents.map(a => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
          {this.renderModel()}
          {this.renderRepositoryAccess()}
          {this.renderPrompt()}
          <div className="ai-settings-prompt-actions">
            <Button
              onClick={this.onResetToDefaults}
              disabled={!this.isEditable}
            >
              Reset to defaults
            </Button>
          </div>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup okButtonText="Save" />
        </DialogFooter>
      </Dialog>
    )
  }
}

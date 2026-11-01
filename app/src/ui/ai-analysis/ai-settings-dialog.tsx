import * as React from 'react'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Select } from '../lib/select'
import { TextBox } from '../lib/text-box'
import { TextArea } from '../lib/text-area'
import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Repository } from '../../models/repository'
import {
  AIAgentId,
  AIAgents,
  DefaultAIAnalysisSettings,
  DefaultReviewPromptId,
  IAIAnalysisSettings,
  IReviewPrompt,
  getAIAgent,
  getDefaultSettingsResetTo,
  getProjectSettingsResetTo,
  getReviewPrompts,
  getSelectedReviewPrompt,
  loadGlobalAIAnalysisSettings,
  loadProjectAIAnalysisSettings,
  saveAIAnalysisSettings,
} from '../../lib/ai/ai-settings'

function getMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

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
  /** Whether the settings are still being read from the database. */
  readonly isLoading: boolean
  /** Set if the settings couldn't be read; there is nothing to edit then. */
  readonly loadError: string | null
  /** Set if the last save failed; the form stays so it can be tried again. */
  readonly saveError: string | null
}

/**
 * Lets the user pick the agent, its model and the review prompt, either for
 * every project or just for the current one.
 */
export class AISettingsDialog extends React.Component<
  IAISettingsDialogProps,
  IAISettingsDialogState
> {
  private unmounted = false

  public constructor(props: IAISettingsDialogProps) {
    super(props)
    this.state = {
      scope: 'global',
      global: DefaultAIAnalysisSettings,
      project: null,
      isLoading: true,
      loadError: null,
      saveError: null,
    }
  }

  public async componentDidMount() {
    try {
      const { repository } = this.props
      const [global, project] = await Promise.all([
        loadGlobalAIAnalysisSettings(),
        loadProjectAIAnalysisSettings(repository),
      ])
      if (!this.unmounted) {
        this.setState({
          // Without settings of its own a project just uses the defaults, so
          // those are what there is to edit.
          scope: project !== null ? 'project' : 'global',
          global,
          project,
          isLoading: false,
        })
      }
    } catch (e) {
      if (!this.unmounted) {
        this.setState({ loadError: getMessage(e), isLoading: false })
      }
    }
  }

  public componentWillUnmount() {
    this.unmounted = true
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
      this.setState({ project: next })
    } else {
      this.setState({ global: next })
    }
  }

  private onScopeChanged = (e: React.FormEvent<HTMLSelectElement>) => {
    this.setState({ scope: e.currentTarget.value as SettingsScope })
  }

  private onProjectSpecificChanged = (e: React.FormEvent<HTMLInputElement>) => {
    // Start from the global settings so nothing changes until edited.
    this.setState({
      project: e.currentTarget.checked ? this.state.global : null,
    })
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
    if (getSelectedReviewPrompt(this.shown).id === DefaultReviewPromptId) {
      this.update({ defaultPromptText: text })
    } else {
      this.updateSelectedPrompt({ text })
    }
  }

  private onRestoreDefaultPrompt = () => {
    this.update({ defaultPromptText: undefined })
  }

  private onAddPrompt = () => {
    const { customPrompts } = this.shown
    const prompt: IReviewPrompt = {
      id: `custom-${Date.now()}`,
      name: `Custom ${customPrompts.length + 1}`,
      // Start from the default prompt so the output format is kept.
      text: getReviewPrompts(this.shown)[0].text,
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

  private onRepositoryAccessChanged = (
    e: React.FormEvent<HTMLInputElement>
  ) => {
    this.update({ repositoryAccess: e.currentTarget.checked })
  }

  private onResetToDefaults = () => {
    const { scope, global } = this.state
    this.update(
      scope === 'project'
        ? getProjectSettingsResetTo(global, this.shown)
        : getDefaultSettingsResetTo(this.shown)
    )
  }

  private onEditDefaults = () => {
    this.setState({ scope: 'global' })
  }

  private onSubmit = async () => {
    const { global, project } = this.state
    this.setState({ saveError: null })

    try {
      await saveAIAnalysisSettings(this.props.repository, global, project)
    } catch (e) {
      if (!this.unmounted) {
        this.setState({ saveError: getMessage(e) })
      }
      return
    }

    this.props.onDismissed()
  }

  private renderScope() {
    const { scope, project } = this.state

    return (
      <>
        <Select
          label="Settings for"
          value={scope}
          onChange={this.onScopeChanged}
        >
          <option value="project">
            This project ({this.props.repository.name})
          </option>
          <option value="global">Defaults for all projects</option>
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
            This project uses the defaults for all projects, shown below.{' '}
            <LinkButton onClick={this.onEditDefaults}>Edit defaults</LinkButton>
          </p>
        )}
      </>
    )
  }

  private renderRepositoryAccess() {
    const agent = getAIAgent(this.shown.agent)
    const isSupported = agent.supportsRepositoryAccess

    return (
      <>
        <Checkbox
          label="Let the agent read files in the repository"
          value={
            isSupported && this.shown.repositoryAccess
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          disabled={!this.isEditable || !isSupported}
          onChange={this.onRepositoryAccessChanged}
          ariaDescribedBy="ai-repository-access-help"
        />
        <p id="ai-repository-access-help" className="ai-settings-help">
          {isSupported
            ? `Besides the diff, the agent can look at other files, such as
              callers and tests. It cannot change files or run commands.
              Anything it reads is sent to the agent, so leave this off for
              repositories with secrets you don't want shared. Reviews take
              longer.`
            : `${agent.label} only sees the diff. It can't be kept from running
              what a repository configures for it, so it doesn't run inside
              the repository.`}
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
    const selected = getSelectedReviewPrompt(settings)
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
          disabled={!isEditable}
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
          {isBuiltIn && settings.defaultPromptText !== undefined && (
            <Button
              onClick={this.onRestoreDefaultPrompt}
              disabled={!isEditable}
            >
              Restore built-in prompt
            </Button>
          )}
        </div>
      </>
    )
  }

  private renderForm() {
    return (
      <>
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
          <Button onClick={this.onResetToDefaults} disabled={!this.isEditable}>
            {this.state.scope === 'project'
              ? 'Reset to defaults'
              : 'Reset to built-in defaults'}
          </Button>
        </div>
      </>
    )
  }

  private renderContent() {
    if (this.state.isLoading) {
      return <p>Loading settings…</p>
    }

    // The form would show the built-in settings as if they were the user's.
    if (this.state.loadError !== null) {
      return <p>The settings couldn't be loaded, so they can't be changed.</p>
    }

    return this.renderForm()
  }

  public render() {
    const { isLoading, loadError, saveError } = this.state
    const error = loadError ?? saveError

    return (
      <Dialog
        id="ai-settings"
        title={__DARWIN__ ? 'AI Review Settings' : 'AI review settings'}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={isLoading}
      >
        {error !== null && <DialogError>{error}</DialogError>}
        <DialogContent>{this.renderContent()}</DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Save"
            okButtonDisabled={isLoading || loadError !== null}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}

import { isRecord } from '../is-record'
import { StoredRepository, getRepositoryStorageKeys } from './repository-key'

const StorageKey = 'ai-analysis-settings'

/** Agents (local CLIs) that can run the review. */
export type AIAgentId = 'claude' | 'codex' | 'gemini'

export interface IAIAgent {
  readonly id: AIAgentId
  readonly label: string
  /** The executable name looked up on the user's PATH. */
  readonly command: string
  /** Models offered as suggestions; any other model name can be typed. */
  readonly suggestedModels: ReadonlyArray<string>
  /**
   * Arguments for a read-only, non-interactive run that reads the prompt
   * from stdin. `model` is empty when the CLI's own default should be used.
   * With `repositoryAccess` the agent runs inside the repository and may read
   * its files, but still can't change anything or run commands.
   */
  readonly buildArgs: (
    model: string,
    repositoryAccess: boolean
  ) => ReadonlyArray<string>
}

export const AIAgents: ReadonlyArray<IAIAgent> = [
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    suggestedModels: ['sonnet', 'opus', 'haiku'],
    buildArgs: (model, repositoryAccess) => [
      '-p',
      '--output-format',
      'text',
      // Only read-only tools; no shell and no edits.
      '--tools',
      repositoryAccess ? 'Read,Grep,Glob' : '',
      '--no-session-persistence',
      '--disable-slash-commands',
      // A repository can ship its own hooks and MCP servers. Don't let
      // reviewing it run them.
      ...(repositoryAccess ? ['--setting-sources', 'user'] : []),
      ...(repositoryAccess ? ['--strict-mcp-config'] : []),
      ...(model === '' ? [] : ['--model', model]),
    ],
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    command: 'codex',
    suggestedModels: [],
    buildArgs: model => [
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      ...(model === '' ? [] : ['--model', model]),
      '-',
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    command: 'gemini',
    suggestedModels: [],
    buildArgs: model => [
      '--skip-trust',
      '--approval-mode',
      'plan',
      ...(model === '' ? [] : ['--model', model]),
      '-p',
      '',
    ],
  },
]

export const DefaultAIAgentId: AIAgentId = 'claude'

export function getAIAgent(id: AIAgentId): IAIAgent {
  return AIAgents.find(a => a.id === id) ?? AIAgents[0]
}

/** A named review prompt describing how the commits should be reviewed. */
export interface IReviewPrompt {
  readonly id: string
  readonly name: string
  readonly text: string
}

/** Language the built-in prompt asks the model to answer in. */
const DefaultLanguage = 'Korean'

export const DefaultReviewPromptId = 'default'

/** The built-in review prompt. It can be selected but not edited or deleted. */
export const DefaultReviewPrompt: IReviewPrompt = {
  id: DefaultReviewPromptId,
  name: 'Default',
  text: `Write the review in ${DefaultLanguage} using Markdown with these sections:
## 요약  - what the change does and why, in 2-4 sentences
## 주요 변경 - bullet list grouped by file or concern
## 위험 요소 - behavior changes, regressions, missing tests or edge cases
## 커밋 품질 - whether the commit message matches the change and whether the commit should be split
Be concrete, cite file names, and say so when the diff is truncated.`,
}

export interface IAIAnalysisSettings {
  readonly agent: AIAgentId
  /** Model per agent. A missing or empty entry means the CLI's default. */
  readonly models: Readonly<Partial<Record<AIAgentId, string>>>
  /** Id of the selected review prompt. */
  readonly promptId: string
  /** Review prompts created by the user. */
  readonly customPrompts: ReadonlyArray<IReviewPrompt>
  /**
   * Whether the agent may read the repository's files, not just the diff, to
   * understand the code around a change.
   */
  readonly repositoryAccess: boolean
}

export const DefaultAIAnalysisSettings: IAIAnalysisSettings = {
  agent: DefaultAIAgentId,
  models: {},
  promptId: DefaultReviewPromptId,
  customPrompts: [],
  repositoryAccess: false,
}

const ProjectStorageKeyPrefix = `${StorageKey}:project:`

function readSettings(key: string): IAIAnalysisSettings | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '')
    return isRecord(parsed) ? sanitize(parsed) : null
  } catch {
    return null
  }
}

/** The settings used by every project that has no settings of its own. */
export function loadGlobalAIAnalysisSettings(): IAIAnalysisSettings {
  return readSettings(StorageKey) ?? DefaultAIAnalysisSettings
}

export function saveGlobalAIAnalysisSettings(settings: IAIAnalysisSettings) {
  localStorage.setItem(StorageKey, JSON.stringify(settings))
}

/** Settings stored for one project, or null if it uses the global ones. */
export function loadProjectAIAnalysisSettings(
  repository: StoredRepository
): IAIAnalysisSettings | null {
  const { current, legacy } = getRepositoryStorageKeys(repository)
  return (
    readSettings(`${ProjectStorageKeyPrefix}${current}`) ??
    readSettings(`${ProjectStorageKeyPrefix}${legacy}`)
  )
}

/** Stores project settings; null removes them so the global ones apply. */
export function saveProjectAIAnalysisSettings(
  repository: StoredRepository,
  settings: IAIAnalysisSettings | null
) {
  const { current, legacy } = getRepositoryStorageKeys(repository)
  if (settings === null) {
    localStorage.removeItem(`${ProjectStorageKeyPrefix}${current}`)
  } else {
    localStorage.setItem(
      `${ProjectStorageKeyPrefix}${current}`,
      JSON.stringify(settings)
    )
  }
  // Settings found under the old path key now live under the current one.
  if (legacy !== current) {
    localStorage.removeItem(`${ProjectStorageKeyPrefix}${legacy}`)
  }
}

export interface IEffectiveAIAnalysisSettings {
  readonly settings: IAIAnalysisSettings
  /** Whether the settings come from the project rather than the global ones. */
  readonly isProjectSpecific: boolean
}

/** The settings to use for a project: its own if it has any, else the global ones. */
export function loadEffectiveAIAnalysisSettings(
  repository: StoredRepository
): IEffectiveAIAnalysisSettings {
  const project = loadProjectAIAnalysisSettings(repository)
  return project !== null
    ? { settings: project, isProjectSpecific: true }
    : { settings: loadGlobalAIAnalysisSettings(), isProjectSpecific: false }
}

/**
 * What the defaults go back to: the built-in settings, keeping the custom
 * prompts the user wrote.
 */
export function getDefaultSettingsResetTo(
  settings: IAIAnalysisSettings
): IAIAnalysisSettings {
  return {
    ...DefaultAIAnalysisSettings,
    customPrompts: settings.customPrompts,
  }
}

/**
 * What a project goes back to: the user's saved defaults, keeping the custom
 * prompts written for the project. The defaults' prompts come along since the
 * selected one may be among them.
 */
export function getProjectSettingsResetTo(
  defaults: IAIAnalysisSettings,
  project: IAIAnalysisSettings
): IAIAnalysisSettings {
  const inDefaults = new Set(defaults.customPrompts.map(p => p.id))
  return {
    ...defaults,
    customPrompts: [
      ...defaults.customPrompts,
      ...project.customPrompts.filter(p => !inDefaults.has(p.id)),
    ],
  }
}

/** All selectable prompts, built-in first. */
export function getReviewPrompts(
  settings: IAIAnalysisSettings
): ReadonlyArray<IReviewPrompt> {
  return [DefaultReviewPrompt, ...settings.customPrompts]
}

/** The selected prompt, falling back to the built-in one if it was removed. */
export function getSelectedReviewPrompt(
  settings: IAIAnalysisSettings
): IReviewPrompt {
  return (
    getReviewPrompts(settings).find(p => p.id === settings.promptId) ??
    DefaultReviewPrompt
  )
}

export function getSelectedModel(settings: IAIAnalysisSettings): string {
  return (settings.models[settings.agent] ?? '').trim()
}

/** Validates stored data field by field so a bad value falls back to its default. */
function sanitize(raw: Record<string, unknown>): IAIAnalysisSettings {
  const agent = AIAgents.find(a => a.id === raw.agent)?.id ?? DefaultAIAgentId

  const models: Partial<Record<AIAgentId, string>> = {}
  if (isRecord(raw.models)) {
    for (const a of AIAgents) {
      const value = raw.models[a.id]
      if (typeof value === 'string') {
        models[a.id] = value
      }
    }
  }

  const customPrompts = Array.isArray(raw.customPrompts)
    ? raw.customPrompts.flatMap((p: unknown): IReviewPrompt[] =>
        isRecord(p) &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        typeof p.text === 'string' &&
        p.id !== DefaultReviewPromptId
          ? [{ id: p.id, name: p.name, text: p.text }]
          : []
      )
    : []

  return {
    agent,
    models,
    promptId:
      typeof raw.promptId === 'string' ? raw.promptId : DefaultReviewPromptId,
    customPrompts,
    repositoryAccess: raw.repositoryAccess === true,
  }
}

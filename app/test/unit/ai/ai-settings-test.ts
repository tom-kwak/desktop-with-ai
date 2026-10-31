import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'
import { AIReviewDatabase } from '../../../src/lib/ai/ai-review-database'
import {
  DefaultAIAnalysisSettings,
  DefaultReviewPrompt,
  IAIAnalysisSettings,
  getDefaultSettingsResetTo,
  getProjectSettingsResetTo,
  getSelectedReviewPrompt,
  loadEffectiveAIAnalysisSettings,
  loadGlobalAIAnalysisSettings,
  loadProjectAIAnalysisSettings,
  saveGlobalAIAnalysisSettings,
  saveProjectAIAnalysisSettings,
} from '../../../src/lib/ai/ai-settings'

const prompt = (id: string) => ({ id, name: id, text: `text of ${id}` })

const defaults: IAIAnalysisSettings = {
  agent: 'gemini',
  models: { gemini: 'pro' },
  promptId: 'shared',
  customPrompts: [prompt('shared')],
  repositoryAccess: true,
}

const project: IAIAnalysisSettings = {
  agent: 'claude',
  models: { claude: 'opus' },
  promptId: 'own',
  customPrompts: [prompt('own')],
  repositoryAccess: false,
}

describe('resetting AI review settings', () => {
  it('resets a project to the saved defaults', () => {
    const reset = getProjectSettingsResetTo(defaults, project)

    assert.strictEqual(reset.agent, 'gemini')
    assert.deepStrictEqual(reset.models, { gemini: 'pro' })
    assert.strictEqual(reset.repositoryAccess, true)
    assert.strictEqual(getSelectedReviewPrompt(reset).id, 'shared')
  })

  it("keeps a project's own prompts", () => {
    const reset = getProjectSettingsResetTo(defaults, project)

    assert.deepStrictEqual(
      reset.customPrompts.map(p => p.id),
      ['shared', 'own']
    )
  })

  it('resets the defaults to the built-in settings', () => {
    const reset = getDefaultSettingsResetTo(defaults)

    assert.strictEqual(reset.agent, DefaultAIAnalysisSettings.agent)
    assert.strictEqual(reset.repositoryAccess, false)
    assert.deepStrictEqual(reset.customPrompts, defaults.customPrompts)
  })
})

describe('the default prompt', () => {
  it('uses the text set by the user', () => {
    const settings = {
      ...DefaultAIAnalysisSettings,
      defaultPromptText: 'mine',
    }

    assert.strictEqual(getSelectedReviewPrompt(settings).text, 'mine')
    assert.strictEqual(getSelectedReviewPrompt(settings).name, 'Default')
  })

  it('goes back to the built-in text when reset', () => {
    const settings = { ...defaults, defaultPromptText: 'mine' }

    assert.strictEqual(
      getDefaultSettingsResetTo(settings).defaultPromptText,
      undefined
    )
  })

  it("follows the defaults' text when a project is reset", () => {
    const edited = { ...defaults, defaultPromptText: 'mine' }
    const custom = { ...project, defaultPromptText: 'project' }

    assert.strictEqual(
      getProjectSettingsResetTo(edited, custom).defaultPromptText,
      'mine'
    )
    assert.strictEqual(
      getProjectSettingsResetTo(defaults, custom).defaultPromptText,
      undefined
    )
  })
})

describe('stored settings', () => {
  const repository = { id: 7, path: '/path/to/repo' }
  let db: AIReviewDatabase

  beforeEach(async () => {
    localStorage.clear()
    db = new AIReviewDatabase('AISettingsTest')
    await db.delete()
    await db.open()
  })

  it('uses the built-in settings until some are saved', async () => {
    const settings = await loadGlobalAIAnalysisSettings(db)
    assert.deepStrictEqual(settings, DefaultAIAnalysisSettings)
  })

  it('saves the defaults', async () => {
    await saveGlobalAIAnalysisSettings(defaults, db)

    const settings = await loadGlobalAIAnalysisSettings(db)
    assert.strictEqual(settings.agent, 'gemini')
    assert.strictEqual(settings.repositoryAccess, true)
  })

  it('prefers the settings of a project', async () => {
    await saveGlobalAIAnalysisSettings(defaults, db)
    await saveProjectAIAnalysisSettings(repository, project, db)

    const own = await loadEffectiveAIAnalysisSettings(repository, db)
    assert.strictEqual(own.isProjectSpecific, true)
    assert.strictEqual(own.settings.agent, 'claude')

    await saveProjectAIAnalysisSettings(repository, null, db)

    const inherited = await loadEffectiveAIAnalysisSettings(repository, db)
    assert.strictEqual(inherited.isProjectSpecific, false)
    assert.strictEqual(inherited.settings.agent, 'gemini')
  })

  it('keeps project settings when the repository is moved', async () => {
    await saveProjectAIAnalysisSettings(repository, project, db)

    const moved = { ...repository, path: '/new/path' }
    assert.notStrictEqual(await loadProjectAIAnalysisSettings(moved, db), null)
  })

  it('saves the text of the default prompt', async () => {
    const edited = { ...defaults, defaultPromptText: 'mine' }
    await saveGlobalAIAnalysisSettings(edited, db)

    const settings = await loadGlobalAIAnalysisSettings(db)
    assert.strictEqual(settings.defaultPromptText, 'mine')
  })

  it('treats a blank or built-in default prompt as unchanged', async () => {
    for (const text of ['  ', DefaultReviewPrompt.text]) {
      const edited = { ...defaults, defaultPromptText: text }
      await saveGlobalAIAnalysisSettings(edited, db)

      const settings = await loadGlobalAIAnalysisSettings(db)
      assert.strictEqual(settings.defaultPromptText, undefined)
    }
  })

  it('moves settings out of local storage', async () => {
    localStorage.setItem('ai-analysis-settings', JSON.stringify(defaults))
    localStorage.setItem(
      `ai-analysis-settings:project:${repository.path}`,
      JSON.stringify(project)
    )

    const global = await loadGlobalAIAnalysisSettings(db)
    const own = await loadProjectAIAnalysisSettings(repository, db)

    assert.strictEqual(global.agent, 'gemini')
    assert.strictEqual(own?.agent, 'claude')
    assert.strictEqual(localStorage.getItem('ai-analysis-settings'), null)
    assert.strictEqual(
      localStorage.getItem(`ai-analysis-settings:project:${repository.path}`),
      null
    )
  })

  it("doesn't overwrite saved settings when importing", async () => {
    await saveGlobalAIAnalysisSettings(project, db)
    localStorage.setItem('ai-analysis-settings', JSON.stringify(defaults))

    const settings = await loadGlobalAIAnalysisSettings(db)
    assert.strictEqual(settings.agent, 'claude')
  })
})

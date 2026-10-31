import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  DefaultAIAnalysisSettings,
  IAIAnalysisSettings,
  getDefaultSettingsResetTo,
  getProjectSettingsResetTo,
  getSelectedReviewPrompt,
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

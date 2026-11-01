import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'
import { chmod, mkdtemp, realpath, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  MaxDiffCharacters,
  analyzeWithAgent,
  buildAnalysisPrompt,
  getWindowsShellArgs,
} from '../../../src/lib/ai/ai-analysis'
import {
  AIAgents,
  DefaultAIAnalysisSettings,
  IAIAnalysisSettings,
  getAIAgent,
  isValidModelName,
  usesRepositoryAccess,
} from '../../../src/lib/ai/ai-settings'

const input = { log: 'log', diff: 'diff' }
const claude = DefaultAIAnalysisSettings
const gemini: IAIAnalysisSettings = { ...claude, agent: 'gemini' }

describe('buildAnalysisPrompt', () => {
  it('keeps short input as it is', () => {
    const prompt = buildAnalysisPrompt(input, 'review it', false)

    assert.ok(prompt.includes('review it'))
    assert.ok(prompt.includes('<commit_log>\nlog\n</commit_log>'))
    assert.ok(prompt.includes('<diff>\ndiff\n</diff>'))
    assert.ok(!prompt.includes('truncated'))
  })

  it('truncates a long diff and a long log', () => {
    const prompt = buildAnalysisPrompt(
      { log: 'l'.repeat(50_000), diff: 'd'.repeat(MaxDiffCharacters + 1) },
      '',
      false
    )

    assert.ok(prompt.includes('[commit log truncated]'))
    assert.ok(prompt.includes('[diff truncated]'))
  })

  it('only offers the repository when the agent may read it', () => {
    assert.ok(buildAnalysisPrompt(input, '', true).includes('read-only tools'))
    assert.ok(buildAnalysisPrompt(input, '', false).includes('Do not use any'))
  })
})

describe('agent arguments', () => {
  it('gives Claude Code no tools without repository access', () => {
    const args = getAIAgent('claude').buildArgs('', false)
    assert.strictEqual(args[args.indexOf('--tools') + 1], '')
  })

  it('gives Claude Code read-only tools with repository access', () => {
    const args = getAIAgent('claude').buildArgs('', true)

    assert.strictEqual(args[args.indexOf('--tools') + 1], 'Read,Grep,Glob')
    assert.ok(args.includes('--strict-mcp-config'))
    assert.strictEqual(args[args.indexOf('--setting-sources') + 1], 'user')
  })

  it('only adds a model when there is one', () => {
    for (const agent of AIAgents) {
      assert.ok(!agent.buildArgs('', false).includes('--model'))
      assert.ok(agent.buildArgs('some-model', false).includes('some-model'))
    }
  })

  it('keeps empty arguments on a Windows command line', () => {
    assert.deepStrictEqual(getWindowsShellArgs(['--tools', '', '-p']), [
      '--tools',
      '""',
      '-p',
    ])
  })

  it('accepts model names and refuses shell syntax', () => {
    for (const model of ['', 'sonnet', 'claude-opus-5-5', 'gpt-5.1', 'a[1m]']) {
      assert.ok(isValidModelName(model), model)
    }
    for (const model of ['a b', 'a&b', 'a|b', 'a"b', 'a%b', '$(x)', 'a;b']) {
      assert.ok(!isValidModelName(model), model)
    }
  })

  it('only lets Claude Code run inside a repository', () => {
    const on = { ...claude, repositoryAccess: true }

    assert.strictEqual(usesRepositoryAccess(claude), false)
    assert.strictEqual(usesRepositoryAccess(on), true)
    assert.strictEqual(usesRepositoryAccess({ ...on, agent: 'gemini' }), false)
    assert.strictEqual(usesRepositoryAccess({ ...on, agent: 'codex' }), false)
  })
})

describe('analyzeWithAgent', { skip: process.platform === 'win32' }, () => {
  const previousShell = process.env.SHELL
  let directory: string

  /** Stands in for the login shell, and so for the agent it would run. */
  async function fakeAgent(script: string) {
    const path = join(directory, 'fake-shell')
    await writeFile(path, `#!/bin/sh\n${script}\n`)
    await chmod(path, 0o755)
    process.env.SHELL = path
  }

  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'ai-analysis-')))
  })

  afterEach(async () => {
    process.env.SHELL = previousShell
    await rm(directory, { recursive: true, force: true })
  })

  it('resolves with what the agent prints', async () => {
    await fakeAgent('cat > /dev/null; echo "  the review  "')

    assert.strictEqual(
      await analyzeWithAgent(input, claude, directory),
      'the review'
    )
  })

  it('sends the prompt on stdin', async () => {
    await fakeAgent('cat')

    const text = await analyzeWithAgent(input, claude, directory)
    assert.ok(text.includes('<diff>\ndiff\n</diff>'))
  })

  it('runs in the repository only with repository access', async () => {
    await fakeAgent('cat > /dev/null; pwd')
    const on = { ...claude, repositoryAccess: true }

    const reading = await analyzeWithAgent(input, on, directory)
    const other = await analyzeWithAgent(
      input,
      { ...on, agent: 'gemini' },
      directory
    )
    const off = await analyzeWithAgent(input, claude, directory)

    assert.strictEqual(reading, directory)
    assert.notStrictEqual(other, directory)
    assert.notStrictEqual(off, directory)
  })

  it('reports an agent that is not installed', async () => {
    await fakeAgent('exit 127')

    await assert.rejects(
      analyzeWithAgent(input, gemini, directory),
      /not found/
    )
  })

  it('reports why the agent failed', async () => {
    await fakeAgent('echo "out of tokens" >&2; exit 3')

    await assert.rejects(
      analyzeWithAgent(input, claude, directory),
      /exit 3\): out of tokens/
    )
  })

  it('fails when the agent prints nothing', async () => {
    await fakeAgent('exit 0')

    await assert.rejects(
      analyzeWithAgent(input, claude, directory),
      /no output/
    )
  })

  it('stops the agent when cancelled', async () => {
    await fakeAgent('exec sleep 30')
    const controller = new AbortController()

    const review = analyzeWithAgent(input, claude, directory, controller.signal)
    controller.abort()

    await assert.rejects(review, /cancelled/)
  })

  it('refuses a model name that is not safe', async () => {
    await fakeAgent('cat')
    const settings = { ...claude, models: { claude: 'a; rm -rf x' } }

    await assert.rejects(
      analyzeWithAgent(input, settings, directory),
      /valid model name/
    )
  })
})

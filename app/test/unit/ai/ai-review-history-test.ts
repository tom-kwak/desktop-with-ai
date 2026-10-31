import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'
import { AIReviewDatabase } from '../../../src/lib/ai/ai-review-database'
import {
  IReviewHistoryEntry,
  NoReviewFilter,
  deleteReview,
  filterReviews,
  loadAllReviewHistory,
  loadReviewHistory,
  saveReview,
} from '../../../src/lib/ai/ai-review-history'
import { DefaultAIAnalysisSettings } from '../../../src/lib/ai/ai-settings'

const repository = { id: 7, path: '/path/to/repo' }
const input = { log: 'log', diff: 'diff' }
const settings = DefaultAIAnalysisSettings
const limits = { maxReviewsPerRepository: 500, maxStoredCharacters: 50_000_000 }

function save(
  db: AIReviewDatabase,
  text = 'review',
  repo = repository,
  useLimits = limits
) {
  return saveReview(
    repo,
    input,
    settings,
    'key',
    text,
    'subject',
    db,
    useLimits
  )
}

describe('ai review history', () => {
  let db: AIReviewDatabase

  beforeEach(async () => {
    localStorage.clear()
    db = new AIReviewDatabase('AIReviewHistoryTest')
    await db.delete()
    await db.open()
  })

  it('saves reviews per repository, newest first', async () => {
    await save(db, 'first')
    await new Promise(r => setTimeout(r, 2))
    await save(db, 'second')
    await save(db, 'other', { id: 8, path: '/other' })

    const reviews = await loadAllReviewHistory(repository, db)
    assert.deepStrictEqual(
      reviews.map(r => r.text),
      ['second', 'first']
    )
  })

  it('finds reviews of the same input', async () => {
    const { entry } = await save(db)

    const same = await loadReviewHistory(repository, entry.inputHash, db)
    const other = await loadReviewHistory(repository, 'other', db)

    assert.strictEqual(same.length, 1)
    assert.strictEqual(other.length, 0)
  })

  it('moves reviews out of local storage', async () => {
    const { entry } = await save(db)
    await deleteReview(entry.id, db)
    localStorage.setItem(
      `ai-review-history:${repository.path}`,
      JSON.stringify([entry])
    )

    const reviews = await loadAllReviewHistory(repository, db)

    assert.strictEqual(reviews.length, 1)
    assert.strictEqual(
      localStorage.getItem(`ai-review-history:${repository.path}`),
      null
    )
  })

  it('keeps reviews when the repository is moved', async () => {
    await save(db)

    const moved = { ...repository, path: '/new/path' }
    assert.strictEqual((await loadAllReviewHistory(moved, db)).length, 1)
  })

  it('drops the oldest reviews of a repository over the limit', async () => {
    const small = { ...limits, maxReviewsPerRepository: 2 }
    await save(db, 'a', repository, small)
    await new Promise(r => setTimeout(r, 2))
    await save(db, 'b', repository, small)
    await new Promise(r => setTimeout(r, 2))
    await save(db, 'c', repository, small)

    const reviews = await loadAllReviewHistory(repository, db)
    assert.deepStrictEqual(
      reviews.map(r => r.text),
      ['c', 'b']
    )
  })

  it('drops the oldest review of any repository over the size', async () => {
    const small = { ...limits, maxStoredCharacters: 1500 }
    const other = { id: 8, path: '/other' }
    await save(db, 'x'.repeat(1000), other, small)
    await new Promise(r => setTimeout(r, 2))
    const { saved } = await save(db, 'y'.repeat(1000), repository, small)

    assert.strictEqual(saved, true)
    assert.strictEqual((await loadAllReviewHistory(other, db)).length, 0)
    assert.strictEqual((await loadAllReviewHistory(repository, db)).length, 1)
  })

  it('never drops the review being saved', async () => {
    const tiny = { ...limits, maxStoredCharacters: 1 }
    await save(db, 'too large', repository, tiny)

    assert.strictEqual((await loadAllReviewHistory(repository, db)).length, 1)
  })
})

describe('filterReviews', () => {
  const review = (
    id: string,
    extra: Partial<IReviewHistoryEntry> = {}
  ): IReviewHistoryEntry => ({
    id,
    inputHash: 'h',
    conditionKey: 'c',
    createdAt: 0,
    agent: 'claude',
    model: '',
    promptName: 'Default',
    repositoryAccess: false,
    text: 'text',
    ...extra,
  })

  const commit = {
    sha: 'abc123def',
    shortSha: 'abc123d',
    summary: 'Fix the parser',
    body: 'Handles empty input',
  }
  const reviews = [
    review('commit', { commits: [commit] }),
    review('branch', { branch: { name: 'topic', baseRef: 'origin/main' } }),
    review('gemini', { agent: 'gemini' }),
  ]

  const ids = (filter: Partial<typeof NoReviewFilter>) =>
    filterReviews(reviews, { ...NoReviewFilter, ...filter }).map(r => r.id)

  it('returns everything without a filter', () => {
    assert.strictEqual(ids({}).length, 3)
  })

  it('matches commit shas and messages', () => {
    assert.deepStrictEqual(ids({ text: 'ABC123' }), ['commit'])
    assert.deepStrictEqual(ids({ text: 'empty input' }), ['commit'])
  })

  it('needs every word to match', () => {
    assert.deepStrictEqual(ids({ text: 'parser missing' }), [])
  })

  it('filters by kind and agent', () => {
    assert.deepStrictEqual(ids({ kind: 'branch' }), ['branch'])
    assert.deepStrictEqual(ids({ agent: 'gemini' }), ['gemini'])
  })
})

import { createHash } from 'crypto'
import Dexie from 'dexie'
import { isRecord } from '../is-record'
import {
  AIAgentId,
  IAIAnalysisSettings,
  getAIAgent,
  getSelectedModel,
  getSelectedReviewPrompt,
} from './ai-settings'
import {
  IAIAnalysisInput,
  IReviewedBranch,
  IReviewedCommit,
} from './ai-analysis'
import {
  AIReviewDatabase,
  IStoredReview,
  getAIReviewDatabase,
} from './ai-review-database'
import { StoredRepository, getRepositoryStorageKeys } from './repository-key'

/** Where reviews were kept before they moved to the database. */
const LocalStorageKeyPrefix = 'ai-review-history:'

export interface IReviewHistoryLimits {
  /** Most reviews kept per repository; the oldest are dropped first. */
  readonly maxReviewsPerRepository: number
  /**
   * Most characters of reviews kept across all repositories. The oldest
   * reviews of any repository are dropped to stay within this, which also lets
   * the reviews of repositories that are gone age out.
   */
  readonly maxStoredCharacters: number
}

const DefaultLimits: IReviewHistoryLimits = {
  maxReviewsPerRepository: 500,
  maxStoredCharacters: 50_000_000,
}

/** A review that was run and saved. */
export interface IReviewHistoryEntry {
  readonly id: string
  /** Hash of the log and patch that were reviewed. */
  readonly inputHash: string
  /** Hash of the settings that produced the review. */
  readonly conditionKey: string
  readonly createdAt: number
  readonly agent: AIAgentId
  /** Empty when the agent's default model was used. */
  readonly model: string
  readonly promptName: string
  readonly repositoryAccess: boolean
  readonly text: string
  /** What was reviewed, e.g. a commit summary. Missing in older entries. */
  readonly subject?: string
  /** The commits that were reviewed, with their messages. Missing in older entries. */
  readonly commits?: ReadonlyArray<IReviewedCommit>
  /** Set for a branch review. */
  readonly branch?: IReviewedBranch
}

/** Commits kept with a review, and how much of each message. */
const MaxCommitsPerReview = 200
const MaxCommitBodyLength = 5000

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Identifies what was reviewed: the exact commit log and patch. */
export function getReviewInputHash(input: IAIAnalysisInput): string {
  return sha256(JSON.stringify([input.log, input.diff]))
}

/**
 * Identifies how it was reviewed. Two reviews with the same input and the same
 * condition key would be asked the same question of the same agent.
 *
 * `repositoryState` describes the repository's files and is only given when the
 * agent may read them, since then the same patch can get a different review
 * once the files around it have changed.
 */
export function getReviewConditionKey(
  settings: IAIAnalysisSettings,
  repositoryState: string | null
): string {
  return sha256(
    JSON.stringify([
      settings.agent,
      getSelectedModel(settings),
      getSelectedReviewPrompt(settings).text,
      settings.repositoryAccess,
      repositoryState,
    ])
  )
}

function isCommit(value: unknown): value is IReviewedCommit {
  return (
    isRecord(value) &&
    typeof value.sha === 'string' &&
    typeof value.shortSha === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.body === 'string'
  )
}

function isBranch(value: unknown): value is IReviewedBranch {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.baseRef === 'string'
  )
}

function isEntry(value: unknown): value is IReviewHistoryEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.inputHash === 'string' &&
    typeof value.conditionKey === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.agent === 'string' &&
    typeof value.model === 'string' &&
    typeof value.promptName === 'string' &&
    typeof value.repositoryAccess === 'boolean' &&
    typeof value.text === 'string' &&
    (value.subject === undefined || typeof value.subject === 'string') &&
    (value.commits === undefined ||
      (Array.isArray(value.commits) && value.commits.every(isCommit))) &&
    (value.branch === undefined || isBranch(value.branch))
  )
}

function parseEntries(raw: string | null): ReadonlyArray<IReviewHistoryEntry> {
  try {
    const parsed: unknown = JSON.parse(raw ?? '')
    return Array.isArray(parsed) ? parsed.filter(isEntry) : []
  } catch {
    return []
  }
}

function toStored(
  entry: IReviewHistoryEntry,
  repositoryKey: string
): IStoredReview {
  return { ...entry, repositoryKey, size: JSON.stringify(entry).length }
}

/** Moves reviews saved by earlier versions out of local storage. */
async function importFromLocalStorage(db: AIReviewDatabase) {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(LocalStorageKeyPrefix)) {
      keys.push(key)
    }
  }

  for (const key of keys) {
    const repositoryKey = key.slice(LocalStorageKeyPrefix.length)
    await db.reviews.bulkPut(
      parseEntries(localStorage.getItem(key)).map(e =>
        toStored(e, repositoryKey)
      )
    )
    localStorage.removeItem(key)
  }
}

/**
 * Gets stored reviews ready to be used for a repository and returns its key:
 * anything still in local storage is moved over, and reviews filed under the
 * repository's path are refiled under its current key.
 */
async function prepare(
  repository: StoredRepository,
  db: AIReviewDatabase
): Promise<string> {
  await importFromLocalStorage(db)

  const { current, legacy } = getRepositoryStorageKeys(repository)
  if (legacy !== current) {
    await db.reviews
      .where('repositoryKey')
      .equals(legacy)
      .modify({ repositoryKey: current })
  }
  return current
}

function newestFirst(reviews: ReadonlyArray<IStoredReview>) {
  return [...reviews].sort((a, b) => b.createdAt - a.createdAt)
}

/** Every saved review of a repository, newest first. */
export async function loadAllReviewHistory(
  repository: StoredRepository,
  db: AIReviewDatabase = getAIReviewDatabase()
): Promise<ReadonlyArray<IReviewHistoryEntry>> {
  const repositoryKey = await prepare(repository, db)
  return newestFirst(
    await db.reviews.where('repositoryKey').equals(repositoryKey).toArray()
  )
}

/** Reviews of the same input, newest first. */
export async function loadReviewHistory(
  repository: StoredRepository,
  inputHash: string,
  db: AIReviewDatabase = getAIReviewDatabase()
): Promise<ReadonlyArray<IReviewHistoryEntry>> {
  const repositoryKey = await prepare(repository, db)
  return newestFirst(
    await db.reviews
      .where('[repositoryKey+inputHash]')
      .equals([repositoryKey, inputHash])
      .toArray()
  )
}

/** Drops the oldest reviews that are over the limits; `keepId` always stays. */
async function trim(
  db: AIReviewDatabase,
  repositoryKey: string,
  keepId: string,
  limits: IReviewHistoryLimits
) {
  const ofRepository = () =>
    db.reviews
      .where('[repositoryKey+createdAt]')
      .between([repositoryKey, Dexie.minKey], [repositoryKey, Dexie.maxKey])

  const excess = (await ofRepository().count()) - limits.maxReviewsPerRepository
  if (excess > 0) {
    await db.reviews.bulkDelete(
      await ofRepository().limit(excess).primaryKeys()
    )
  }

  // The sizes come from the index, so this doesn't load the reviews themselves.
  const sizes = await db.reviews.orderBy('size').keys()
  let total = sizes.reduce((sum: number, size) => sum + Number(size), 0)

  while (total > limits.maxStoredCharacters) {
    const oldest = await db.reviews
      .orderBy('createdAt')
      .filter(r => r.id !== keepId)
      .first()
    if (oldest === undefined) {
      break
    }
    await db.reviews.delete(oldest.id)
    total -= oldest.size
  }
}

export interface ISavedReview {
  readonly entry: IReviewHistoryEntry
  /**
   * Whether the review was kept. When it wasn't (the disk is full or the
   * database unavailable) the review is still returned so it can be shown,
   * but it won't be found in the history later.
   */
  readonly saved: boolean
}

/** Saves a finished review. */
export async function saveReview(
  repository: StoredRepository,
  input: IAIAnalysisInput,
  settings: IAIAnalysisSettings,
  conditionKey: string,
  text: string,
  subject: string,
  db: AIReviewDatabase = getAIReviewDatabase(),
  limits: IReviewHistoryLimits = DefaultLimits
): Promise<ISavedReview> {
  const entry: IReviewHistoryEntry = {
    id: `${Date.now()}-${sha256(text).slice(0, 8)}`,
    inputHash: getReviewInputHash(input),
    conditionKey,
    createdAt: Date.now(),
    agent: settings.agent,
    model: getSelectedModel(settings),
    promptName: getSelectedReviewPrompt(settings).name,
    repositoryAccess: settings.repositoryAccess,
    text,
    subject,
    commits: input.commits
      ?.slice(0, MaxCommitsPerReview)
      .map(c => ({ ...c, body: c.body.slice(0, MaxCommitBodyLength) })),
    branch: input.branch,
  }

  try {
    const repositoryKey = await prepare(repository, db)
    await db.transaction('rw', db.reviews, async () => {
      await db.reviews.put(toStored(entry, repositoryKey))
      await trim(db, repositoryKey, entry.id, limits)
    })
    return { entry, saved: true }
  } catch (e) {
    log.warn('Failed to save the AI review', e)
    return { entry, saved: false }
  }
}

/** Removes one saved review. */
export async function deleteReview(
  id: string,
  db: AIReviewDatabase = getAIReviewDatabase()
) {
  await db.reviews.delete(id)
}

/** One-line description of an entry for a list. */
export function describeReviewEntry(entry: IReviewHistoryEntry): string {
  return [
    new Date(entry.createdAt).toLocaleString(),
    getAIAgent(entry.agent).label,
    entry.model || 'default model',
    entry.promptName,
  ].join(' · ')
}

/** What a review was of: selected commits, or a branch against a base. */
export type ReviewKind = 'commits' | 'branch'

export function getReviewKind(entry: IReviewHistoryEntry): ReviewKind {
  return entry.branch === undefined ? 'commits' : 'branch'
}

export interface IReviewFilter {
  /** Words that must all appear somewhere in the review or what it covers. */
  readonly text: string
  readonly kind: ReviewKind | 'all'
  readonly agent: AIAgentId | 'all'
}

export const NoReviewFilter: IReviewFilter = {
  text: '',
  kind: 'all',
  agent: 'all',
}

/** Everything about a review that the text filter looks at, lower-cased. */
function getSearchableText(entry: IReviewHistoryEntry): string {
  return [
    entry.subject,
    entry.branch?.name,
    entry.branch?.baseRef,
    ...(entry.commits ?? []).flatMap(c => [c.sha, c.summary, c.body]),
    entry.promptName,
    entry.model,
    entry.text,
  ]
    .join('\n')
    .toLowerCase()
}

/** The reviews that match the filter, in their original order. */
export function filterReviews(
  entries: ReadonlyArray<IReviewHistoryEntry>,
  filter: IReviewFilter
): ReadonlyArray<IReviewHistoryEntry> {
  const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean)

  return entries.filter(e => {
    if (filter.kind !== 'all' && getReviewKind(e) !== filter.kind) {
      return false
    }
    if (filter.agent !== 'all' && e.agent !== filter.agent) {
      return false
    }
    if (words.length === 0) {
      return true
    }
    const searchable = getSearchableText(e)
    return words.every(w => searchable.includes(w))
  })
}

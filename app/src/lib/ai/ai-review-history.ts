import { createHash } from 'crypto'
import { isRecord } from '../is-record'
import {
  AIAgentId,
  IAIAnalysisSettings,
  getAIAgent,
  getSelectedModel,
  getSelectedReviewPrompt,
} from './ai-settings'
import { IAIAnalysisInput } from './ai-analysis'
import { StoredRepository, getRepositoryStorageKeys } from './repository-key'

const StorageKeyPrefix = 'ai-review-history:'

/** Most reviews kept per repository; the oldest are dropped first. */
const MaxEntriesPerRepository = 50

/**
 * Most characters of review history kept across all repositories. The browser
 * storage holds only a few MB and is shared with the rest of the app, so the
 * oldest reviews of any repository are dropped to stay within this, which also
 * lets the history of repositories that are gone age out.
 */
const MaxStoredCharacters = 1_500_000

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
}

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
    (value.subject === undefined || typeof value.subject === 'string')
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

/** The reviews saved for a repository, including any saved under its path. */
function readAll(repository: StoredRepository): IReviewHistoryEntry[] {
  const { current, legacy } = getRepositoryStorageKeys(repository)
  const entries = new Map<string, IReviewHistoryEntry>()

  for (const key of new Set([current, legacy])) {
    const raw = localStorage.getItem(`${StorageKeyPrefix}${key}`)
    for (const entry of parseEntries(raw)) {
      entries.set(entry.id, entry)
    }
  }

  return [...entries.values()]
}

interface IStoredList {
  readonly key: string
  entries: IReviewHistoryEntry[]
}

/** Every history list in storage other than the one under `exceptKey`. */
function readOtherLists(exceptKey: string): IStoredList[] {
  const lists: IStoredList[] = []

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(StorageKeyPrefix) && key !== exceptKey) {
      lists.push({ key, entries: [...parseEntries(localStorage.getItem(key))] })
    }
  }

  return lists
}

function writeList(key: string, entries: ReadonlyArray<IReviewHistoryEntry>) {
  if (entries.length === 0) {
    localStorage.removeItem(key)
  } else {
    localStorage.setItem(key, JSON.stringify(entries))
  }
}

/**
 * Stores a repository's reviews, dropping the oldest reviews of any repository
 * when the history gets too large or the storage is full. `keepId` is never
 * dropped. Returns whether the reviews were stored.
 */
function persist(
  repository: StoredRepository,
  reviews: ReadonlyArray<IReviewHistoryEntry>,
  keepId?: string
): boolean {
  const { current, legacy } = getRepositoryStorageKeys(repository)
  const key = `${StorageKeyPrefix}${current}`
  const own = [...reviews]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MaxEntriesPerRepository)
  const others = readOtherLists(key).filter(
    l => l.key !== `${StorageKeyPrefix}${legacy}`
  )

  const size = () =>
    JSON.stringify(own).length +
    others.reduce((n, l) => n + JSON.stringify(l.entries).length, 0)

  /** Drops the oldest review that may be dropped; false if none can be. */
  const dropOldest = (): boolean => {
    // The list holding the oldest review (null for the repository's own) and
    // its position in that list.
    let from: IStoredList | null = null
    let index = -1
    let oldestAt = Infinity

    for (let i = 0; i < own.length; i++) {
      if (own[i].id !== keepId && own[i].createdAt < oldestAt) {
        from = null
        index = i
        oldestAt = own[i].createdAt
      }
    }
    for (const list of others) {
      for (let i = 0; i < list.entries.length; i++) {
        if (list.entries[i].createdAt < oldestAt) {
          from = list
          index = i
          oldestAt = list.entries[i].createdAt
        }
      }
    }

    if (index === -1) {
      return false
    }

    if (from === null) {
      own.splice(index, 1)
    } else {
      from.entries.splice(index, 1)
      try {
        writeList(from.key, from.entries)
      } catch {
        // The list is trimmed in memory; storing the new reviews decides
        // whether this was enough.
      }
    }
    return true
  }

  while (size() > MaxStoredCharacters && dropOldest()) {
    // Keep dropping until the history fits.
  }

  // The storage can be full for reasons that have nothing to do with us.
  for (;;) {
    try {
      writeList(key, own)
      break
    } catch {
      if (!dropOldest()) {
        return false
      }
    }
  }

  // Anything found under the old path key now lives under the current key.
  if (legacy !== current) {
    localStorage.removeItem(`${StorageKeyPrefix}${legacy}`)
  }
  return true
}

/** Every saved review of a repository, newest first. */
export function loadAllReviewHistory(
  repository: StoredRepository
): ReadonlyArray<IReviewHistoryEntry> {
  return readAll(repository).sort((a, b) => b.createdAt - a.createdAt)
}

/** Reviews of the same input, newest first. */
export function loadReviewHistory(
  repository: StoredRepository,
  inputHash: string
): ReadonlyArray<IReviewHistoryEntry> {
  return loadAllReviewHistory(repository).filter(e => e.inputHash === inputHash)
}

export interface ISavedReview {
  readonly entry: IReviewHistoryEntry
  /**
   * Whether the review was kept. When it wasn't (the storage is full or
   * unavailable) the review is still returned so it can be shown, but it
   * won't be found in the history later.
   */
  readonly saved: boolean
}

/** Saves a finished review. */
export function saveReview(
  repository: StoredRepository,
  input: IAIAnalysisInput,
  settings: IAIAnalysisSettings,
  conditionKey: string,
  text: string,
  subject: string
): ISavedReview {
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
  }

  try {
    return {
      entry,
      saved: persist(repository, [entry, ...readAll(repository)], entry.id),
    }
  } catch {
    return { entry, saved: false }
  }
}

/** Removes one saved review. */
export function deleteReview(repository: StoredRepository, id: string) {
  try {
    persist(
      repository,
      readAll(repository).filter(e => e.id !== id)
    )
  } catch {
    // Nothing more can be done if the storage is unavailable.
  }
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

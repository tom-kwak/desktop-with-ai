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

const StorageKeyPrefix = 'ai-review-history:'

/** Most reviews kept per repository; the oldest are dropped first. */
const MaxEntriesPerRepository = 50

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
 */
export function getReviewConditionKey(settings: IAIAnalysisSettings): string {
  return sha256(
    JSON.stringify([
      settings.agent,
      getSelectedModel(settings),
      getSelectedReviewPrompt(settings).text,
      settings.repositoryAccess,
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
    typeof value.text === 'string'
  )
}

function readAll(repositoryPath: string): ReadonlyArray<IReviewHistoryEntry> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(`${StorageKeyPrefix}${repositoryPath}`) ?? ''
    )
    return Array.isArray(parsed) ? parsed.filter(isEntry) : []
  } catch {
    return []
  }
}

/** Reviews of the same input, newest first. */
export function loadReviewHistory(
  repositoryPath: string,
  inputHash: string
): ReadonlyArray<IReviewHistoryEntry> {
  return readAll(repositoryPath)
    .filter(e => e.inputHash === inputHash)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Saves a finished review. History is best effort: if storage is full or
 * unavailable the review is still shown, it just isn't kept.
 */
export function saveReview(
  repositoryPath: string,
  input: IAIAnalysisInput,
  settings: IAIAnalysisSettings,
  text: string
): IReviewHistoryEntry {
  const entry: IReviewHistoryEntry = {
    id: `${Date.now()}-${sha256(text).slice(0, 8)}`,
    inputHash: getReviewInputHash(input),
    conditionKey: getReviewConditionKey(settings),
    createdAt: Date.now(),
    agent: settings.agent,
    model: getSelectedModel(settings),
    promptName: getSelectedReviewPrompt(settings).name,
    repositoryAccess: settings.repositoryAccess,
    text,
  }

  try {
    const kept = [entry, ...readAll(repositoryPath)].slice(
      0,
      MaxEntriesPerRepository
    )
    localStorage.setItem(
      `${StorageKeyPrefix}${repositoryPath}`,
      JSON.stringify(kept)
    )
  } catch {
    // Not kept; see above.
  }

  return entry
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

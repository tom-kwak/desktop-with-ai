import Dexie from 'dexie'
import { BaseDatabase } from '../databases/base-database'
import type { IReviewHistoryEntry } from './ai-review-history'

/** A saved review as it is kept in the database. */
export interface IStoredReview extends IReviewHistoryEntry {
  /** The repository it belongs to, see `getRepositoryStorageKeys`. */
  readonly repositoryKey: string
  /** Approximate characters it takes up, for the storage budget. */
  readonly size: number
}

/** One set of settings, see `ai-settings` for what `key` and `value` hold. */
export interface IStoredSettings {
  readonly key: string
  readonly value: unknown
}

/** The AI reviews and their settings saved on this machine. */
export class AIReviewDatabase extends BaseDatabase {
  public declare reviews: Dexie.Table<IStoredReview, string>
  public declare settings: Dexie.Table<IStoredSettings, string>

  public constructor(name: string, schemaVersion?: number) {
    super(name, schemaVersion)

    this.conditionalVersion(1, {
      reviews:
        'id, repositoryKey, [repositoryKey+inputHash], [repositoryKey+createdAt], createdAt, size',
    })

    this.conditionalVersion(2, { settings: 'key' })
  }
}

let defaultDatabase: AIReviewDatabase | null = null

/** The database the app uses, opened on first use. */
export function getAIReviewDatabase(): AIReviewDatabase {
  defaultDatabase ??= new AIReviewDatabase('AIReviewDatabase')
  return defaultDatabase
}

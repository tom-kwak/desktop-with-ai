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

/** The AI reviews saved on this machine, for all repositories. */
export class AIReviewDatabase extends BaseDatabase {
  public declare reviews: Dexie.Table<IStoredReview, string>

  public constructor(name: string, schemaVersion?: number) {
    super(name, schemaVersion)

    this.conditionalVersion(1, {
      reviews:
        'id, repositoryKey, [repositoryKey+inputHash], [repositoryKey+createdAt], createdAt, size',
    })
  }
}

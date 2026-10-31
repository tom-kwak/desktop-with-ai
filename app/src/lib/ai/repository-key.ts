import { Repository } from '../../models/repository'

/** The parts of a repository needed to find what is stored for it. */
export type StoredRepository = Pick<Repository, 'id' | 'path'>

export interface IRepositoryStorageKeys {
  /**
   * Where data is stored. It follows the repository's id in the app, so it
   * survives the repository being moved or renamed on disk.
   */
  readonly current: string
  /** Where earlier versions stored it: by path. Still read for old data. */
  readonly legacy: string
}

export function getRepositoryStorageKeys(
  repository: StoredRepository
): IRepositoryStorageKeys {
  return {
    // A negative id means the repository isn't in the app's database.
    current: repository.id >= 0 ? `repo-${repository.id}` : repository.path,
    legacy: repository.path,
  }
}

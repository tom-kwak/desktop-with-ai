import { describe, it } from 'node:test'
import assert from 'node:assert'
import { utimes, writeFile } from 'fs/promises'
import { join } from 'path'
import { getRepositoryStateKey } from '../../../src/lib/git/ai-analysis-input'
import { setupEmptyRepository } from '../../helpers/repositories'

describe('getRepositoryStateKey', () => {
  it('stays the same while nothing changes', async t => {
    const repository = await setupEmptyRepository(t)
    await writeFile(join(repository.path, 'notes.txt'), 'one')

    assert.strictEqual(
      await getRepositoryStateKey(repository),
      await getRepositoryStateKey(repository)
    )
  })

  it('changes when an untracked file is added', async t => {
    const repository = await setupEmptyRepository(t)
    const before = await getRepositoryStateKey(repository)

    await writeFile(join(repository.path, 'notes.txt'), 'one')

    assert.notStrictEqual(await getRepositoryStateKey(repository), before)
  })

  it('changes when an untracked file is edited', async t => {
    const repository = await setupEmptyRepository(t)
    const path = join(repository.path, 'notes.txt')
    await writeFile(path, 'one')
    const before = await getRepositoryStateKey(repository)

    await writeFile(path, 'two')
    // Same size, so only the time tells them apart.
    await utimes(path, new Date(1000), new Date(1000))

    assert.notStrictEqual(await getRepositoryStateKey(repository), before)
  })
})

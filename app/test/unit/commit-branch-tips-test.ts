import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Branch, BranchType } from '../../src/models/branch'
import {
  getBranchTips,
  getLocalBranchTips,
} from '../../src/lib/commit-branch-tips'

const branch = (name: string, sha: string, type = BranchType.Local) =>
  new Branch(name, null, { sha }, type, '')

describe('getBranchTips', () => {
  const branches = [
    branch('feature', 'a'),
    branch('origin/feature', 'a', BranchType.Remote),
    branch('origin/other', 'b', BranchType.Remote),
    branch('github-desktop-someone/main', 'c', BranchType.Remote),
  ]

  it('names the branches by the commit that they point at', () => {
    assert.deepStrictEqual(
      [...getBranchTips(branches)],
      [
        ['a', ['feature']],
        ['b', ['origin/other']],
      ]
    )
  })

  it('leaves out the remote branch of a local one', () => {
    assert.deepStrictEqual(getBranchTips(branches).get('a'), ['feature'])
  })

  it('names the local branches only for the commits of a branch', () => {
    assert.deepStrictEqual(
      [...getLocalBranchTips(branches)],
      [['a', ['feature']]]
    )
  })
})

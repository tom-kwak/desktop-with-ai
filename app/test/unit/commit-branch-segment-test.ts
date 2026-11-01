import { describe, it } from 'node:test'
import assert from 'node:assert'
import { getBranchSegment } from '../../src/lib/commit-branch-segment'

const commit = (sha: string, ...parentSHAs: ReadonlyArray<string>) => ({
  sha,
  parentSHAs,
})

const segment = (
  sha: string,
  commits: ReadonlyArray<ReturnType<typeof commit>>,
  tips: Record<string, ReadonlyArray<string>>
) => {
  const result = getBranchSegment(
    sha,
    commits.map(c => c.sha),
    new Map(commits.map(c => [c.sha, c])),
    new Map(Object.entries(tips))
  )
  return result && { names: result.branchNames, shas: [...result.shas].sort() }
}

describe('getBranchSegment', () => {
  //  f2  feature
  //  f1
  //  |  d2  develop
  //  | /
  //  d1
  //  d0
  const history = [
    commit('f2', 'f1'),
    commit('d2', 'd1'),
    commit('f1', 'd1'),
    commit('d1', 'd0'),
    commit('d0'),
  ]
  const tips = { f2: ['feature'], d2: ['develop'] }

  it('counts the commits made on a branch since it started', () => {
    assert.deepStrictEqual(segment('f1', history, tips), {
      names: ['feature'],
      shas: ['f1', 'f2'],
    })
  })

  it('does not count the commits that the branch started from', () => {
    assert.strictEqual(segment('f2', history, tips)?.shas.includes('d1'), false)
  })

  it('does not count the commits that another branch reaches too', () => {
    assert.deepStrictEqual(segment('d2', history, tips), {
      names: ['develop'],
      shas: ['d2'],
    })
  })

  it('counts the commits of a branch that has others on top of it', () => {
    // feature is just a commit on top of develop.
    const linear = [commit('f1', 'd2'), commit('d2', 'd1'), commit('d1')]
    const result = segment('d2', linear, { f1: ['feature'], d2: ['develop'] })

    assert.deepStrictEqual(result, { names: ['develop'], shas: ['d1', 'd2'] })
    assert.deepStrictEqual(
      segment('f1', linear, { f1: ['feature'], d2: ['develop'] }),
      { names: ['feature'], shas: ['f1'] }
    )
  })

  it('picks the branch that reaches the commit, if there is one', () => {
    assert.strictEqual(
      segment('d0', history, { f2: ['feature'] })?.names[0],
      'feature'
    )
    assert.strictEqual(segment('x', history, tips), null)
  })

  it('does not count the commits of the branch that it was merged into', () => {
    //  m  develop, merged feature
    //  |\
    //  | f1  feature
    //  |/
    //  d1
    //  d0
    const merged = [
      commit('m', 'd1', 'f1'),
      commit('f1', 'd1'),
      commit('d1', 'd0'),
      commit('d0'),
    ]
    const mergedTips = { m: ['develop'], f1: ['feature'] }

    assert.deepStrictEqual(segment('f1', merged, mergedTips), {
      names: ['feature'],
      shas: ['f1'],
    })
  })

  it('has no answer when the start of the branch is not loaded', () => {
    // d0 is not loaded, so it can't be told where feature started.
    const cut = [commit('f1', 'd1'), commit('d1', 'd0')]
    assert.strictEqual(segment('f1', cut, { f1: ['feature'] }), null)
  })
})

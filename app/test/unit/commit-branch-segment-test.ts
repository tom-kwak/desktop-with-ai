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

  describe('on a branch that merged others and grew out of an upstream', () => {
    //  m2  develop, merged feature
    //  |\
    //  | f1  feature
    //  |/
    //  m1  develop, merged older
    //  |\
    //  | o1  older, merged
    //  |/
    //  u1  upstream/development
    const history = [
      commit('m2', 'm1', 'f1'),
      commit('f1', 'm1'),
      commit('m1', 'u1', 'o1'),
      commit('o1', 'u1'),
      commit('u1', 'u0'),
      commit('u0'),
    ]
    const tips = {
      m2: ['develop'],
      f1: ['feature'],
      o1: ['older'],
      u1: ['upstream/development'],
    }
    const owners = { m2: ['develop'], f1: ['feature'], o1: ['older'] }

    const run = (sha: string) => {
      const result = getBranchSegment(
        sha,
        history.map(c => c.sha),
        new Map(history.map(c => [c.sha, c])),
        new Map(Object.entries(tips)),
        new Map(Object.entries(owners))
      )
      return result && [...result.shas].sort()
    }

    it('counts all the commits made on the branch, merges included', () => {
      assert.deepStrictEqual(run('m2'), ['m1', 'm2'])
    })

    it('counts the commits of a branch that was merged only', () => {
      assert.deepStrictEqual(run('f1'), ['f1'])
    })

    it('has no branch for the commits of the upstream', () => {
      assert.strictEqual(run('u1'), null)
    })
  })

  it('stops at a branch that only marks where this one started', () => {
    //  f1  feature
    //  u1  upstream/development
    //  u0
    const onRemote = [commit('f1', 'u1'), commit('u1', 'u0'), commit('u0')]
    const remoteTips = { f1: ['feature'], u1: ['upstream/development'] }
    const result = getBranchSegment(
      'f1',
      onRemote.map(c => c.sha),
      new Map(onRemote.map(c => [c.sha, c])),
      new Map(Object.entries(remoteTips)),
      new Map([['f1', ['feature']]])
    )

    assert.deepStrictEqual([...(result?.shas ?? [])], ['f1'])
  })

  it('puts a commit on at most one branch', () => {
    // Histories with merges and branches all over, the same on every run.
    let seed = 7
    const random = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % max
    }

    for (let round = 0; round < 300; round++) {
      const commits: Array<ReturnType<typeof commit>> = []

      for (let i = 0; i < 25; i++) {
        const older = commits.map(c => c.sha)
        const parents = [...older.slice(-1 - random(3), older.length)]
        commits.push(commit(`c${i}`, ...parents.slice(0, 1 + random(2))))
      }

      commits.reverse()

      const shas = commits.map(c => c.sha)
      const lookup = new Map(commits.map(c => [c.sha, c]))
      const tips = shas
        .filter(() => random(4) === 0)
        .map(s => [s, [s]] as const)
      const allTips = new Map(tips)

      for (const sha of shas) {
        const owners = tips.filter(
          tip =>
            getBranchSegment(sha, shas, lookup, allTips, new Map([tip])) !==
            null
        )
        assert.ok(owners.length <= 1, `${sha} is on ${owners.length} branches`)
      }
    }
  })

  it('takes the end of a shallow clone for the start of the history', () => {
    // The parents of s1 were cut off, so git reports that it has none.
    const shallow = [commit('s2', 's1'), commit('s1')]

    assert.deepStrictEqual(segment('s2', shallow, { s2: ['main'] }), {
      names: ['main'],
      shas: ['s1', 's2'],
    })
  })

  it('visits the commits once however many branches there are', () => {
    // A long line, with a lot of branches that leave it right at the top.
    class CountingMap<K, V> extends Map<K, V> {
      public gets = 0
      public override get(key: K) {
        this.gets++
        return super.get(key)
      }
    }

    const run = (length: number, branchCount: number) => {
      const line = Array.from({ length }, (_, i) =>
        i === length - 1 ? commit(`l${i}`) : commit(`l${i}`, `l${i + 1}`)
      )
      const side = Array.from({ length: branchCount }, (_, i) =>
        commit(`b${i}`, 'l0')
      )
      const commits = [...side, ...line]
      const lookup = new CountingMap(commits.map(c => [c.sha, c]))
      const sideTips = side.map(c => [c.sha, [c.sha]] as const)
      const remoteTips = new Map(sideTips)

      getBranchSegment(
        'b0',
        commits.map(c => c.sha),
        lookup,
        remoteTips,
        new Map([sideTips[0]])
      )

      return lookup.gets
    }

    // A hundred times the branches on the same line is about the same work,
    // where going over the whole line for each would take a hundred times it.
    assert.ok(run(1000, 500) < run(1000, 5) * 2)
  })
})

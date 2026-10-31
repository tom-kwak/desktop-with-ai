import { describe, it } from 'node:test'
import assert from 'node:assert'
import { computeCommitGraph } from '../../src/lib/commit-graph'

const commit = (sha: string, ...parentSHAs: ReadonlyArray<string>) => ({
  sha,
  parentSHAs,
})

const columns = (commits: ReadonlyArray<ReturnType<typeof commit>>) =>
  computeCommitGraph(commits).rows.map(r => r.column)

describe('computeCommitGraph', () => {
  it('handles an empty list', () => {
    const { rows, columnCount } = computeCommitGraph([])
    assert.strictEqual(rows.length, 0)
    assert.strictEqual(columnCount, 0)
  })

  it('keeps a linear history in one column', () => {
    const graph = computeCommitGraph([
      commit('c', 'b'),
      commit('b', 'a'),
      commit('a'),
    ])

    assert.deepStrictEqual(
      graph.rows.map(r => r.column),
      [0, 0, 0]
    )
    assert.strictEqual(graph.columnCount, 1)
    assert.strictEqual(graph.rows[0].top.length, 0)
    assert.strictEqual(graph.rows[1].top.length, 1)
    assert.strictEqual(graph.rows[2].bottom.length, 0)
    assert.ok(graph.rows.every(r => r.color === graph.rows[0].color))
  })

  it('draws a branch that was merged', () => {
    //  m      merge of b into a
    //  |\
    //  a |
    //  | b
    //  |/
    //  o
    const graph = computeCommitGraph([
      commit('m', 'a', 'b'),
      commit('a', 'o'),
      commit('b', 'o'),
      commit('o'),
    ])
    const [merge, main, side, base] = graph.rows

    assert.strictEqual(graph.columnCount, 2)
    assert.strictEqual(merge.isMerge, true)
    assert.deepStrictEqual(
      merge.bottom.map(e => [e.from, e.to]),
      [
        [0, 0],
        [0, 1],
      ]
    )

    assert.strictEqual(main.column, 0)
    assert.deepStrictEqual(
      main.passing.map(l => l.column),
      [1]
    )

    assert.strictEqual(side.column, 1)
    assert.deepStrictEqual(
      side.passing.map(l => l.column),
      [0]
    )
    assert.deepStrictEqual(
      side.bottom.map(e => [e.from, e.to]),
      [[1, 0]]
    )

    assert.strictEqual(base.column, 0)
    assert.strictEqual(base.isMerge, false)
    assert.notStrictEqual(main.color, side.color)
  })

  it('joins two children of the same parent in the left column', () => {
    const { rows } = computeCommitGraph([
      commit('a', 'o'),
      commit('b', 'o'),
      commit('o'),
    ])

    assert.strictEqual(rows[1].column, 1)
    assert.deepStrictEqual(
      rows[1].bottom.map(e => [e.from, e.to]),
      [[1, 0]]
    )
    assert.strictEqual(rows[2].column, 0)
  })

  it('gives every parent of an octopus merge a line', () => {
    const graph = computeCommitGraph([
      commit('m', 'a', 'b', 'c'),
      commit('a'),
      commit('b'),
      commit('c'),
    ])

    assert.strictEqual(graph.rows[0].bottom.length, 3)
    assert.strictEqual(graph.columnCount, 3)
  })

  it('reuses a column once its branch has ended', () => {
    assert.deepStrictEqual(
      columns([
        commit('m', 'a', 'b'),
        commit('b', 'a'),
        commit('a', 'o'),
        commit('n', 'o'),
        commit('o'),
      ]),
      [0, 1, 0, 1, 0]
    )
  })

  it('keeps the line going when a parent is not in the list', () => {
    const graph = computeCommitGraph([commit('b', 'a'), commit('c', 'z')])

    assert.strictEqual(graph.rows[1].column, 1)
    assert.deepStrictEqual(
      graph.rows[1].passing.map(l => l.column),
      [0]
    )
  })

  it('does not lose a line when a parent is listed above its child', () => {
    const graph = computeCommitGraph([commit('a'), commit('b', 'a')])

    assert.strictEqual(graph.rows.length, 2)
    assert.strictEqual(graph.rows[1].bottom.length, 1)
  })
})

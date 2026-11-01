import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { Branch, BranchType } from '../../../src/models/branch'
import { Commit } from '../../../src/models/commit'
import { BranchChip } from '../../../src/ui/history/branch-chip'
import {
  getCommitListGraph,
  getCommitRowHighlight,
  isCommitOnCurrentBranch,
  renderCommitGraphRow,
} from '../../../src/ui/history/commit-graph-row'
import { render } from '../../helpers/ui/render'

const branch = (name: string, sha: string, type = BranchType.Local) =>
  new Branch(name, null, { sha }, type, '')

const commit = (sha: string, ...parentSHAs: ReadonlyArray<string>) =>
  ({ sha, parentSHAs } as unknown as Commit)

//  f2  feature
//  f1
//  |  d2  develop
//  | /
//  d1
//  d0
const commits = [
  commit('f2', 'f1'),
  commit('d2', 'd1'),
  commit('f1', 'd1'),
  commit('d1', 'd0'),
  commit('d0'),
]
const commitSHAs = commits.map(c => c.sha)
const commitLookup = new Map(commits.map(c => [c.sha, c]))
const branches = [branch('feature', 'f2'), branch('develop', 'd2')]
const graph = getCommitListGraph(branches, null)

const options = (selectedSHAs: ReadonlyArray<string>) => ({
  commitSHAs,
  commitLookup,
  selectedSHAs,
  graph,
  height: 50,
})

const marked = (selectedSHAs: ReadonlyArray<string>) =>
  commitSHAs.filter(
    (_, row) => getCommitRowHighlight(row, options(selectedSHAs)).isHighlighted
  )

describe('getCommitListGraph', () => {
  it('adds the current branch that the list leaves out', () => {
    const current = branch('main', 'm1')
    const { branchTips, localBranchTips } = getCommitListGraph(
      [branch('other', 'o1')],
      current
    )

    assert.deepStrictEqual(branchTips.get('m1'), ['main'])
    assert.deepStrictEqual(localBranchTips.get('m1'), ['main'])
  })

  it('does not name the current branch twice', () => {
    const current = branch('main', 'm1')
    const { branchTips } = getCommitListGraph(
      [branch('main', 'm1'), branch('other', 'o1')],
      current
    )

    assert.deepStrictEqual(branchTips.get('m1'), ['main'])
  })

  it('gives the same result for the same branches', () => {
    const list = [branch('main', 'm1')]
    assert.strictEqual(
      getCommitListGraph(list, null),
      getCommitListGraph(list, null)
    )
  })
})

describe('getCommitRowHighlight', () => {
  it('marks the commits of the branch of the selected commit', () => {
    assert.deepStrictEqual(marked(['f1']), ['f2', 'f1'])
  })

  it('dims every lane of the rows that are not on the branch', () => {
    const row = commitSHAs.indexOf('d2')
    const highlight = getCommitRowHighlight(row, options(['f1']))

    assert.strictEqual(highlight.highlightedColor, -1)
    assert.strictEqual(highlight.isHighlighted, false)
  })

  it('marks nothing with no commit selected', () => {
    const highlight = getCommitRowHighlight(0, options([]))

    assert.strictEqual(highlight.highlightedColor, undefined)
    assert.deepStrictEqual(marked([]), [])
  })

  it('marks nothing with several commits selected', () => {
    assert.deepStrictEqual(marked(['f1', 'd1']), [])
  })

  it('marks nothing when the selected commit is not listed', () => {
    assert.deepStrictEqual(marked(['gone']), [])
  })

  it('follows the lane when the branch can not be told', () => {
    // d1 is on the lines of both branches, so neither can be said to own it.
    const row = commitSHAs.indexOf('d1')
    const lane = getCommitRowHighlight(row, options(['d1'])).highlightedColor

    assert.notStrictEqual(lane, undefined)
    assert.notStrictEqual(lane, -1)
    assert.ok(marked(['d1']).includes('d1'))
  })
})

describe('isCommitOnCurrentBranch', () => {
  const onCurrentBranch = (
    current: Branch | null,
    selectedSHAs: ReadonlyArray<string> = [],
    list = commitSHAs
  ) => {
    const graph = getCommitListGraph(branches, current)
    const opts = { ...options(selectedSHAs), graph, commitSHAs: list }
    return list.filter((_, row) => isCommitOnCurrentBranch(row, opts))
  }

  it('finds the commits made on the current branch', () => {
    assert.deepStrictEqual(onCurrentBranch(branches[0]), ['f2', 'f1'])
  })

  it('does not depend on the selected commit', () => {
    assert.deepStrictEqual(onCurrentBranch(branches[0], ['d2']), ['f2', 'f1'])
    assert.deepStrictEqual(onCurrentBranch(branches[0], ['f1', 'd1']), [
      'f2',
      'f1',
    ])
  })

  it('finds nothing without a current branch', () => {
    assert.deepStrictEqual(onCurrentBranch(null), [])
  })

  it('finds nothing when the start of the branch is not loaded', () => {
    const list = ['f2', 'f1']
    const lookup = new Map([
      ['f2', commit('f2', 'f1')],
      ['f1', commit('f1', 'd1')],
    ])
    const opts = {
      ...options([]),
      commitSHAs: list,
      commitLookup: lookup,
      graph: getCommitListGraph([branches[0]], branches[0]),
    }

    assert.strictEqual(isCommitOnCurrentBranch(0, opts), false)
  })
})

describe('renderCommitGraphRow', () => {
  const currentGraph = getCommitListGraph(branches, branches[0])
  const ring = (sha: string, selectedSHAs: ReadonlyArray<string> = []) =>
    render(
      renderCommitGraphRow(
        commitSHAs.indexOf(sha),
        { ...options(selectedSHAs), graph: currentGraph },
        null
      )
    ).container.querySelector('.current-branch-ring')

  it('rings the commits of the current branch', () => {
    assert.notStrictEqual(ring('f1'), null)
    assert.strictEqual(ring('d2'), null)
  })

  it('keeps the ring when another branch is selected', () => {
    assert.notStrictEqual(ring('f1', ['d2']), null)
  })

  it('marks a row on the branch with the color of its lane', () => {
    const row = commitSHAs.indexOf('f1')
    const { container } = render(
      renderCommitGraphRow(row, options(['f2']), <span>content</span>)
    )
    const wrapper = container.querySelector<HTMLElement>('.commit-with-graph')

    assert.ok(wrapper?.classList.contains('in-selected-lane'))
    assert.notStrictEqual(wrapper?.style.getPropertyValue('--lane-color'), '')
    assert.strictEqual(wrapper?.textContent, 'content')
  })

  it('leaves a row off the branch unmarked', () => {
    const row = commitSHAs.indexOf('d2')
    const { container } = render(
      renderCommitGraphRow(row, options(['f2']), null)
    )

    assert.strictEqual(container.querySelector('.in-selected-lane'), null)
  })
})

describe('BranchChip', () => {
  it('renders nothing without branches', () => {
    const { container } = render(<BranchChip />)
    assert.strictEqual(container.textContent, '')

    const empty = render(<BranchChip branchNames={[]} />)
    assert.strictEqual(empty.container.textContent, '')
  })

  it('shows the only branch', () => {
    const { container } = render(<BranchChip branchNames={['develop']} />)

    assert.strictEqual(container.textContent, 'develop')
    assert.strictEqual(container.querySelector('.branch-indicator-more'), null)
  })

  it('shows the first of several branches and how many more there are', () => {
    const { container } = render(
      <BranchChip branchNames={['develop', 'main', 'other']} />
    )

    assert.strictEqual(
      container.querySelector('.branch-name')?.textContent,
      'develop'
    )
    assert.strictEqual(
      container.querySelector('.branch-indicator-more')?.textContent,
      '+2'
    )
  })
})

import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { Branch, BranchType } from '../../../src/models/branch'
import { Commit } from '../../../src/models/commit'
import { CommitIdentity } from '../../../src/models/commit-identity'
import { CommitList } from '../../../src/ui/history/commit-list'
import {
  getCommitListGraph,
  ICommitListGraph,
} from '../../../src/ui/history/commit-graph-row'
import { render } from '../../helpers/ui/render'

const author = new CommitIdentity('Hubot', 'hubot@github.com', new Date())

const commit = (sha: string, ...parentSHAs: ReadonlyArray<string>) =>
  new Commit(sha, sha, `Commit ${sha}`, '', author, author, parentSHAs, [], [])

//  f1  feature
//  |  d2  develop, tagged
//  |/
//  d1
//  d0
const commits = [
  commit('f1', 'd1'),
  new Commit('d2', 'd2', 'Commit d2', '', author, author, ['d1'], [], ['v1']),
  commit('d1', 'd0'),
  commit('d0'),
]

const branch = (name: string, sha: string) =>
  new Branch(name, null, { sha }, BranchType.Local, '')

const graph = getCommitListGraph(
  [branch('feature', 'f1'), branch('develop', 'd2')],
  null
)

// The list looks for this on the window, where the test setup doesn't put it.
Object.assign(window, { ResizeObserver: globalThis.ResizeObserver })

/** Renders the list, and a row of it the way that the list would. */
function renderRow(
  row: number,
  selectedSHAs: ReadonlyArray<string>,
  listGraph?: ICommitListGraph
) {
  const list = React.createRef<CommitList>()

  render(
    <CommitList
      ref={list}
      gitHubRepository={null}
      isLocalRepository={false}
      commitSHAs={commits.map(c => c.sha)}
      commitLookup={new Map(commits.map(c => [c.sha, c]))}
      selectedSHAs={selectedSHAs}
      emoji={new Map()}
      localCommitSHAs={[]}
      accounts={[]}
      preferAbsoluteDates={false}
      graph={listGraph}
    />
  )

  const current = list.current
  assert.ok(current !== null)

  const renderer =
    listGraph === undefined
      ? current['renderCommit']
      : current['renderCommitWithGraph']
  const element = renderer(row)
  assert.ok(element !== null)

  return render(element).container
}

describe('CommitList with the commit graph', () => {
  it('shows a commit without graph or branch when it has none', () => {
    const container = renderRow(0, ['f1'])

    assert.strictEqual(container.querySelector('.commit-with-graph'), null)
    assert.strictEqual(container.querySelector('.branch-indicator'), null)
    assert.ok(container.textContent?.includes('Commit f1'))
  })

  it('shows the graph and the branch next to the commit', () => {
    const container = renderRow(0, [], graph)

    assert.ok(container.querySelector('.commit-with-graph svg') !== null)
    assert.strictEqual(
      container.querySelector('.branch-name')?.textContent,
      'feature'
    )
  })

  it('keeps tags where they are, apart from the branch', () => {
    const container = renderRow(1, [], graph)

    assert.strictEqual(
      container.querySelector('.commit-indicators .tag-name')?.textContent,
      'v1'
    )
    assert.strictEqual(
      container.querySelector('.commit-indicators .branch-indicator'),
      null
    )
    assert.ok(container.querySelector('.description .branch-indicator'))
  })

  it('marks the commits on the branch of the selected one', () => {
    assert.ok(renderRow(0, ['f1'], graph).querySelector('.in-selected-lane'))
    assert.strictEqual(
      renderRow(1, ['f1'], graph).querySelector('.in-selected-lane'),
      null
    )
  })

  it('marks no commit when several are selected', () => {
    assert.strictEqual(
      renderRow(0, ['f1', 'd2'], graph).querySelector('.in-selected-lane'),
      null
    )
  })
})

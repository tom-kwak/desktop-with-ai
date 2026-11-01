import * as React from 'react'
import classNames from 'classnames'
import memoizeOne from 'memoize-one'
import { Branch } from '../../models/branch'
import { Commit } from '../../models/commit'
import { computeCommitGraph } from '../../lib/commit-graph'
import { getBranchSegment } from '../../lib/commit-branch-segment'
import {
  BranchTips,
  getBranchTips,
  getLocalBranchTips,
} from '../../lib/commit-branch-tips'
import { CommitGraphCell, getColor } from './commit-graph-cell'

/** What the commit list needs to show the commit graph next to the commits. */
export interface ICommitListGraph {
  /** The branches to label the commits that they point at with. */
  readonly branchTips: BranchTips
  /** The branches that a commit can be said to be made on. */
  readonly localBranchTips: BranchTips
  /** The commit that the current branch points at, if there's a branch. */
  readonly currentTipSha: string | null
}

/**
 * Gets the branches for the commit graph. The compare state doesn't list the
 * current branch, so it's added here.
 */
export const getCommitListGraph = memoizeOne(
  (
    branches: ReadonlyArray<Branch>,
    currentBranch: Branch | null
  ): ICommitListGraph => {
    // It can be in the list until that catches up with a checkout.
    const all =
      currentBranch === null
        ? branches
        : [
            currentBranch,
            ...branches.filter(b => b.name !== currentBranch.name),
          ]

    return {
      branchTips: getBranchTips(all),
      localBranchTips: getLocalBranchTips(all),
      currentTipSha: currentBranch?.tip.sha ?? null,
    }
  }
)

/** A color that no lane has, to dim every lane of a row of the graph. */
const NoLaneColor = -1

const getGraph = memoizeOne(
  (commitSHAs: ReadonlyArray<string>, lookup: Map<string, Commit>) =>
    computeCommitGraph(
      commitSHAs.map(sha => lookup.get(sha) ?? { sha, parentSHAs: [] })
    )
)

const findSegment = (
  sha: string | null | undefined,
  commitSHAs: ReadonlyArray<string>,
  lookup: Map<string, Commit>,
  graph: ICommitListGraph
) =>
  sha === undefined || sha === null
    ? null
    : getBranchSegment(
        sha,
        commitSHAs,
        lookup,
        graph.branchTips,
        graph.localBranchTips
      )

const getSegment = memoizeOne(findSegment)

// Apart from the selected one, as each would otherwise push out the other.
const getCurrentBranchSegment = memoizeOne(findSegment)

const getSelectedRow = memoizeOne(
  (commitSHAs: ReadonlyArray<string>, sha: string) => commitSHAs.indexOf(sha)
)

interface ICommitGraphRowOptions {
  readonly commitSHAs: ReadonlyArray<string>
  readonly commitLookup: Map<string, Commit>
  readonly selectedSHAs: ReadonlyArray<string>
  readonly graph: ICommitListGraph
  readonly height: number
}

/**
 * Works out how a row of the graph stands out for the selected commit.
 *
 * @returns the lane to emphasize in the row, if any, and whether the commit of
 *          the row is marked.
 */
export function getCommitRowHighlight(
  row: number,
  options: ICommitGraphRowOptions
) {
  const { commitSHAs, commitLookup, selectedSHAs, graph } = options
  const { rows } = getGraph(commitSHAs, commitLookup)
  const selectedSHA = selectedSHAs.length === 1 ? selectedSHAs[0] : undefined
  const segment = getSegment(selectedSHA, commitSHAs, commitLookup, graph)

  if (segment !== null) {
    // The commits made on the branch of the selected commit stand out, and so
    // does their own lane, while the rest of the graph is dimmed.
    const isHighlighted = segment.shas.has(commitSHAs[row])
    const highlightedColor = isHighlighted ? rows[row].color : NoLaneColor
    return { highlightedColor, isHighlighted }
  }

  const selectedRow =
    selectedSHA === undefined ? -1 : getSelectedRow(commitSHAs, selectedSHA)

  if (selectedRow === -1) {
    return { highlightedColor: undefined, isHighlighted: false }
  }

  // The branch can't be told, so follow the lane of the selected commit.
  const highlightedColor = rows[selectedRow].color
  return {
    highlightedColor,
    isHighlighted: highlightedColor === rows[row].color,
  }
}

/**
 * Whether the commit of a row was made on the current branch. No commit is when
 * the start of the branch can't be told, which leaves its extent unknown.
 */
export function isCommitOnCurrentBranch(
  row: number,
  options: ICommitGraphRowOptions
) {
  const { commitSHAs, commitLookup, graph } = options
  const segment = getCurrentBranchSegment(
    graph.currentTipSha,
    commitSHAs,
    commitLookup,
    graph
  )

  return segment !== null && segment.shas.has(commitSHAs[row])
}

/** Draws a row of the commit list with its part of the commit graph. */
export function renderCommitGraphRow(
  row: number,
  options: ICommitGraphRowOptions,
  content: React.ReactNode
) {
  const { commitSHAs, commitLookup, height } = options
  const { rows, columnCount } = getGraph(commitSHAs, commitLookup)
  const { highlightedColor, isHighlighted } = getCommitRowHighlight(
    row,
    options
  )

  return (
    <div
      className={classNames('commit-with-graph', {
        'in-selected-lane': isHighlighted,
      })}
      style={
        { '--lane-color': getColor(rows[row].color) } as React.CSSProperties
      }
    >
      <CommitGraphCell
        row={rows[row]}
        columnCount={columnCount}
        height={height}
        highlightedColor={highlightedColor}
        isOnCurrentBranch={isCommitOnCurrentBranch(row, options)}
      />
      {content}
    </div>
  )
}

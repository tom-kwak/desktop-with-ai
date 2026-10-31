/** What the graph needs to know about a commit. */
export interface ICommitGraphCommit {
  readonly sha: string
  readonly parentSHAs: ReadonlyArray<string>
}

/** A line between two columns across half of a row. */
export interface ICommitGraphEdge {
  readonly from: number
  readonly to: number
  readonly color: number
}

/** A line going straight through a row, past that row's commit. */
export interface ICommitGraphPassingLine {
  readonly column: number
  readonly color: number
}

/**
 * How to draw one row of the graph. Each row draws only its own height so that
 * a virtualized list can render any row on its own.
 */
export interface ICommitGraphRow {
  /** The column the commit sits in. */
  readonly column: number
  readonly color: number
  /** Whether the commit has more than one parent. */
  readonly isMerge: boolean
  /** Lines from the top of the row into the commit. */
  readonly top: ReadonlyArray<ICommitGraphEdge>
  /** Lines from the commit to the bottom of the row. */
  readonly bottom: ReadonlyArray<ICommitGraphEdge>
  readonly passing: ReadonlyArray<ICommitGraphPassingLine>
}

export interface ICommitGraph {
  /** One entry per commit, in the same order. */
  readonly rows: ReadonlyArray<ICommitGraphRow>
  /** How many columns the widest row needs. */
  readonly columnCount: number
}

/** A column that is waiting for a commit further down the list. */
interface ILane {
  readonly sha: string
  readonly color: number
}

/**
 * Works out how to draw the commits as a graph, top to bottom, with each
 * branch in its own column.
 *
 * Commits are expected newest first, with children above their parents, which
 * is how the history is listed. A parent that isn't in the list (it hasn't been
 * loaded yet) just keeps its line going to the end of the list.
 */
export function computeCommitGraph(
  commits: ReadonlyArray<ICommitGraphCommit>
): ICommitGraph {
  const lanes: Array<ILane | null> = []
  const rows: ICommitGraphRow[] = []
  let nextColor = 0
  let columnCount = 0

  const firstFreeColumn = () => {
    const free = lanes.indexOf(null)
    return free === -1 ? lanes.length : free
  }

  for (const { sha, parentSHAs } of commits) {
    const top: ICommitGraphEdge[] = []
    let column = -1
    let color = -1

    // Every lane waiting for this commit joins it, in the leftmost of them.
    lanes.forEach((lane, index) => {
      if (lane?.sha === sha) {
        column = column === -1 ? index : column
        color = color === -1 ? lane.color : color
        top.push({ from: index, to: column, color: lane.color })
        lanes[index] = null
      }
    })

    // Nothing was waiting for it, so it's the tip of a branch.
    if (column === -1) {
      column = firstFreeColumn()
      color = nextColor++
    }

    const passing = lanes.flatMap((lane, index) =>
      lane === null ? [] : [{ column: index, color: lane.color }]
    )

    const bottom: ICommitGraphEdge[] = []
    parentSHAs.forEach((parent, index) => {
      const existing = lanes.findIndex(lane => lane?.sha === parent)

      if (existing !== -1) {
        const lane = lanes[existing]
        const edgeColor = index === 0 || lane === null ? color : lane.color
        bottom.push({ from: column, to: existing, color: edgeColor })
        return
      }

      // The first parent continues the commit's own branch.
      const to = index === 0 ? column : firstFreeColumn()
      const laneColor = index === 0 ? color : nextColor++
      lanes[to] = { sha: parent, color: laneColor }
      bottom.push({ from: column, to, color: laneColor })
    })

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop()
    }

    columnCount = Math.max(
      columnCount,
      column + 1,
      ...passing.map(line => line.column + 1),
      ...top.map(edge => edge.from + 1),
      ...bottom.map(edge => edge.to + 1)
    )

    rows.push({
      column,
      color,
      isMerge: parentSHAs.length > 1,
      top,
      bottom,
      passing,
    })
  }

  return { rows, columnCount }
}

import * as React from 'react'
import { ICommitGraphEdge, ICommitGraphRow } from '../../lib/commit-graph'

/** Horizontal space for each column. */
const ColumnWidth = 10

/** Columns past this share the last one, to leave room for the commit. */
const MaxColumns = 6

/** How visible the lanes are that aren't the highlighted one. */
const DimmedOpacity = 0.25

/** How far from a commit the ring around it is, clear of a merge commit too. */
const RingRadius = 6.5

/** Colors that stay readable on the light and dark themes. */
const Colors = [
  '#378ADD',
  '#1D9E75',
  '#D85A30',
  '#7F77DD',
  '#D4537E',
  '#BA7517',
] as const

export const getColor = (color: number) => Colors[color % Colors.length]

const getX = (column: number) =>
  (Math.min(column, MaxColumns - 1) + 0.5) * ColumnWidth

interface ICommitGraphCellProps {
  readonly row: ICommitGraphRow
  /** How many columns the graph has, so that all rows are equally wide. */
  readonly columnCount: number
  readonly height: number
  /**
   * The lane to emphasize, as one of the colors of the graph. Everything else
   * is dimmed. Nothing is dimmed when it's undefined.
   */
  readonly highlightedColor?: number
  /** Whether the commit was made on the current branch, which rings it. */
  readonly isOnCurrentBranch?: boolean
}

/** The part of the commit graph that belongs to one row of the commit list. */
export class CommitGraphCell extends React.PureComponent<ICommitGraphCellProps> {
  private getOpacity(color: number) {
    const { highlightedColor } = this.props
    return highlightedColor === undefined || highlightedColor === color
      ? 1
      : DimmedOpacity
  }

  private renderEdge(edge: ICommitGraphEdge, fromY: number, key: string) {
    const toY = fromY + this.props.height / 2
    const midY = (fromY + toY) / 2
    const fromX = getX(edge.from)
    const toX = getX(edge.to)

    return (
      <path
        key={key}
        d={`M${fromX} ${fromY}C${fromX} ${midY} ${toX} ${midY} ${toX} ${toY}`}
        stroke={getColor(edge.color)}
        opacity={this.getOpacity(edge.color)}
      />
    )
  }

  public render() {
    const { row, columnCount, height, isOnCurrentBranch } = this.props
    const width = Math.min(columnCount, MaxColumns) * ColumnWidth
    const x = getX(row.column)
    const y = height / 2
    const color = getColor(row.color)

    return (
      <svg
        className="commit-graph-cell"
        width={width}
        height={height}
        aria-hidden={true}
      >
        {row.passing.map(line => (
          <line
            key={line.column}
            x1={getX(line.column)}
            x2={getX(line.column)}
            y1={0}
            y2={height}
            stroke={getColor(line.color)}
            opacity={this.getOpacity(line.color)}
          />
        ))}
        {row.top.map((e, i) => this.renderEdge(e, 0, `top-${i}`))}
        {row.bottom.map((e, i) => this.renderEdge(e, y, `bottom-${i}`))}
        <g opacity={this.getOpacity(row.color)}>
          <circle cx={x} cy={y} r={row.isMerge ? 4.5 : 3.5} fill={color} />
          {row.isMerge && <circle cx={x} cy={y} r={1.5} fill="#ffffff" />}
          {isOnCurrentBranch && (
            <circle
              className="current-branch-ring"
              cx={x}
              cy={y}
              r={RingRadius}
              stroke={color}
            />
          )}
        </g>
      </svg>
    )
  }
}

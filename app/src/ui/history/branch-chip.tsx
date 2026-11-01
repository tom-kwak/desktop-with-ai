import * as React from 'react'

interface IBranchChipProps {
  /** The branches that point at a commit. */
  readonly branchNames?: ReadonlyArray<string>
}

/** Labels a commit with the first of the branches that point at it. */
export class BranchChip extends React.PureComponent<IBranchChipProps> {
  public render() {
    const { branchNames } = this.props

    if (branchNames === undefined || branchNames.length === 0) {
      return null
    }

    return (
      <span className="branch-indicator" title={branchNames.join(', ')}>
        <span className="branch-name">{branchNames[0]}</span>
        {branchNames.length > 1 && (
          <span className="branch-indicator-more">
            +{branchNames.length - 1}
          </span>
        )}
      </span>
    )
  }
}

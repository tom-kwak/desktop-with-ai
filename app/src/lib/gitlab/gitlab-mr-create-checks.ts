/** Why a merge request can't be created yet, or a warning about it. */
export interface ICreateMergeRequestProblem {
  readonly message: string
  /** Blocking problems disable the Create button. */
  readonly blocking: boolean
  /** Set when the branch already has an open merge request. */
  readonly existingIid?: number
}

export interface ICreateMergeRequestInput {
  readonly title: string
  readonly sourceBranch: string
  readonly targetBranch: string
  /** Branches on GitLab, or null while loading. */
  readonly remoteBranches: ReadonlyArray<string> | null
  /** The open merge request of the source branch, if any. */
  readonly existingIid: number | null
  /**
   * Commits on the source branch that the target doesn't have, as far as
   * the local remote-tracking branches know; null if unknown.
   */
  readonly commitsAhead: number | null
}

/**
 * Check a new merge request before sending it, so the form can say what's
 * wrong instead of the button doing nothing. Mirrors the reasons GitLab
 * would refuse it.
 */
export function getCreateMergeRequestProblem(
  input: ICreateMergeRequestInput
): ICreateMergeRequestProblem | null {
  const { sourceBranch, targetBranch, remoteBranches } = input

  if (input.existingIid !== null) {
    return {
      message: `${sourceBranch} already has an open merge request (!${input.existingIid}).`,
      blocking: true,
      existingIid: input.existingIid,
    }
  }
  if (remoteBranches !== null && !remoteBranches.includes(sourceBranch)) {
    return {
      message: `GitLab doesn't have ${sourceBranch} yet. Push the branch first.`,
      blocking: true,
    }
  }
  if (targetBranch.length === 0) {
    return { message: 'Choose a target branch.', blocking: true }
  }
  if (targetBranch === sourceBranch) {
    return {
      message: `A branch can't be merged into itself. Choose a target other than ${sourceBranch}.`,
      blocking: true,
    }
  }
  if (remoteBranches !== null && !remoteBranches.includes(targetBranch)) {
    return {
      message: `GitLab doesn't have the target branch ${targetBranch}.`,
      blocking: true,
    }
  }
  if (input.title.trim().length === 0) {
    return { message: 'Enter a title.', blocking: true }
  }
  if (input.commitsAhead === 0) {
    return {
      message: `${sourceBranch} has no commits that ${targetBranch} doesn't have, so there's nothing to merge.`,
      blocking: false,
    }
  }
  return null
}

const preferredTargets = ['main', 'master', 'develop', 'development']

/**
 * The branch to merge into by default: the project's default branch,
 * unless that's the branch being merged.
 */
export function pickDefaultTarget(
  defaultBranch: string | null,
  sourceBranch: string,
  remoteBranches: ReadonlyArray<string>
): string {
  if (defaultBranch !== null && defaultBranch !== sourceBranch) {
    return defaultBranch
  }
  const others = remoteBranches.filter(b => b !== sourceBranch)
  return preferredTargets.find(b => others.includes(b)) ?? others[0] ?? ''
}

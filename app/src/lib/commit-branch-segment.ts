/** What's needed of a commit to follow its parents. */
interface IParentLinks {
  readonly sha: string
  readonly parentSHAs: ReadonlyArray<string>
}

/** The commits that were made on one branch. */
export interface IBranchSegment {
  /** The commit that the branch points at. */
  readonly tipSha: string
  /** The names of the branches pointing at the tip. */
  readonly branchNames: ReadonlyArray<string>
  /** The shas of the commits that were made on the branch. */
  readonly shas: ReadonlySet<string>
}

/**
 * The shas of a commit and everything it descends from that is loaded, without
 * going through the commit `avoid`.
 */
function getReachable(
  sha: string,
  lookup: ReadonlyMap<string, IParentLinks>,
  avoid?: string
): Set<string> {
  const reachable = new Set<string>()
  const pending = [sha]

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next === avoid || reachable.has(next)) {
      continue
    }

    reachable.add(next)
    pending.push(...(lookup.get(next)?.parentSHAs ?? []))
  }

  return reachable
}

/** The shas of a commit and of the first parent of each, going back. */
function getFirstParentChain(
  sha: string,
  lookup: ReadonlyMap<string, IParentLinks>
): Set<string> {
  const chain = new Set<string>()

  for (
    let next: string | undefined = sha;
    next !== undefined && !chain.has(next);
    next = lookup.get(next)?.parentSHAs[0]
  ) {
    chain.add(next)
  }

  return chain
}

/**
 * Works out which commits were made on the same branch as a commit, which git
 * doesn't record. For each branch that is the commits from its tip, following
 * the first parent of each, up to where the branch started, which is the first
 * commit that another branch reaches too.
 *
 * A branch that was built on top of the branch isn't taken as another one,
 * but one that the branch was merged into is, for the commits that it got on
 * its own. Of the branches that have the commit among
 * theirs, the one with the fewest commits wins, as that fits it best.
 *
 * A branch is skipped when the start of it can't be told, which is when its
 * history runs out of the loaded commits before it meets another branch.
 * Returns null when no branch is left for the commit.
 *
 * @param commitSHAs The loaded commits, newest first.
 * @param lookup     The commits by their sha.
 * @param tips       The names of the branches by the sha they point at.
 */
export function getBranchSegment(
  sha: string,
  commitSHAs: ReadonlyArray<string>,
  lookup: ReadonlyMap<string, IParentLinks>,
  tips: ReadonlyMap<string, ReadonlyArray<string>>
): IBranchSegment | null {
  const tipSHAs = commitSHAs.filter(s => tips.has(s))
  const reachableByTip = new Map(
    tipSHAs.map(tipSha => [tipSha, getReachable(tipSha, lookup)])
  )

  let found: IBranchSegment | null = null

  for (const [tipSha, reachable] of reachableByTip) {
    if (!reachable.has(sha)) {
      continue
    }

    // What the other branches reach, which the branch grew out of.
    const others = new Set<string>()
    for (const [otherSha, otherReachable] of reachableByTip) {
      if (otherSha === tipSha) {
        continue
      }

      if (!otherReachable.has(tipSha)) {
        otherReachable.forEach(s => others.add(s))
      } else if (!getFirstParentChain(otherSha, lookup).has(tipSha)) {
        // The branch was merged into the other one, which has more of its own,
        // and which the branch started from where they meet.
        getReachable(otherSha, lookup, tipSha).forEach(s => others.add(s))
      }
      // Otherwise the other branch is built on top of this one, and reaches
      // all of it.
    }

    const shas = new Set<string>()
    let startKnown = false

    for (
      let next: string | undefined = tipSha;
      next !== undefined && !others.has(next) && !shas.has(next);
      next = lookup.get(next)?.parentSHAs[0]
    ) {
      const commit = lookup.get(next)
      if (commit === undefined) {
        break
      }

      shas.add(next)
      // The history starts here, or at the commit where the branch began.
      startKnown =
        commit.parentSHAs.length === 0 || others.has(commit.parentSHAs[0])
    }

    if (
      startKnown &&
      shas.has(sha) &&
      (found === null || shas.size < found.shas.size)
    ) {
      found = { tipSha, branchNames: tips.get(tipSha) ?? [], shas }
    }
  }

  return found
}

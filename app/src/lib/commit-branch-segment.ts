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

/** The shas of a commit and everything it descends from that is loaded. */
function getReachable(
  sha: string,
  lookup: ReadonlyMap<string, IParentLinks>
): Set<string> {
  const reachable = new Set<string>()
  const pending = [sha]

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (reachable.has(next)) {
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
 * The commits on the lines of the branches that this one grew out of, which
 * are where it started.
 *
 * Only the line of another branch counts, not everything it reaches, as that
 * takes in all that was merged into it. A branch that was merged into this one
 * is left out, and so is one built on top of it, as they come from it.
 *
 * The lines of branches run together, so each stops at what is known already.
 * That keeps this to one visit of each commit, however many branches there are.
 */
function getLinesOfOthers(
  tipSha: string,
  tipSHAs: ReadonlyArray<string>,
  chain: ReadonlySet<string>,
  reachable: ReadonlySet<string>,
  lookup: ReadonlyMap<string, IParentLinks>
): Set<string> {
  const others = new Set<string>()
  // The lines that lead to this branch, which are built on top of it.
  const onTop = new Set<string>([tipSha])

  for (const otherSha of tipSHAs) {
    const isMergedIn = reachable.has(otherSha) && !chain.has(otherSha)
    if (otherSha === tipSha || isMergedIn) {
      continue
    }

    const line = new Set<string>()
    let next: string | undefined = otherSha

    while (
      next !== undefined &&
      !others.has(next) &&
      !onTop.has(next) &&
      !line.has(next)
    ) {
      line.add(next)
      next = lookup.get(next)?.parentSHAs[0]
    }

    const known = next !== undefined && onTop.has(next) ? onTop : others
    line.forEach(s => known.add(s))
  }

  return others
}

/**
 * Works out which commits were made on the same branch as a commit, which git
 * doesn't record. For each branch that is the commits from its tip, following
 * the first parent of each, up to where the branch started, which is the first
 * commit that is on the line of another branch too.
 *
 * A commit is on at most one branch this way. Two branches with a commit on
 * their lines would each have to leave the other out to count it, but one that
 * is built on top of the other, or merged into it, still marks where that one
 * started or ended.
 *
 * A branch is skipped when the start of it can't be told, which is when its
 * history runs out of the loaded commits before it meets another branch.
 * Returns null when no branch is left for the commit.
 *
 * The first commit of a shallow clone has no parents as far as git says, so it
 * passes for the start of the history. A branch then counts down to there,
 * which is all that can be seen of it anyway.
 *
 * @param commitSHAs The loaded commits, newest first.
 * @param lookup     The commits by their sha.
 * @param tips       The names of the branches by the sha they point at, which
 *                   mark where a branch started.
 * @param ownerTips  The ones of `tips` that a commit can be made on. Others,
 *                   such as the branches of another remote, only mark where a
 *                   branch started, so as not to count all that they hold.
 */
export function getBranchSegment(
  sha: string,
  commitSHAs: ReadonlyArray<string>,
  lookup: ReadonlyMap<string, IParentLinks>,
  tips: ReadonlyMap<string, ReadonlyArray<string>>,
  ownerTips: ReadonlyMap<string, ReadonlyArray<string>> = tips
): IBranchSegment | null {
  const tipSHAs = commitSHAs.filter(s => tips.has(s))

  for (const tipSha of tipSHAs) {
    if (!ownerTips.has(tipSha)) {
      continue
    }

    // The commits of a branch are on its line, so one that doesn't have the
    // commit there needs no more looking at.
    const chain = getFirstParentChain(tipSha, lookup)
    if (!chain.has(sha)) {
      continue
    }

    const reachable = getReachable(tipSha, lookup)
    const others = getLinesOfOthers(tipSha, tipSHAs, chain, reachable, lookup)

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

    if (startKnown && shas.has(sha)) {
      return { tipSha, branchNames: tips.get(tipSha) ?? [], shas }
    }
  }

  return null
}

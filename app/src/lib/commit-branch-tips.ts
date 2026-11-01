import { Branch, BranchType } from '../models/branch'

/** The names of branches, by the sha of the commit that they point at. */
export type BranchTips = ReadonlyMap<string, ReadonlyArray<string>>

function addTip(tips: Map<string, string[]>, branch: Branch) {
  const names = tips.get(branch.tip.sha) ?? []
  names.push(branch.name)
  tips.set(branch.tip.sha, names)
}

/**
 * The names of the branches by the sha of the commit they point at. A remote
 * branch is left out when a local one of the same name is there already.
 */
export function getBranchTips(branches: ReadonlyArray<Branch>): BranchTips {
  const localNames = new Set(
    branches.filter(b => b.type === BranchType.Local).map(b => b.name)
  )
  const tips = new Map<string, string[]>()

  for (const branch of branches) {
    if (
      branch.isDesktopForkRemoteBranch ||
      (branch.type === BranchType.Remote &&
        localNames.has(branch.nameWithoutRemote))
    ) {
      continue
    }

    addTip(tips, branch)
  }

  return tips
}

/**
 * The same for the local branches only. The commits of a branch are only
 * worked out for these, as the branches of other remotes would take in the
 * whole history of what they were forked from.
 */
export function getLocalBranchTips(
  branches: ReadonlyArray<Branch>
): BranchTips {
  const tips = new Map<string, string[]>()

  for (const branch of branches) {
    if (branch.type === BranchType.Local) {
      addTip(tips, branch)
    }
  }

  return tips
}

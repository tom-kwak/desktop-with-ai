import { createHash } from 'crypto'
import { stat } from 'fs/promises'
import { join } from 'path'
import { Repository } from '../../models/repository'
import { Commit } from '../../models/commit'
import {
  IAIAnalysisInput,
  IReviewedCommit,
  MaxDiffCharacters,
} from '../ai/ai-analysis'
import { git } from './core'
import { getCommits } from './log'

/** Most commits listed when reviewing a whole branch. */
const MaxBranchCommits = 200

function toReviewedCommit(c: Commit): IReviewedCommit {
  return {
    sha: c.sha,
    shortSha: c.shortSha,
    summary: c.summary,
    body: c.body.trim(),
  }
}

function formatCommitLog(commits: ReadonlyArray<Commit>): string {
  return commits
    .map(c =>
      [
        `commit ${c.sha}`,
        `Author: ${c.author.name} <${c.author.email}>`,
        `Date: ${c.author.date.toISOString()}`,
        '',
        c.summary,
        c.body.trim(),
      ]
        .filter(line => line !== '')
        .join('\n')
    )
    .join('\n\n')
}

/**
 * Builds the commit log and patch text sent to the AI review for the given
 * commits (ordered as selected in the history list).
 */
export async function getAIAnalysisInput(
  repository: Repository,
  commits: ReadonlyArray<Commit>
): Promise<IAIAnalysisInput> {
  // One at a time, and only until the agent has as much as it will be sent.
  const patches: string[] = []
  let length = 0

  for (const c of commits) {
    if (length >= MaxDiffCharacters) {
      const omitted = commits.length - patches.length
      patches.push(`# ${omitted} more commits not included`)
      break
    }

    // `--format=` suppresses the header; metadata is already in the log.
    const { stdout } = await git(
      [
        'show',
        '--no-ext-diff',
        '--no-color',
        '--format=',
        '--patch',
        '--stat',
        '-M',
        c.sha,
        '--',
      ],
      repository.path,
      'getAIAnalysisInput'
    )
    patches.push(`# ${c.shortSha}\n${stdout}`)
    length += stdout.length
  }

  return {
    log: formatCommitLog(commits),
    diff: patches.join('\n'),
    commits: commits.map(toReviewedCommit),
  }
}

/** Whether `ref` resolves to a commit in the repository. */
async function refExists(repository: Repository, ref: string) {
  const { exitCode } = await git(
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
    repository.path,
    'refExists',
    { successExitCodes: new Set([0, 1]) }
  )
  return exitCode === 0
}

/**
 * Best guess at the branch the current one should be reviewed against: the
 * remote's default branch, else a common default name that exists locally.
 */
export async function getDefaultReviewBaseRef(
  repository: Repository
): Promise<string> {
  const { stdout, exitCode } = await git(
    ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    repository.path,
    'getDefaultReviewBaseRef',
    { successExitCodes: new Set([0, 1, 128]) }
  )
  const remoteDefault = stdout.trim()
  if (exitCode === 0 && remoteDefault !== '') {
    return remoteDefault
  }

  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    if (await refExists(repository, candidate)) {
      return candidate
    }
  }

  return ''
}

/** The checked-out branch's name, or `HEAD` when detached. */
export async function getCurrentBranchName(
  repository: Repository
): Promise<string> {
  const { stdout } = await git(
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    repository.path,
    'getCurrentBranchName'
  )
  return stdout.trim() || 'HEAD'
}

export interface IBranchReviewOptions {
  /** The branch or ref the current branch is compared against. */
  readonly baseRef: string
  /** Also include tracked files with uncommitted changes. */
  readonly includeUncommitted: boolean
}

/**
 * Builds the review input for everything the current branch changes
 * compared to `baseRef` (the commits since their merge base, like a pull
 * request), optionally together with uncommitted changes to tracked files.
 */
export async function getBranchAnalysisInput(
  repository: Repository,
  { baseRef, includeUncommitted }: IBranchReviewOptions
): Promise<IAIAnalysisInput> {
  if (baseRef.trim() === '' || !(await refExists(repository, baseRef))) {
    throw new Error(
      `Base branch '${baseRef}' was not found in this repository.`
    )
  }

  // For `git log`, `A..B` lists the commits only on the branch, while `A...B`
  // would also list the ones only on the base. For `git diff` it is the
  // opposite: `A...B` diffs against the merge base, like a pull request does.
  const commits = await getCommits(
    repository,
    `${baseRef}..HEAD`,
    MaxBranchCommits
  )
  const range = `${baseRef}...HEAD`

  const diffArgs = ['--no-ext-diff', '--no-color', '--patch', '--stat', '-M']
  const [branchDiff, uncommittedDiff] = await Promise.all([
    git(
      ['diff', ...diffArgs, range, '--'],
      repository.path,
      'getBranchAnalysisInput'
    ),
    includeUncommitted
      ? git(
          ['diff', ...diffArgs, 'HEAD', '--'],
          repository.path,
          'getBranchAnalysisInput'
        )
      : null,
  ])

  const sections = [
    branchDiff.stdout.trim() === ''
      ? ''
      : `# Changes on the branch compared to ${baseRef}\n${branchDiff.stdout}`,
    uncommittedDiff === null || uncommittedDiff.stdout.trim() === ''
      ? ''
      : `# Uncommitted changes to tracked files\n${uncommittedDiff.stdout}`,
  ].filter(section => section !== '')

  if (sections.length === 0) {
    throw new Error(`There are no changes compared to '${baseRef}'.`)
  }

  const log =
    commits.length > 0
      ? formatCommitLog(commits)
      : `(no commits ahead of ${baseRef})`

  return {
    log,
    diff: sections.join('\n'),
    commits: commits.map(toReviewedCommit),
    branch: { name: await getCurrentBranchName(repository), baseRef },
  }
}

/**
 * Fingerprint of the repository's files: the checked-out commit, the changes
 * to tracked files and the untracked files. Reviews that may read the
 * repository are only reused while this stays the same.
 *
 * Untracked files are compared by size and modification time rather than by
 * content, which keeps this fast however large they are. Ignored files aren't
 * part of it.
 */
export async function getRepositoryStateKey(
  repository: Repository
): Promise<string> {
  // An unborn HEAD makes some of these fail; that just means nothing to hash.
  const run = (args: string[]) =>
    git(args, repository.path, 'getRepositoryStateKey', {
      successExitCodes: new Set([0, 1, 128]),
    })

  const [head, changes, untracked] = await Promise.all([
    run(['rev-parse', '--verify', '--quiet', 'HEAD']),
    run(['diff', '--no-ext-diff', '--no-color', 'HEAD', '--']),
    run(['ls-files', '--others', '--exclude-standard', '-z']),
  ])

  const untrackedFiles = await Promise.all(
    untracked.stdout
      .split('\0')
      .filter(path => path !== '')
      .map(async path => {
        try {
          const { size, mtimeMs } = await stat(join(repository.path, path))
          return [path, size, mtimeMs]
        } catch {
          // Removed since it was listed.
          return [path]
        }
      })
  )

  return createHash('sha256')
    .update(JSON.stringify([head.stdout, changes.stdout, untrackedFiles]))
    .digest('hex')
}

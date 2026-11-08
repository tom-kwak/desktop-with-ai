import * as React from 'react'
import { Disposable } from 'event-kit'
import { ToolbarButton } from '../toolbar'
import * as octicons from '../octicons/octicons.generated'
import { DialogStackContext } from '../dialog'
import { Repository } from '../../models/repository'
import { IRemote } from '../../models/remote'
import { getRemotes } from '../../lib/git/remote'
import {
  getGitLabAccountsStore,
  getGitLabSettings,
} from '../../lib/gitlab/gitlab-accounts'
import { IGitLabAccount } from '../../lib/gitlab/gitlab-accounts-store'
import {
  IGitLabRemoteMatch,
  matchGitLabRemote,
} from '../../lib/gitlab/gitlab-remote'
import { GitLabMergeRequestsDialog } from './gitlab-merge-requests-dialog'
import { CIStatusIcon } from './gitlab-mr-common'
import { fetchProjectInfo } from '../../lib/gitlab/gitlab-merge-requests'
import {
  IGitLabPipelineInfo,
  fetchLatestBranchPipeline,
  isActiveStatus,
} from '../../lib/gitlab/gitlab-pipelines'

/** Find the GitLab project of a repository, preferring the `origin` remote. */
export function findGitLabRemote(
  remotes: ReadonlyArray<IRemote>,
  accounts: ReadonlyArray<IGitLabAccount>
): IGitLabRemoteMatch | null {
  const ordered = [
    ...remotes.filter(r => r.name === 'origin'),
    ...remotes.filter(r => r.name !== 'origin'),
  ]
  for (const remote of ordered) {
    const match = matchGitLabRemote(remote.url, accounts)
    if (match !== null) {
      return match
    }
  }
  return null
}

interface IGitLabMergeRequestsToolbarButtonProps {
  readonly repository: Repository
  /** The checked-out branch, whose latest pipeline the button shows. */
  readonly branchName: string | null
}

interface IGitLabMergeRequestsToolbarButtonState {
  readonly match: IGitLabRemoteMatch | null
  readonly dialogOpen: boolean
  /** The current branch's latest pipeline; null if none or unknown. */
  readonly pipeline: IGitLabPipelineInfo | null
}

/** Refresh the branch pipeline this often, faster while it runs. */
const IdlePipelineRefresh = 60 * 1000
const ActivePipelineRefresh = 10 * 1000

/**
 * The toolbar button, next to Push/Publish, that opens the repository's
 * GitLab merge requests. Renders nothing unless GitLab features are switched
 * on and a remote points at a project on a signed-in GitLab server, so
 * GitHub and other repositories keep the usual toolbar.
 */
export class GitLabMergeRequestsToolbarButton extends React.Component<
  IGitLabMergeRequestsToolbarButtonProps,
  IGitLabMergeRequestsToolbarButtonState
> {
  private subscriptions = new Array<Disposable>()
  private mounted = false
  /** Ignores an older remote lookup that finishes after a newer one. */
  private lookup = 0
  private pipelineTimer: number | undefined = undefined
  /** The project id for the matched path, to avoid looking it up again. */
  private project: { readonly path: string; readonly id: number } | null = null

  public constructor(props: IGitLabMergeRequestsToolbarButtonProps) {
    super(props)
    this.state = { match: null, dialogOpen: false, pipeline: null }
  }

  public componentDidMount() {
    this.mounted = true
    this.subscriptions.push(
      getGitLabSettings().onDidChange(this.updateMatch),
      getGitLabAccountsStore().onDidUpdate(this.updateMatch)
    )
    this.updateMatch()
  }

  public componentDidUpdate(prevProps: IGitLabMergeRequestsToolbarButtonProps) {
    if (prevProps.repository.path !== this.props.repository.path) {
      this.setState({ dialogOpen: false, pipeline: null })
      this.updateMatch()
    } else if (prevProps.branchName !== this.props.branchName) {
      this.setState({ pipeline: null })
      this.refreshPipeline()
    }
  }

  public componentWillUnmount() {
    this.mounted = false
    window.clearTimeout(this.pipelineTimer)
    this.subscriptions.forEach(s => s.dispose())
    this.subscriptions = []
  }

  private updateMatch = async () => {
    const lookup = ++this.lookup
    const accounts = getGitLabAccountsStore().getAll()
    if (!getGitLabSettings().isEnabled() || accounts.length === 0) {
      this.setState({ match: null })
      return
    }

    try {
      const remotes = await getRemotes(this.props.repository)
      if (this.mounted && lookup === this.lookup) {
        this.setState({ match: findGitLabRemote(remotes, accounts) }, () =>
          this.refreshPipeline()
        )
      }
    } catch (e) {
      log.warn('[GitLab] could not read remotes', e)
      if (this.mounted && lookup === this.lookup) {
        this.setState({ match: null })
      }
    }
  }

  /**
   * Load the current branch's latest pipeline and schedule the next look.
   * Failures only hide the status; the button keeps working.
   */
  private refreshPipeline = async () => {
    window.clearTimeout(this.pipelineTimer)
    const { match } = this.state
    const branch = this.props.branchName
    if (match === null || branch === null) {
      this.setState({ pipeline: null })
      return
    }

    let pipeline: IGitLabPipelineInfo | null = null
    try {
      const token = await getGitLabAccountsStore().getToken(match.account)
      if (token === null) {
        return
      }
      const connection = { serverURL: match.account.serverURL, token }
      if (this.project?.path !== match.projectPath) {
        const info = await fetchProjectInfo(connection, match.projectPath)
        this.project = { path: match.projectPath, id: info.id }
      }
      pipeline = await fetchLatestBranchPipeline(
        connection,
        this.project.id,
        branch
      )
    } catch (e) {
      log.debug('[GitLab] could not load the branch pipeline', e)
    }

    if (
      !this.mounted ||
      this.state.match !== match ||
      this.props.branchName !== branch
    ) {
      return
    }
    this.setState({ pipeline })
    this.pipelineTimer = window.setTimeout(
      this.refreshPipeline,
      pipeline !== null && isActiveStatus(pipeline.status)
        ? ActivePipelineRefresh
        : IdlePipelineRefresh
    )
  }

  private open = () => this.setState({ dialogOpen: true })
  private close = () => {
    this.setState({ dialogOpen: false })
    // Actions in the window may have started or retried pipelines.
    this.refreshPipeline()
  }

  private renderDescription(match: IGitLabRemoteMatch) {
    const { pipeline } = this.state
    if (pipeline === null) {
      return `GitLab · ${match.projectPath}`
    }
    return (
      <span className="gitlab-toolbar-pipeline">
        <CIStatusIcon status={pipeline.status} />
        CI {pipeline.status.replace(/_/g, ' ')} · {match.projectPath}
      </span>
    )
  }

  public render() {
    const { match, dialogOpen } = this.state
    if (match === null) {
      return null
    }

    return (
      <>
        <ToolbarButton
          className="gitlab-merge-requests-button"
          title={__DARWIN__ ? 'Merge Requests' : 'Merge requests'}
          description={this.renderDescription(match)}
          tooltip={`GitLab merge requests for ${match.projectPath}`}
          icon={octicons.gitPullRequest}
          onClick={this.open}
        />
        {dialogOpen && (
          // Not part of the app's popup stack, so the dialog declares itself
          // top-most for `Dialog` to call `showModal()`.
          <DialogStackContext.Provider value={{ isTopMost: true }}>
            <GitLabMergeRequestsDialog
              repository={this.props.repository}
              match={match}
              onDismissed={this.close}
            />
          </DialogStackContext.Provider>
        )}
      </>
    )
  }
}

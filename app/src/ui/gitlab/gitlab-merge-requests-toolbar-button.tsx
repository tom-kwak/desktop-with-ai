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
}

interface IGitLabMergeRequestsToolbarButtonState {
  readonly match: IGitLabRemoteMatch | null
  readonly dialogOpen: boolean
}

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

  public constructor(props: IGitLabMergeRequestsToolbarButtonProps) {
    super(props)
    this.state = { match: null, dialogOpen: false }
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
      this.setState({ dialogOpen: false })
      this.updateMatch()
    }
  }

  public componentWillUnmount() {
    this.mounted = false
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
        this.setState({ match: findGitLabRemote(remotes, accounts) })
      }
    } catch (e) {
      log.warn('[GitLab] could not read remotes', e)
      if (this.mounted && lookup === this.lookup) {
        this.setState({ match: null })
      }
    }
  }

  private open = () => this.setState({ dialogOpen: true })
  private close = () => this.setState({ dialogOpen: false })

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
          description={`GitLab · ${match.projectPath}`}
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

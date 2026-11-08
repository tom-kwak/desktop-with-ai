import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Button } from '../lib/button'
import { Loading } from '../lib/loading'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { openExternal } from '../main-process-proxy'
import { Repository } from '../../models/repository'
import { getCurrentBranchName } from '../../lib/git/ai-analysis-input'
import { IGitLabRemoteMatch } from '../../lib/gitlab/gitlab-remote'
import { getGitLabAccountsStore } from '../../lib/gitlab/gitlab-accounts'
import {
  IGitLabMergeRequest,
  fetchProjectInfo,
} from '../../lib/gitlab/gitlab-merge-requests'
import { IGitLabMRContext, errorMessage } from './gitlab-mr-common'
import { ICreateMergeRequestProblem } from '../../lib/gitlab/gitlab-mr-create-checks'
import { GitLabMRList } from './gitlab-mr-list'
import { GitLabMRCreate } from './gitlab-mr-create'
import { GitLabMRDetail } from './gitlab-mr-detail'

interface IGitLabMergeRequestsDialogProps {
  readonly repository: Repository
  readonly match: IGitLabRemoteMatch
  readonly onDismissed: () => void
}

type View =
  | { readonly kind: 'list' }
  | { readonly kind: 'create'; readonly sourceBranch: string }
  | { readonly kind: 'detail'; readonly mergeRequest: IGitLabMergeRequest }

interface IGitLabMergeRequestsDialogState {
  readonly context: IGitLabMRContext | null
  readonly loadError: string | null
  readonly view: View
  readonly creating: boolean
  /** What keeps the new merge request from being created, if anything. */
  readonly createProblem: ICreateMergeRequestProblem | null
  /** Bumped to make the list reload when coming back to it. */
  readonly listVersion: number
}

/**
 * Merge requests of the GitLab project a repository's remote points at:
 * browsing, creating, reviewing and merging them.
 */
export class GitLabMergeRequestsDialog extends React.Component<
  IGitLabMergeRequestsDialogProps,
  IGitLabMergeRequestsDialogState
> {
  private mounted = false
  private createForm: GitLabMRCreate | null = null

  public constructor(props: IGitLabMergeRequestsDialogProps) {
    super(props)
    this.state = {
      context: null,
      loadError: null,
      view: { kind: 'list' },
      creating: false,
      createProblem: null,
      listVersion: 0,
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.load()
  }

  public componentWillUnmount() {
    this.mounted = false
  }

  private async load() {
    const { match, repository } = this.props
    this.setState({ loadError: null })
    try {
      const token = await getGitLabAccountsStore().getToken(match.account)
      if (token === null) {
        throw new Error(
          `The token for ${match.account.serverURL} is missing from the keychain. Sign in again in Preferences > Accounts.`
        )
      }
      const connection = { serverURL: match.account.serverURL, token }
      const [project, branch] = await Promise.all([
        fetchProjectInfo(connection, match.projectPath),
        getCurrentBranchName(repository),
      ])
      if (this.mounted) {
        this.setState({
          context: {
            repository,
            connection,
            project,
            account: match.account,
            currentBranch: branch === 'HEAD' ? null : branch,
          },
        })
      }
    } catch (e) {
      if (this.mounted) {
        this.setState({ loadError: errorMessage(e) })
      }
    }
  }

  private retry = () => this.load()

  private showList = () =>
    this.setState(s => ({
      view: { kind: 'list' },
      listVersion: s.listVersion + 1,
    }))

  private showCreate = () => {
    const branch = this.state.context?.currentBranch
    if (branch != null) {
      this.setState({
        view: { kind: 'create', sourceBranch: branch },
        createProblem: null,
      })
    }
  }

  private showDetail = (mergeRequest: IGitLabMergeRequest) =>
    this.setState({ view: { kind: 'detail', mergeRequest } })

  private onChanged = () => undefined

  private onCreatingChanged = (creating: boolean) => this.setState({ creating })

  private onCreateProblemChanged = (
    createProblem: ICreateMergeRequestProblem | null
  ) => this.setState({ createProblem })

  private onCreateFormRef = (form: GitLabMRCreate | null) => {
    this.createForm = form
  }

  private onSubmit = () => {
    if (this.state.view.kind === 'create') {
      this.createForm?.submit()
    }
  }

  private openProject = () => {
    const url = this.state.context?.project.webURL
    if (url !== undefined) {
      openExternal(url)
    }
  }

  public render() {
    return (
      <Dialog
        id="gitlab-merge-requests"
        className="gitlab-ui"
        title={this.renderTitle()}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={this.state.creating}
      >
        <DialogContent>{this.renderBody()}</DialogContent>
        {this.renderFooter()}
      </Dialog>
    )
  }

  private renderTitle() {
    const { view } = this.state
    const path = this.props.match.projectPath
    return (
      <span className="gl-dialog-title">
        <span className="gl-brand">GitLab</span>
        {view.kind === 'list' ? (
          <span className="gl-crumb-current">{path}</span>
        ) : (
          <>
            <button type="button" className="gl-crumb" onClick={this.showList}>
              {path}
            </button>
            <span className="gl-crumb-sep">/</span>
            <span className="gl-crumb-current">
              {view.kind === 'create'
                ? 'New merge request'
                : `!${view.mergeRequest.iid}`}
            </span>
          </>
        )}
      </span>
    )
  }

  private renderBody() {
    const { context, loadError, view, listVersion } = this.state

    if (loadError !== null) {
      return (
        <div className="gl-empty">
          <Octicon symbol={octicons.alert} />
          <p>{loadError}</p>
          <Button onClick={this.retry}>Try again</Button>
        </div>
      )
    }

    if (context === null) {
      return (
        <div className="gl-empty">
          <Loading /> Connecting to {this.props.match.account.serverURL}…
        </div>
      )
    }

    switch (view.kind) {
      case 'list':
        return (
          <GitLabMRList
            key={listVersion}
            context={context}
            onOpen={this.showDetail}
            onCreate={this.showCreate}
          />
        )
      case 'create':
        return (
          <GitLabMRCreate
            ref={this.onCreateFormRef}
            context={context}
            sourceBranch={view.sourceBranch}
            onBusyChanged={this.onCreatingChanged}
            onCreated={this.showDetail}
            onProblemChanged={this.onCreateProblemChanged}
            onOpenExisting={this.showDetail}
          />
        )
      case 'detail':
        return (
          <GitLabMRDetail
            key={view.mergeRequest.iid}
            context={context}
            mergeRequest={view.mergeRequest}
            onChanged={this.onChanged}
          />
        )
    }
  }

  private renderFooter() {
    const { view, creating, context, createProblem } = this.state
    const blocked = createProblem !== null && createProblem.blocking
    return (
      <DialogFooter>
        <div className="gl-footer">
          {view.kind !== 'list' && (
            <Button onClick={this.showList} disabled={creating}>
              <Octicon symbol={octicons.arrowLeft} /> All merge requests
            </Button>
          )}
          {view.kind === 'list' && context !== null && (
            <Button onClick={this.openProject}>
              Open project in GitLab <Octicon symbol={octicons.linkExternal} />
            </Button>
          )}
          <span className="gl-footer-spacer" />
          {view.kind === 'create' && createProblem !== null && (
            <span
              className={blocked ? 'gl-footer-problem' : 'gl-footer-warning'}
            >
              <Octicon symbol={octicons.alert} />
              {createProblem.message}
            </span>
          )}
          {view.kind === 'create' ? (
            <Button
              type="submit"
              className="gl-primary"
              disabled={creating || blocked}
            >
              {creating ? 'Creating…' : 'Create merge request'}
            </Button>
          ) : (
            <Button onClick={this.props.onDismissed}>Close</Button>
          )}
        </div>
      </DialogFooter>
    )
  }
}

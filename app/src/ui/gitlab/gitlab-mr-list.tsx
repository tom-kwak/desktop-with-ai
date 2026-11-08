import * as React from 'react'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import { TextBox } from '../lib/text-box'
import { Loading } from '../lib/loading'
import { RelativeTime } from '../relative-time'
import {
  GitLabMergeRequestState,
  IGitLabMergeRequest,
  IGitLabMergeRequestFilter,
  fetchMergeRequests,
} from '../../lib/gitlab/gitlab-merge-requests'
import {
  IGitLabPipelineInfo,
  fetchRecentPipelines,
  isActiveStatus,
  latestPipelineBySha,
} from '../../lib/gitlab/gitlab-pipelines'
import {
  CIStatusIcon,
  IGitLabMRContext,
  MRStatePill,
  UserAvatar,
  errorMessage,
} from './gitlab-mr-common'

type Scope = 'all' | 'mine' | 'review'

/** A short CI label for the list, e.g. "Passed" or "Running". */
function pipelineLabel(status: string) {
  switch (status) {
    case 'success':
      return 'Passed'
    case 'failed':
      return 'Failed'
    case 'canceled':
    case 'canceling':
      return 'Canceled'
    case 'manual':
      return 'Manual'
    case 'skipped':
      return 'Skipped'
    case 'running':
      return 'Running'
    default:
      return 'Pending'
  }
}

const states: ReadonlyArray<[GitLabMergeRequestState, string]> = [
  ['opened', 'Open'],
  ['merged', 'Merged'],
  ['closed', 'Closed'],
  ['all', 'All'],
]

const scopes: ReadonlyArray<[Scope, string]> = [
  ['all', 'Everyone'],
  ['mine', 'Created by me'],
  ['review', 'Review requested'],
]

interface IGitLabMRListProps {
  readonly context: IGitLabMRContext
  readonly onOpen: (mr: IGitLabMergeRequest) => void
  readonly onCreate: () => void
}

interface IGitLabMRListState {
  readonly state: GitLabMergeRequestState
  readonly scope: Scope
  readonly search: string
  readonly items: ReadonlyArray<IGitLabMergeRequest> | null
  /** Open merge requests of the current branch, whatever the filters say. */
  readonly currentBranchMR: IGitLabMergeRequest | null | undefined
  readonly error: string | null
  /** Latest pipeline per head commit, for the status next to each MR. */
  readonly pipelines: ReadonlyMap<string, IGitLabPipelineInfo>
}

/** Refresh pipeline statuses this often while any shown one is running. */
const ActivePipelineRefresh = 10 * 1000

/** The merge requests of the project, filtered like GitLab's MR page. */
export class GitLabMRList extends React.Component<
  IGitLabMRListProps,
  IGitLabMRListState
> {
  private mounted = false
  private requestId = 0
  private pipelineTimer: number | undefined = undefined

  public constructor(props: IGitLabMRListProps) {
    super(props)
    this.state = {
      state: 'opened',
      scope: 'all',
      search: '',
      items: null,
      currentBranchMR: undefined,
      error: null,
      pipelines: new Map(),
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.load()
    this.loadCurrentBranchMR()
  }

  public componentWillUnmount() {
    this.mounted = false
    window.clearTimeout(this.pipelineTimer)
  }

  /**
   * Load pipeline statuses for the list. Without them the list still works,
   * so failures (e.g. no CI permission) only hide the icons.
   */
  private loadPipelines = async () => {
    window.clearTimeout(this.pipelineTimer)
    const { connection, project } = this.props.context
    try {
      const pipelines = latestPipelineBySha(
        await fetchRecentPipelines(connection, project.id)
      )
      if (!this.mounted) {
        return
      }
      this.setState({ pipelines })
      const running = (this.state.items ?? []).some(mr => {
        const p = mr.headSha !== null ? pipelines.get(mr.headSha) : undefined
        return p !== undefined && isActiveStatus(p.status)
      })
      if (running) {
        this.pipelineTimer = window.setTimeout(
          this.loadPipelines,
          ActivePipelineRefresh
        )
      }
    } catch (e) {
      log.debug('[GitLab] could not load pipelines for the list', e)
    }
  }

  private filter(): IGitLabMergeRequestFilter {
    const { username } = this.props.context.account
    switch (this.state.scope) {
      case 'mine':
        return { authorUsername: username }
      case 'review':
        return { reviewerUsername: username }
      case 'all':
        return {}
    }
  }

  private async load() {
    const { connection, project } = this.props.context
    const id = ++this.requestId
    this.setState({ items: null, error: null })
    try {
      const items = await fetchMergeRequests(
        connection,
        project.id,
        this.state.state,
        this.filter()
      )
      if (this.mounted && id === this.requestId) {
        this.setState({ items }, this.loadPipelines)
      }
    } catch (e) {
      if (this.mounted && id === this.requestId) {
        this.setState({ error: errorMessage(e) })
      }
    }
  }

  private async loadCurrentBranchMR() {
    const { connection, project, currentBranch } = this.props.context
    if (currentBranch === null) {
      this.setState({ currentBranchMR: null })
      return
    }
    try {
      const open = await fetchMergeRequests(connection, project.id, 'opened')
      if (this.mounted) {
        this.setState({
          currentBranchMR:
            open.find(m => m.sourceBranch === currentBranch) ?? null,
        })
      }
    } catch {
      if (this.mounted) {
        this.setState({ currentBranchMR: null })
      }
    }
  }

  private refresh = () => {
    this.load()
    this.loadCurrentBranchMR()
  }

  private setFilterState = (state: GitLabMergeRequestState) => () =>
    this.setState({ state }, () => this.load())

  private setScope = (scope: Scope) => () =>
    this.setState({ scope }, () => this.load())

  private onSearchChanged = (search: string) => this.setState({ search })

  private open = (mr: IGitLabMergeRequest) => () => this.props.onOpen(mr)

  public render() {
    return (
      <div className="gl-mr-list">
        {this.renderCurrentBranch()}
        <div className="gl-toolbar">
          <div className="gl-segmented" role="tablist" aria-label="State">
            {states.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={this.state.state === value}
                className={classNames({ selected: this.state.state === value })}
                onClick={this.setFilterState(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <Button onClick={this.refresh} size="small" tooltip="Refresh">
            <Octicon symbol={octicons.sync} />
          </Button>
        </div>
        <div className="gl-toolbar">
          <div className="gl-chips" role="group" aria-label="Show">
            {scopes.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={this.state.scope === value}
                className={classNames('gl-chip', {
                  selected: this.state.scope === value,
                })}
                onClick={this.setScope(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <TextBox
            className="gl-search"
            placeholder="Filter by title, branch or author"
            value={this.state.search}
            onValueChanged={this.onSearchChanged}
            type="search"
          />
        </div>
        {this.renderItems()}
      </div>
    )
  }

  private renderCurrentBranch() {
    const { currentBranch } = this.props.context
    const { currentBranchMR } = this.state
    if (currentBranch === null || currentBranchMR === undefined) {
      return null
    }

    if (currentBranchMR === null) {
      return (
        <div className="gl-callout">
          <Octicon symbol={octicons.gitPullRequest} />
          <div className="gl-callout-text">
            <strong>Ready to share your work?</strong>
            <span>
              <code>{currentBranch}</code> has no open merge request.
            </span>
          </div>
          <Button className="gl-primary" onClick={this.props.onCreate}>
            Create merge request
          </Button>
        </div>
      )
    }

    return (
      <div className="gl-callout">
        <Octicon symbol={octicons.gitPullRequest} />
        <div className="gl-callout-text">
          <strong>
            !{currentBranchMR.iid} {currentBranchMR.title}
          </strong>
          <span>
            Your branch <code>{currentBranch}</code> is in this merge request.
          </span>
        </div>
        <Button onClick={this.open(currentBranchMR)}>View</Button>
      </div>
    )
  }

  private renderPipeline(mr: IGitLabMergeRequest) {
    const pipeline =
      mr.headSha !== null ? this.state.pipelines.get(mr.headSha) : undefined
    if (pipeline === undefined) {
      return null
    }
    return (
      <span className="gl-mr-pipeline">
        <CIStatusIcon status={pipeline.status} />
        <span className="gl-mr-pipeline-label">
          {pipelineLabel(pipeline.status)}
        </span>
      </span>
    )
  }

  private renderItems() {
    const { items, error, search } = this.state

    if (error !== null) {
      return (
        <div className="gl-empty">
          <Octicon symbol={octicons.alert} />
          <p>{error}</p>
          <Button onClick={this.refresh}>Try again</Button>
        </div>
      )
    }

    if (items === null) {
      return (
        <div className="gl-empty">
          <Loading /> Loading merge requests…
        </div>
      )
    }

    const query = search.trim().toLowerCase()
    const shown =
      query.length === 0
        ? items
        : items.filter(mr =>
            [
              mr.title,
              `!${mr.iid}`,
              mr.sourceBranch,
              mr.targetBranch,
              mr.author?.username ?? '',
              mr.author?.name ?? '',
            ].some(text => text.toLowerCase().includes(query))
          )

    if (shown.length === 0) {
      return (
        <div className="gl-empty">
          <Octicon symbol={octicons.gitPullRequest} />
          <p>
            {query.length > 0
              ? 'No merge requests match your filter.'
              : 'No merge requests here.'}
          </p>
        </div>
      )
    }

    const { currentBranch } = this.props.context
    return (
      <ul className="gl-mr-items">
        {shown.map(mr => (
          <li key={mr.iid}>
            <button
              type="button"
              className="gl-mr-item"
              onClick={this.open(mr)}
            >
              <MRStatePill mr={mr} />
              <span className="gl-mr-item-main">
                <span className="gl-mr-item-title">{mr.title}</span>
                <span className="gl-meta">
                  !{mr.iid} · <code>{mr.sourceBranch}</code> →{' '}
                  <code>{mr.targetBranch}</code>
                  {mr.sourceBranch === currentBranch && (
                    <span className="gl-tag">current branch</span>
                  )}
                </span>
              </span>
              <span className="gl-mr-item-side">
                {this.renderPipeline(mr)}
                {mr.author !== null && (
                  <UserAvatar user={mr.author} size="small" />
                )}
                {mr.userNotesCount > 0 && (
                  <span className="gl-count">
                    <Octicon symbol={octicons.comment} />
                    {mr.userNotesCount}
                    <span className="sr-only"> comments</span>
                  </span>
                )}
                {mr.updatedAt !== '' && (
                  <span className="gl-meta">
                    <RelativeTime date={new Date(mr.updatedAt)} />
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    )
  }
}

import * as React from 'react'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import { Loading } from '../lib/loading'
import { RelativeTime } from '../relative-time'
import { openExternal } from '../main-process-proxy'
import {
  IGitLabJob,
  IGitLabPipelineInfo,
  fetchJobLog,
  fetchMergeRequestPipelines,
  fetchPipeline,
  fetchPipelineJobs,
  formatDuration,
  groupJobsByStage,
  isActiveStatus,
  runJobAction,
  runPipelineAction,
} from '../../lib/gitlab/gitlab-pipelines'
import {
  CIStatusIcon,
  ErrorBanner,
  IGitLabMRContext,
  errorMessage,
} from './gitlab-mr-common'

/** How often to refresh a pipeline that's still running. */
const ActiveRefreshInterval = 5000

interface IGitLabMRPipelinesProps {
  readonly context: IGitLabMRContext
  readonly iid: number
  /** Called when the latest pipeline's status changes. */
  readonly onPipelineChanged?: () => void
}

interface IJobLog {
  readonly jobId: number
  readonly text: string | null
  readonly truncated: boolean
  readonly error: string | null
}

interface IGitLabMRPipelinesState {
  readonly pipelines: ReadonlyArray<IGitLabPipelineInfo> | null
  readonly selectedId: number | null
  readonly pipeline: IGitLabPipelineInfo | null
  readonly jobs: ReadonlyArray<IGitLabJob> | null
  readonly selectedJobId: number | null
  readonly log: IJobLog | null
  readonly busy: boolean
  readonly error: string | null
}

/**
 * The merge request's CI/CD pipelines: stages and jobs like GitLab's
 * pipeline graph, job logs, and retry, cancel and manual-start actions.
 */
export class GitLabMRPipelines extends React.Component<
  IGitLabMRPipelinesProps,
  IGitLabMRPipelinesState
> {
  private mounted = false
  private timer: number | undefined = undefined
  private logEnd: HTMLSpanElement | null = null

  public constructor(props: IGitLabMRPipelinesProps) {
    super(props)
    this.state = {
      pipelines: null,
      selectedId: null,
      pipeline: null,
      jobs: null,
      selectedJobId: null,
      log: null,
      busy: false,
      error: null,
    }
  }

  public componentDidMount() {
    this.mounted = true
    this.loadPipelines()
  }

  public componentWillUnmount() {
    this.mounted = false
    window.clearTimeout(this.timer)
  }

  private get api() {
    const { connection, project } = this.props.context
    return { connection, projectId: project.id }
  }

  private async loadPipelines() {
    const { connection, projectId } = this.api
    try {
      const pipelines = await fetchMergeRequestPipelines(
        connection,
        projectId,
        this.props.iid
      )
      if (!this.mounted) {
        return
      }
      const selectedId =
        this.state.selectedId !== null &&
        pipelines.some(p => p.id === this.state.selectedId)
          ? this.state.selectedId
          : pipelines[0]?.id ?? null
      this.setState({ pipelines, selectedId })
      if (selectedId !== null) {
        await this.loadPipeline(selectedId)
      }
    } catch (e) {
      if (this.mounted) {
        this.setState({ pipelines: [], error: errorMessage(e) })
      }
    }
  }

  private async loadPipeline(id: number) {
    const { connection, projectId } = this.api
    try {
      const [pipeline, jobs] = await Promise.all([
        fetchPipeline(connection, projectId, id),
        fetchPipelineJobs(connection, projectId, id),
      ])
      if (!this.mounted || this.state.selectedId !== id) {
        return
      }
      const before = this.state.pipeline
      this.setState({ pipeline, jobs })
      if (
        before !== null &&
        before.id === pipeline.id &&
        before.status !== pipeline.status
      ) {
        this.props.onPipelineChanged?.()
      }
      const job = jobs.find(j => j.id === this.state.selectedJobId)
      if (job !== undefined && isActiveStatus(job.status)) {
        this.loadLog(job.id)
      }
      this.scheduleRefresh(pipeline, jobs)
    } catch (e) {
      if (this.mounted) {
        this.setState({ error: errorMessage(e) })
      }
    }
  }

  /** Keep refreshing while anything is still running. */
  private scheduleRefresh(
    pipeline: IGitLabPipelineInfo,
    jobs: ReadonlyArray<IGitLabJob>
  ) {
    window.clearTimeout(this.timer)
    const active =
      isActiveStatus(pipeline.status) ||
      jobs.some(j => isActiveStatus(j.status))
    if (active) {
      this.timer = window.setTimeout(
        () => this.loadPipeline(pipeline.id),
        ActiveRefreshInterval
      )
    }
  }

  private async loadLog(jobId: number) {
    const { connection, projectId } = this.api
    try {
      const { text, truncated } = await fetchJobLog(
        connection,
        projectId,
        jobId
      )
      if (this.mounted && this.state.selectedJobId === jobId) {
        this.setState({ log: { jobId, text, truncated, error: null } }, () =>
          this.logEnd?.scrollIntoView({ block: 'nearest' })
        )
      }
    } catch (e) {
      if (this.mounted && this.state.selectedJobId === jobId) {
        this.setState({
          log: { jobId, text: null, truncated: false, error: errorMessage(e) },
        })
      }
    }
  }

  private async run(action: () => Promise<void>) {
    this.setState({ busy: true, error: null })
    try {
      await action()
    } catch (e) {
      if (this.mounted) {
        this.setState({ error: errorMessage(e) })
      }
    }
    if (this.mounted) {
      this.setState({ busy: false })
      if (this.state.selectedId !== null) {
        await this.loadPipeline(this.state.selectedId)
      }
      this.props.onPipelineChanged?.()
    }
  }

  private onSelectPipeline = (event: React.FormEvent<HTMLSelectElement>) => {
    const id = parseInt(event.currentTarget.value, 10)
    window.clearTimeout(this.timer)
    this.setState({
      selectedId: id,
      pipeline: null,
      jobs: null,
      selectedJobId: null,
      log: null,
    })
    this.loadPipeline(id)
  }

  private pipelineAction = (action: 'retry' | 'cancel') => () => {
    const { pipeline } = this.state
    if (pipeline === null) {
      return
    }
    const { connection, projectId } = this.api
    this.run(async () => {
      await runPipelineAction(connection, projectId, pipeline.id, action)
    })
  }

  private jobAction =
    (job: IGitLabJob, action: 'retry' | 'cancel' | 'play') =>
    (event: React.MouseEvent) => {
      event.stopPropagation()
      const { connection, projectId } = this.api
      this.run(async () => {
        const updated = await runJobAction(
          connection,
          projectId,
          job.id,
          action
        )
        // A retry makes a new job; follow it.
        if (this.state.selectedJobId === job.id) {
          this.setState({ selectedJobId: updated.id, log: null })
          this.loadLog(updated.id)
        }
      })
    }

  private selectJob = (job: IGitLabJob) => () => {
    if (this.state.selectedJobId === job.id) {
      this.setState({ selectedJobId: null, log: null })
      return
    }
    this.setState({ selectedJobId: job.id, log: null })
    this.loadLog(job.id)
  }

  private refreshLog = () => {
    if (this.state.selectedJobId !== null) {
      this.loadLog(this.state.selectedJobId)
    }
  }

  private refresh = () => {
    this.setState({ error: null })
    this.loadPipelines()
  }

  private dismissError = () => this.setState({ error: null })

  private open = (url: string) => () => openExternal(url)

  private onLogEndRef = (el: HTMLSpanElement | null) => {
    this.logEnd = el
  }

  public render() {
    const { pipelines, error } = this.state

    if (pipelines === null) {
      return (
        <div className="gl-empty">
          <Loading /> Loading pipelines…
        </div>
      )
    }

    return (
      <div className="gl-pipelines">
        {error !== null && (
          <ErrorBanner message={error} onDismiss={this.dismissError} />
        )}
        {pipelines.length === 0 ? (
          <div className="gl-empty">
            <Octicon symbol={octicons.rocket} />
            <p>
              No pipelines have run for this merge request. Add a{' '}
              <code>.gitlab-ci.yml</code> file to the project to set up CI/CD.
            </p>
            <Button onClick={this.refresh}>Check again</Button>
          </div>
        ) : (
          <>
            {this.renderHeader(pipelines)}
            {this.renderStages()}
            {this.renderLog()}
          </>
        )}
      </div>
    )
  }

  private renderHeader(pipelines: ReadonlyArray<IGitLabPipelineInfo>) {
    const { pipeline, selectedId, busy } = this.state
    const duration = formatDuration(pipeline?.duration ?? null)
    const canRetry =
      pipeline !== null && ['failed', 'canceled'].includes(pipeline.status)
    const canCancel = pipeline !== null && isActiveStatus(pipeline.status)

    return (
      <div className="gl-pipeline-header">
        {pipeline !== null && <CIStatusIcon status={pipeline.status} />}
        <div className="gl-pipeline-title">
          <select
            className="gl-pipeline-select"
            aria-label="Pipeline"
            value={selectedId ?? undefined}
            onChange={this.onSelectPipeline}
          >
            {pipelines.map((p, i) => (
              <option key={p.id} value={p.id}>
                #{p.id} · {p.status}
                {i === 0 ? ' · latest' : ''}
              </option>
            ))}
          </select>
          {pipeline !== null && (
            <span className="gl-meta">
              <code>{pipeline.sha.slice(0, 8)}</code> on{' '}
              <code>{pipeline.ref}</code>
              {pipeline.createdAt !== '' && (
                <>
                  {' · '}
                  <RelativeTime date={new Date(pipeline.createdAt)} />
                </>
              )}
              {duration !== null && ` · took ${duration}`}
            </span>
          )}
        </div>
        {canCancel && (
          <Button
            size="small"
            onClick={this.pipelineAction('cancel')}
            disabled={busy}
          >
            <Octicon symbol={octicons.stop} /> Cancel pipeline
          </Button>
        )}
        {canRetry && (
          <Button
            size="small"
            className="gl-primary"
            onClick={this.pipelineAction('retry')}
            disabled={busy}
          >
            <Octicon symbol={octicons.sync} /> Retry failed jobs
          </Button>
        )}
        <Button
          size="small"
          onClick={this.refresh}
          disabled={busy}
          ariaLabel="Refresh"
          tooltip="Refresh"
        >
          <Octicon symbol={octicons.sync} />
        </Button>
        {pipeline?.webURL != null && (
          <Button
            size="small"
            onClick={this.open(pipeline.webURL)}
            tooltip="Open in GitLab"
            ariaLabel="Open in GitLab"
          >
            <Octicon symbol={octicons.linkExternal} />
          </Button>
        )}
      </div>
    )
  }

  private renderStages() {
    const { jobs } = this.state
    if (jobs === null) {
      return (
        <div className="gl-empty">
          <Loading /> Loading jobs…
        </div>
      )
    }
    if (jobs.length === 0) {
      return <p className="gl-meta">This pipeline has no jobs.</p>
    }

    const stages = groupJobsByStage(jobs)
    return (
      <div className="gl-stages" role="list" aria-label="Stages">
        {stages.map((stage, i) => (
          <React.Fragment key={stage.name}>
            {i > 0 && <span className="gl-stage-link" aria-hidden={true} />}
            <div className="gl-stage" role="listitem">
              <div className="gl-stage-name">
                <CIStatusIcon status={stage.status} />
                {stage.name}
              </div>
              <ul className="gl-jobs">
                {stage.jobs.map(job => this.renderJob(job))}
              </ul>
            </div>
          </React.Fragment>
        ))}
      </div>
    )
  }

  private renderJob(job: IGitLabJob) {
    const { busy, selectedJobId } = this.state
    const duration = formatDuration(job.duration)
    const selected = selectedJobId === job.id
    const action:
      | ['retry' | 'cancel' | 'play', typeof octicons.sync, string]
      | null =
      job.status === 'manual'
        ? ['play', octicons.play, `Run ${job.name}`]
        : isActiveStatus(job.status)
        ? ['cancel', octicons.stop, `Cancel ${job.name}`]
        : ['failed', 'canceled', 'success'].includes(job.status)
        ? ['retry', octicons.sync, `Retry ${job.name}`]
        : null

    return (
      <li key={job.id} className={classNames('gl-job', { selected })}>
        <button
          type="button"
          className="gl-job-main"
          onClick={this.selectJob(job)}
          aria-expanded={selected}
        >
          <CIStatusIcon status={job.status} />
          <span className="gl-job-name">{job.name}</span>
          {job.allowFailure && job.status === 'failed' && (
            <span className="gl-tag">allowed to fail</span>
          )}
          {duration !== null && <span className="gl-meta">{duration}</span>}
        </button>
        {action !== null && (
          <button
            type="button"
            className="gl-job-action"
            onClick={this.jobAction(job, action[0])}
            disabled={busy}
            aria-label={action[2]}
          >
            <Octicon symbol={action[1]} />
          </button>
        )}
      </li>
    )
  }

  private renderLog() {
    const { jobs, selectedJobId, log } = this.state
    const job = jobs?.find(j => j.id === selectedJobId)
    if (job === undefined) {
      return (
        <p className="gl-meta gl-pipeline-hint">Click a job to see its log.</p>
      )
    }

    return (
      <div className="gl-job-log">
        <div className="gl-job-log-header">
          <CIStatusIcon status={job.status} />
          <strong>{job.name}</strong>
          <span className="gl-meta">
            {job.stage} · {job.status.replace(/_/g, ' ')}
          </span>
          <span className="gl-footer-spacer" />
          <Button size="small" onClick={this.refreshLog}>
            <Octicon symbol={octicons.sync} /> Refresh log
          </Button>
          {job.webURL !== null && (
            <Button
              size="small"
              onClick={this.open(job.webURL)}
              ariaLabel="Open job in GitLab"
              tooltip="Open job in GitLab"
            >
              <Octicon symbol={octicons.linkExternal} />
            </Button>
          )}
        </div>
        {log === null || log.jobId !== job.id ? (
          <div className="gl-empty">
            <Loading /> Loading log…
          </div>
        ) : log.error !== null ? (
          <p className="gl-meta gl-job-log-empty">{log.error}</p>
        ) : log.text === null || log.text.trim().length === 0 ? (
          <p className="gl-meta gl-job-log-empty">
            {isActiveStatus(job.status) || job.status === 'manual'
              ? 'This job has not produced any output yet.'
              : 'This job has no log.'}
          </p>
        ) : (
          <pre className="gl-job-log-text">
            {log.truncated && (
              <span className="gl-meta">
                … earlier output omitted. Open the job in GitLab for the full
                log.{'\n'}
              </span>
            )}
            {log.text}
            <span ref={this.onLogEndRef} />
          </pre>
        )}
      </div>
    )
  }
}

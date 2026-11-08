import { isRecord } from '../is-record'
import {
  IGitLabConnection,
  num,
  parseList,
  parseOne,
  request,
  str,
} from './gitlab-merge-requests'

/** A GitLab CI/CD pipeline. */
export interface IGitLabPipelineInfo {
  readonly id: number
  /** e.g. `success`, `failed`, `running`, `pending`, `canceled`, `manual`. */
  readonly status: string
  readonly ref: string
  readonly sha: string
  readonly webURL: string | null
  /** Seconds, once finished. */
  readonly duration: number | null
  readonly createdAt: string
  /** What started it, e.g. `push`, `merge_request_event`, `web`. */
  readonly source: string | null
}

export function parsePipeline(value: unknown): IGitLabPipelineInfo | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    typeof value.status !== 'string'
  ) {
    return null
  }
  return {
    id: value.id,
    status: value.status,
    ref: str(value.ref) ?? '',
    sha: str(value.sha) ?? '',
    webURL: str(value.web_url),
    duration: num(value.duration),
    createdAt: str(value.created_at) ?? '',
    source: str(value.source),
  }
}

/** A job of a pipeline. */
export interface IGitLabJob {
  readonly id: number
  readonly name: string
  readonly stage: string
  /** e.g. `success`, `failed`, `running`, `pending`, `created`, `manual`, `skipped`, `canceled`. */
  readonly status: string
  readonly allowFailure: boolean
  readonly duration: number | null
  readonly webURL: string | null
}

export function parseJob(value: unknown): IGitLabJob | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    typeof value.name !== 'string' ||
    typeof value.status !== 'string'
  ) {
    return null
  }
  return {
    id: value.id,
    name: value.name,
    stage: str(value.stage) ?? 'test',
    status: value.status,
    allowFailure: value.allow_failure === true,
    duration: num(value.duration),
    webURL: str(value.web_url),
  }
}

/** The jobs of one stage, in the order the pipeline defines them. */
export interface IGitLabStage {
  readonly name: string
  readonly jobs: ReadonlyArray<IGitLabJob>
  /** The stage's overall status, worked out from its jobs. */
  readonly status: string
}

/** Statuses in order of what matters most when summarizing a stage. */
const statusPriority = [
  'failed',
  'running',
  'pending',
  'waiting_for_resource',
  'preparing',
  'created',
  'scheduled',
  'manual',
  'canceled',
  'success',
  'skipped',
]

function stageStatus(jobs: ReadonlyArray<IGitLabJob>): string {
  // A failure that's allowed doesn't fail the stage.
  const statuses = jobs.map(j =>
    j.status === 'failed' && j.allowFailure ? 'success' : j.status
  )
  for (const s of statusPriority) {
    if (statuses.includes(s)) {
      return s
    }
  }
  return statuses[0] ?? 'created'
}

/**
 * Group jobs into stages. GitLab lists jobs newest first and doesn't send
 * the stage order, but job ids follow the order of the CI file, so the
 * lowest id of each stage gives the order.
 */
export function groupJobsByStage(
  jobs: ReadonlyArray<IGitLabJob>
): ReadonlyArray<IGitLabStage> {
  const sorted = [...jobs].sort((a, b) => a.id - b.id)
  const stages = new Map<string, Array<IGitLabJob>>()
  for (const job of sorted) {
    const list = stages.get(job.stage) ?? []
    list.push(job)
    stages.set(job.stage, list)
  }
  return Array.from(stages, ([name, stageJobs]) => ({
    name,
    jobs: stageJobs,
    status: stageStatus(stageJobs),
  }))
}

/** The pipelines that ran for a merge request, newest first. */
export async function fetchMergeRequestPipelines(
  connection: IGitLabConnection,
  projectId: number,
  iid: number
): Promise<ReadonlyArray<IGitLabPipelineInfo>> {
  const body = await request(
    connection,
    'GET',
    `/projects/${projectId}/merge_requests/${iid}/pipelines?per_page=20`
  )
  return parseList(body, parsePipeline)
}

/** The newest pipeline of a branch, or null if it has none. */
export async function fetchLatestBranchPipeline(
  connection: IGitLabConnection,
  projectId: number,
  branch: string
): Promise<IGitLabPipelineInfo | null> {
  const query = new URLSearchParams({
    ref: branch,
    per_page: '1',
    order_by: 'id',
    sort: 'desc',
  })
  const body = await request(
    connection,
    'GET',
    `/projects/${projectId}/pipelines?${query}`
  )
  return parseList(body, parsePipeline)[0] ?? null
}

export async function fetchPipeline(
  connection: IGitLabConnection,
  projectId: number,
  pipelineId: number
): Promise<IGitLabPipelineInfo> {
  const body = await request(
    connection,
    'GET',
    `/projects/${projectId}/pipelines/${pipelineId}`
  )
  return parseOne(body, parsePipeline)
}

export async function fetchPipelineJobs(
  connection: IGitLabConnection,
  projectId: number,
  pipelineId: number
): Promise<ReadonlyArray<IGitLabJob>> {
  const body = await request(
    connection,
    'GET',
    `/projects/${projectId}/pipelines/${pipelineId}/jobs?per_page=100&include_retried=false`
  )
  return parseList(body, parseJob)
}

/** Retry the failed jobs of a pipeline, or cancel the running ones. */
export async function runPipelineAction(
  connection: IGitLabConnection,
  projectId: number,
  pipelineId: number,
  action: 'retry' | 'cancel'
): Promise<IGitLabPipelineInfo> {
  const body = await request(
    connection,
    'POST',
    `/projects/${projectId}/pipelines/${pipelineId}/${action}`
  )
  return parseOne(body, parsePipeline)
}

/** Retry, cancel, or start (`play`, for manual jobs) one job. */
export async function runJobAction(
  connection: IGitLabConnection,
  projectId: number,
  jobId: number,
  action: 'retry' | 'cancel' | 'play'
): Promise<IGitLabJob> {
  const body = await request(
    connection,
    'POST',
    `/projects/${projectId}/jobs/${jobId}/${action}`
  )
  return parseOne(body, parseJob)
}

/** The longest log kept in memory; GitLab logs can be many megabytes. */
const MaxLogLength = 200_000

/** A job's log as plain text: the end of it if it's long. */
export async function fetchJobLog(
  connection: IGitLabConnection,
  projectId: number,
  jobId: number
): Promise<{ readonly text: string; readonly truncated: boolean }> {
  const body = await request(
    connection,
    'GET',
    `/projects/${projectId}/jobs/${jobId}/trace`,
    undefined,
    true
  )
  const text = cleanJobLog(typeof body === 'string' ? body : '')
  return text.length > MaxLogLength
    ? { text: text.slice(-MaxLogLength), truncated: true }
    : { text, truncated: false }
}

/**
 * Strip terminal color codes and GitLab's section markers from a job log,
 * and keep only the last state of lines redrawn with carriage returns.
 */
export function cleanJobLog(log: string): string {
  return log
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/section_(start|end):\d+:[^\r\n]*\r?/g, '')
    .split('\n')
    .map(line => {
      const parts = line.replace(/\r$/, '').split('\r')
      return parts[parts.length - 1]
    })
    .join('\n')
}

/** Whether a pipeline or job may still change, so it's worth refreshing. */
export function isActiveStatus(status: string): boolean {
  return [
    'created',
    'waiting_for_resource',
    'preparing',
    'pending',
    'running',
    'scheduled',
  ].includes(status)
}

/** "1m 05s" for a duration in seconds. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null) {
    return null
  }
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m === 0) {
    return `${s}s`
  }
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m ${s.toString().padStart(2, '0')}s`
}

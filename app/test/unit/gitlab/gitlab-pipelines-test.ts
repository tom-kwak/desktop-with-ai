import { describe, it } from 'node:test'
import assert from 'node:assert'
import { GitLabRequestFetch } from '../../../src/lib/gitlab/gitlab-merge-requests'
import {
  IGitLabJob,
  cleanJobLog,
  fetchJobLog,
  fetchLatestBranchPipeline,
  formatDuration,
  groupJobsByStage,
  isActiveStatus,
  latestPipelineBySha,
  runJobAction,
} from '../../../src/lib/gitlab/gitlab-pipelines'

const job = (
  id: number,
  stage: string,
  status: string,
  allowFailure = false
): IGitLabJob => ({
  id,
  name: `job${id}`,
  stage,
  status,
  allowFailure,
  duration: null,
  webURL: null,
})

describe('groupJobsByStage', () => {
  it('orders stages by the CI file, not by GitLab’s newest-first list', () => {
    const stages = groupJobsByStage([
      job(4, 'deploy', 'manual'),
      job(3, 'test', 'failed', true),
      job(2, 'test', 'success'),
      job(1, 'build', 'success'),
    ])
    assert.deepEqual(
      stages.map(s => [s.name, s.jobs.map(j => j.id), s.status]),
      [
        ['build', [1], 'success'],
        // An allowed failure doesn't fail the stage.
        ['test', [2, 3], 'success'],
        ['deploy', [4], 'manual'],
      ]
    )
  })

  it('reports the most important job status for a stage', () => {
    assert.equal(
      groupJobsByStage([job(1, 't', 'success'), job(2, 't', 'failed')])[0]
        .status,
      'failed'
    )
    assert.equal(
      groupJobsByStage([job(1, 't', 'success'), job(2, 't', 'running')])[0]
        .status,
      'running'
    )
  })
})

describe('job logs', () => {
  it('strips colors, section markers and redrawn progress', () => {
    const raw =
      'section_start:1700000000:prepare\r\u001b[0K\u001b[32;1mPreparing\u001b[0;m\n' +
      'Downloading 10%\rDownloading 100%\n' +
      'section_end:1700000001:prepare\r\u001b[0K\n'
    assert.equal(cleanJobLog(raw), 'Preparing\nDownloading 100%\n\n')
  })

  it('reads the log as text and keeps the end of long logs', async () => {
    const calls = new Array<string>()
    const fetch: GitLabRequestFetch = async url => {
      calls.push(url)
      return {
        status: 200,
        json: async () => {
          throw new Error('not JSON')
        },
        text: async () => 'x'.repeat(250_000) + 'END',
      }
    }
    const log = await fetchJobLog(
      { serverURL: 'http://gl', token: 't', fetch },
      1,
      7
    )
    assert.ok(calls[0].endsWith('/projects/1/jobs/7/trace'))
    assert.equal(log.truncated, true)
    assert.ok(log.text.endsWith('END'))
  })
})

describe('pipeline requests', () => {
  it('asks for the newest pipeline of a branch', async () => {
    const calls = new Array<string>()
    const fetch: GitLabRequestFetch = async url => {
      calls.push(url)
      return {
        status: 200,
        json: async () => [{ id: 9, status: 'running', ref: 'feature/a' }],
      }
    }
    const p = await fetchLatestBranchPipeline(
      { serverURL: 'http://gl', token: 't', fetch },
      1,
      'feature/a'
    )
    assert.equal(p?.id, 9)
    assert.ok(calls[0].includes('ref=feature%2Fa'))
  })

  it('posts job actions', async () => {
    const calls = new Array<{ url: string; method: string }>()
    const fetch: GitLabRequestFetch = async (url, init) => {
      calls.push({ url, method: init.method })
      return {
        status: 201,
        json: async () => ({ id: 8, name: 'build', status: 'pending' }),
      }
    }
    const retried = await runJobAction(
      { serverURL: 'http://gl', token: 't', fetch },
      1,
      7,
      'retry'
    )
    assert.equal(retried.id, 8)
    assert.deepEqual(calls[0], {
      url: 'http://gl/api/v4/projects/1/jobs/7/retry',
      method: 'POST',
    })
  })
})

describe('pipeline helpers', () => {
  it('formats durations and knows which statuses still change', () => {
    assert.equal(formatDuration(null), null)
    assert.equal(formatDuration(42.4), '42s')
    assert.equal(formatDuration(65), '1m 05s')
    assert.equal(formatDuration(3720), '1h 2m')
    assert.equal(isActiveStatus('running'), true)
    assert.equal(isActiveStatus('manual'), false)
    assert.equal(isActiveStatus('success'), false)
  })
})

describe('latestPipelineBySha', () => {
  it('keeps the newest pipeline of each commit', () => {
    const p = (id: number, sha: string, status: string) => ({
      id,
      status,
      ref: 'x',
      sha,
      webURL: null,
      duration: null,
      createdAt: '',
      source: null,
    })
    const map = latestPipelineBySha([
      p(5, 'aaa', 'running'),
      p(3, 'aaa', 'failed'),
      p(4, 'bbb', 'success'),
      p(6, '', 'success'),
    ])
    assert.equal(map.get('aaa')?.id, 5)
    assert.equal(map.get('bbb')?.status, 'success')
    assert.equal(map.size, 2)
  })
})

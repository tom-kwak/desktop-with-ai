import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  GitLabRequestFetch,
  fetchMergeRequests,
  parseDiffForDisplay,
} from '../../../src/lib/gitlab/gitlab-merge-requests'
import {
  createLineDiscussion,
  describeMergeStatus,
  mergeMergeRequest,
  parseApprovals,
  parseDraftNote,
  parseMergeRequestDetails,
  setDraftInTitle,
  updateMergeRequest,
} from '../../../src/lib/gitlab/gitlab-merge-request-actions'
import {
  GitLabGitUsername,
  getGitLabGitCredential,
  isGitLabAccountURL,
} from '../../../src/lib/gitlab/gitlab-credentials'
import { IGitLabAccount } from '../../../src/lib/gitlab/gitlab-accounts-store'

interface ICall {
  readonly url: string
  readonly method: string
  readonly body?: string
}

function stub(body: unknown, calls: Array<ICall>, status = 200) {
  const fetch: GitLabRequestFetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body })
    return { status, json: async () => body }
  }
  return { serverURL: 'http://localhost:8929', token: 't', fetch }
}

const mr = {
  iid: 1,
  title: 'Draft: Add login',
  source_branch: 'feature',
  target_branch: 'main',
  web_url: 'http://localhost:8929/a/b/-/merge_requests/1',
  sha: 'head',
  detailed_merge_status: 'ci_still_running',
  has_conflicts: false,
  head_pipeline: { id: 7, status: 'running', web_url: 'http://x/p/7' },
  diff_refs: { base_sha: 'b', start_sha: 's', head_sha: 'head' },
  reviewers: [{ id: 2, username: 'jane', name: 'Jane' }],
  assignees: [],
  labels: ['bug'],
  squash: true,
}

describe('GitLab merge request actions', () => {
  it('reads merge status, pipeline and diff refs', () => {
    const d = parseMergeRequestDetails(mr)
    assert.equal(d?.mergeStatus, 'ci_still_running')
    assert.deepEqual(d?.pipeline, {
      id: 7,
      status: 'running',
      webURL: 'http://x/p/7',
    })
    assert.deepEqual(d?.diffRefs, {
      baseSha: 'b',
      startSha: 's',
      headSha: 'head',
    })
    assert.deepEqual(
      d?.reviewers.map(r => r.id),
      [2]
    )
    assert.equal(d?.mergeRequest.headSha, 'head')
  })

  it('filters the list by author or reviewer', async () => {
    const calls = new Array<ICall>()
    await fetchMergeRequests(stub([], calls), 9, 'merged', {
      reviewerUsername: 'root',
    })
    assert.ok(calls[0].url.includes('state=merged'))
    assert.ok(calls[0].url.includes('reviewer_username=root'))
  })

  it('places a line comment with the diff refs', async () => {
    const calls = new Array<ICall>()
    await createLineDiscussion(
      stub({ id: 'd', notes: [{ id: 1, body: 'x' }] }, calls),
      9,
      1,
      { baseSha: 'b', startSha: 's', headSha: 'h' },
      { oldPath: 'a.ts', newPath: 'a.ts', oldLine: null, newLine: 4 },
      'Nit'
    )
    assert.ok(calls[0].url.endsWith('/projects/9/merge_requests/1/discussions'))
    assert.deepEqual(JSON.parse(calls[0].body ?? '{}'), {
      body: 'Nit',
      position: {
        position_type: 'text',
        base_sha: 'b',
        start_sha: 's',
        head_sha: 'h',
        old_path: 'a.ts',
        new_path: 'a.ts',
        new_line: 4,
      },
    })
  })

  it('sends merge options and the expected head', async () => {
    const calls = new Array<ICall>()
    await mergeMergeRequest(stub(mr, calls), 9, 1, {
      squash: true,
      removeSourceBranch: false,
      whenPipelineSucceeds: true,
      sha: 'head',
    })
    assert.equal(calls[0].method, 'PUT')
    assert.ok(calls[0].url.endsWith('/merge_requests/1/merge'))
    assert.deepEqual(JSON.parse(calls[0].body ?? '{}'), {
      squash: true,
      should_remove_source_branch: false,
      merge_when_pipeline_succeeds: true,
      sha: 'head',
    })
  })

  it('only sends the fields being changed', async () => {
    const calls = new Array<ICall>()
    await updateMergeRequest(stub(mr, calls), 9, 1, { reviewerIds: [] })
    assert.deepEqual(JSON.parse(calls[0].body ?? '{}'), { reviewer_ids: [] })
  })

  it('toggles the draft marker in titles', () => {
    assert.equal(setDraftInTitle('Draft: Add login', false), 'Add login')
    assert.equal(setDraftInTitle('[Draft] Add login', false), 'Add login')
    assert.equal(setDraftInTitle('Add login', true), 'Draft: Add login')
    assert.equal(setDraftInTitle('Draft: Add login', true), 'Draft: Add login')
  })

  it('reads approvals and pending review comments', () => {
    assert.deepEqual(
      parseApprovals({
        approvals_left: 1,
        approved_by: [{ user: { username: 'jane', name: 'Jane' } }],
      }),
      { approvedBy: [{ username: 'jane', name: 'Jane' }], approvalsLeft: 1 }
    )
    assert.deepEqual(
      parseDraftNote({
        id: 3,
        note: 'Hmm',
        position: { old_path: 'a', new_path: 'a', new_line: 2 },
      }),
      {
        id: 3,
        body: 'Hmm',
        line: { oldPath: 'a', newPath: 'a', oldLine: null, newLine: 2 },
      }
    )
    assert.deepEqual(parseDraftNote({ id: 4, note: 'General' })?.line, null)
  })

  it('explains merge blockers and stays quiet when mergeable', () => {
    assert.equal(describeMergeStatus('mergeable'), null)
    assert.ok(describeMergeStatus('conflict')?.includes('conflicts'))
    assert.ok(describeMergeStatus('something_new')?.includes('something_new'))
  })

  it('numbers diff lines for display', () => {
    assert.deepEqual(parseDiffForDisplay('@@ -3,2 +3,2 @@ x\n a\n-b\n+c'), [
      { kind: 'hunk', text: '@@ -3,2 +3,2 @@ x' },
      { kind: 'context', oldLine: 3, newLine: 3, text: 'a' },
      { kind: 'delete', oldLine: 4, newLine: null, text: 'b' },
      { kind: 'add', oldLine: null, newLine: 4, text: 'c' },
    ])
  })
})

describe('GitLab Git credentials', () => {
  const account = (serverURL: string): IGitLabAccount => ({
    serverURL,
    id: 1,
    username: 'root',
    name: 'root',
    avatarURL: null,
    webURL: null,
  })
  const source = (
    enabled: boolean,
    accounts: ReadonlyArray<IGitLabAccount>
  ) => ({
    isEnabled: () => enabled,
    getAll: () => accounts,
    getToken: async () => 'glpat-secret',
  })

  it('answers Git with the token for a signed-in server', async () => {
    const s = source(true, [account('http://localhost:8929')])
    assert.deepEqual(
      await getGitLabGitCredential(new URL('http://localhost:8929/'), s),
      { username: GitLabGitUsername, password: 'glpat-secret' }
    )
    assert.ok(isGitLabAccountURL(new URL('http://localhost:8929/a/b.git'), s))
  })

  it('stays out of the way for other hosts, ports, protocols, or when off', async () => {
    const accounts = [account('https://example.com/gitlab')]
    const on = source(true, accounts)
    for (const url of [
      'https://github.com/',
      'https://example.com:8443/',
      'http://example.com/',
      'https://example.com/other/repo.git',
    ]) {
      assert.equal(await getGitLabGitCredential(new URL(url), on), null, url)
    }
    assert.ok(
      isGitLabAccountURL(new URL('https://example.com/gitlab/a/b.git'), on)
    )
    assert.equal(
      await getGitLabGitCredential(
        new URL('https://example.com/'),
        source(false, accounts)
      ),
      null
    )
  })
})

import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  GitLabAPIError,
  GitLabRequestFetch,
  addMergeRequestComment,
  createMergeRequest,
  describeGitLabError,
  fetchMergeRequestComments,
  fetchMergeRequests,
  fetchProjectInfo,
} from '../../../src/lib/gitlab/gitlab-merge-requests'

interface ICall {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body?: string
}

function stub(
  status: number,
  body: unknown,
  calls: Array<ICall> = []
): GitLabRequestFetch {
  return async (url, init) => {
    calls.push({ url, ...init })
    return { status, json: async () => body }
  }
}

const mr = {
  iid: 4,
  title: 'Add login',
  description: 'Adds a login page',
  state: 'opened',
  draft: false,
  source_branch: 'feature/login',
  target_branch: 'main',
  author: { username: 'jane', name: 'Jane' },
  web_url: 'http://localhost:8929/team/api/-/merge_requests/4',
  created_at: '2026-11-07T10:00:00Z',
  updated_at: '2026-11-07T11:00:00Z',
  user_notes_count: 2,
}

const connection = (fetch: GitLabRequestFetch) => ({
  serverURL: 'http://localhost:8929',
  token: 'glpat-x',
  fetch,
})

describe('GitLab merge request API', () => {
  it('looks up a project by its URL-encoded path', async () => {
    const calls = new Array<ICall>()
    const project = await fetchProjectInfo(
      connection(
        stub(
          200,
          {
            id: 9,
            path_with_namespace: 'team/backend/api',
            default_branch: 'main',
            web_url: 'http://localhost:8929/team/backend/api',
          },
          calls
        )
      ),
      'team/backend/api'
    )

    assert.equal(project.id, 9)
    assert.equal(project.defaultBranch, 'main')
    assert.equal(
      calls[0].url,
      'http://localhost:8929/api/v4/projects/team%2Fbackend%2Fapi'
    )
    assert.equal(calls[0].headers['PRIVATE-TOKEN'], 'glpat-x')
  })

  it('lists open merge requests', async () => {
    const calls = new Array<ICall>()
    const list = await fetchMergeRequests(
      connection(stub(200, [mr, { iid: 'bad' }], calls)),
      9
    )
    assert.deepEqual(
      list.map(m => [m.iid, m.sourceBranch, m.author?.username]),
      [[4, 'feature/login', 'jane']]
    )
    assert.ok(calls[0].url.includes('/projects/9/merge_requests?state=opened'))
  })

  it('creates a merge request with a JSON body', async () => {
    const calls = new Array<ICall>()
    const created = await createMergeRequest(
      connection(stub(201, mr, calls)),
      9,
      {
        sourceBranch: 'feature/login',
        targetBranch: 'main',
        title: 'Add login',
        description: 'Adds a login page',
      }
    )
    assert.equal(created.iid, 4)
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(calls[0].body ?? '{}'), {
      source_branch: 'feature/login',
      target_branch: 'main',
      title: 'Add login',
      description: 'Adds a login page',
      remove_source_branch: false,
    })
  })

  it("passes on GitLab's reason when a merge request can't be created", async () => {
    await assert.rejects(
      createMergeRequest(
        connection(
          stub(409, {
            message: [
              'Another open merge request already exists for this source branch: !4',
            ],
          })
        ),
        9,
        { sourceBranch: 'a', targetBranch: 'main', title: 't', description: '' }
      ),
      (e: unknown) =>
        e instanceof GitLabAPIError &&
        e.status === 409 &&
        e.message.includes('already exists')
    )
  })

  it('lists comments without system notes', async () => {
    const comments = await fetchMergeRequestComments(
      connection(
        stub(200, [
          { id: 1, body: 'added 1 commit', system: true },
          {
            id: 2,
            body: 'Looks good',
            system: false,
            author: { username: 'john', name: 'John' },
            created_at: '2026-11-07T12:00:00Z',
          },
        ])
      ),
      9,
      4
    )
    assert.deepEqual(
      comments.map(c => [c.id, c.body, c.author?.username]),
      [[2, 'Looks good', 'john']]
    )
  })

  it('adds a comment', async () => {
    const calls = new Array<ICall>()
    const note = await addMergeRequestComment(
      connection(stub(201, { id: 3, body: 'Thanks', system: false }, calls)),
      9,
      4,
      'Thanks'
    )
    assert.equal(note.id, 3)
    assert.ok(calls[0].url.endsWith('/projects/9/merge_requests/4/notes'))
    assert.deepEqual(JSON.parse(calls[0].body ?? '{}'), { body: 'Thanks' })
  })

  it('explains auth, permission and network failures', async () => {
    const check = async (fetch: GitLabRequestFetch, status: number) =>
      assert.rejects(
        fetchMergeRequests(connection(fetch), 9),
        (e: unknown) => e instanceof GitLabAPIError && e.status === status
      )
    await check(stub(401, { message: '401 Unauthorized' }), 401)
    await check(stub(403, { message: '403 Forbidden' }), 403)
    await check(stub(404, { message: '404 Project Not Found' }), 404)
    await check(async () => {
      throw new TypeError('Failed to fetch')
    }, 0)
  })
})

describe('describeGitLabError', () => {
  it('reads the shapes GitLab uses for errors', () => {
    assert.equal(describeGitLabError({ message: 'Nope' }), 'Nope')
    assert.equal(describeGitLabError({ message: ['a', 'b'] }), 'a b')
    assert.equal(
      describeGitLabError({ message: { title: ["can't be blank"] } }),
      "title can't be blank"
    )
    assert.equal(
      describeGitLabError({ error: 'x', error_description: 'Why' }),
      'Why'
    )
    assert.equal(describeGitLabError('plain'), null)
  })
})

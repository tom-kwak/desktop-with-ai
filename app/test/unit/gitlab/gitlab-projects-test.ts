import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  GitLabListFetch,
  GitLabProjectsError,
  GitLabProjectsStore,
  IGitLabProject,
  fetchGitLabProjects,
  parseGitLabProject,
} from '../../../src/lib/gitlab/gitlab-projects'
import { IGitLabAccount } from '../../../src/lib/gitlab/gitlab-accounts-store'
import { groupGitLabProjects } from '../../../src/ui/gitlab/group-gitlab-projects'
import { YourRepositoriesIdentifier } from '../../../src/ui/clone-repository/group-repositories'

const server = 'http://localhost:8929'

function apiProject(
  id: number,
  path: string,
  kind: 'user' | 'group',
  visibility = 'private'
) {
  const parts = path.split('/')
  return {
    id,
    name: parts.at(-1),
    path_with_namespace: path,
    namespace: { full_path: parts.slice(0, -1).join('/'), kind },
    http_url_to_repo: `${server}/${path}.git`,
    ssh_url_to_repo: `ssh://git@localhost:2224/${path}.git`,
    web_url: `${server}/${path}`,
    visibility,
  }
}

function pages(
  bodies: ReadonlyArray<unknown>,
  seen: Array<string> = []
): GitLabListFetch {
  return async url => {
    seen.push(url)
    const page = Number(new URL(url).searchParams.get('page'))
    const next = page < bodies.length ? String(page + 1) : ''
    return {
      status: 200,
      json: async () => bodies[page - 1],
      headers: {
        get: (name: string) => (name === 'X-Next-Page' ? next : null),
      },
    }
  }
}

function status(code: number): GitLabListFetch {
  return async () => ({
    status: code,
    json: async () => ({ message: String(code) }),
    headers: { get: () => null },
  })
}

describe('parseGitLabProject', () => {
  it('reads a project with a nested group', () => {
    assert.deepEqual(
      parseGitLabProject(apiProject(3, 'team/backend/api', 'group')),
      {
        id: 3,
        name: 'api',
        pathWithNamespace: 'team/backend/api',
        namespacePath: 'team/backend',
        isPersonal: false,
        httpCloneURL: `${server}/team/backend/api.git`,
        sshCloneURL: 'ssh://git@localhost:2224/team/backend/api.git',
        webURL: `${server}/team/backend/api`,
        visibility: 'private',
      }
    )
  })

  it('rejects entries without the fields the dialog needs', () => {
    assert.equal(parseGitLabProject({ id: 1, name: 'x' }), null)
    assert.equal(parseGitLabProject(null), null)
  })
})

describe('fetchGitLabProjects', () => {
  it('follows X-Next-Page and reports each page', async () => {
    const seen = new Array<string>()
    const received = new Array<number>()
    await fetchGitLabProjects(
      server,
      'glpat-x',
      page => received.push(page.length),
      pages(
        [
          [apiProject(1, 'root/a', 'user'), apiProject(2, 'root/b', 'user')],
          [apiProject(3, 'team/c', 'group')],
        ],
        seen
      )
    )

    assert.deepEqual(received, [2, 1])
    assert.equal(seen.length, 2)
    const first = new URL(seen[0]).searchParams
    assert.equal(first.get('membership'), 'true')
    assert.equal(first.get('archived'), 'false')
    assert.equal(first.get('per_page'), '100')
  })

  it('explains a rejected or under-scoped token', async () => {
    await assert.rejects(
      fetchGitLabProjects(server, 'x', () => {}, status(401)),
      (e: unknown) =>
        e instanceof GitLabProjectsError && e.message.includes('sign in again')
    )
    await assert.rejects(
      fetchGitLabProjects(server, 'x', () => {}, status(403)),
      (e: unknown) =>
        e instanceof GitLabProjectsError && e.message.includes('read_api')
    )
  })

  it('reports an unexpected body', async () => {
    await assert.rejects(
      fetchGitLabProjects(server, 'x', () => {}, pages([{ not: 'a list' }])),
      GitLabProjectsError
    )
  })
})

describe('GitLabProjectsStore', () => {
  const account: IGitLabAccount = {
    serverURL: server,
    id: 1,
    username: 'root',
    name: 'Administrator',
    avatarURL: null,
    webURL: null,
  }

  it('loads projects and notifies subscribers', async () => {
    const store = new GitLabProjectsStore(
      async () => 'glpat-x',
      pages([[apiProject(1, 'root/a', 'user')]])
    )
    let updates = 0
    store.onDidUpdate(() => updates++)

    assert.equal(store.getState(account), undefined)
    await store.load(account)

    const state = store.getState(account)
    assert.equal(state?.loading, false)
    assert.equal(state?.error, null)
    assert.deepEqual(
      state?.projects?.map(p => p.pathWithNamespace),
      ['root/a']
    )
    assert.ok(updates >= 2)
  })

  it('keeps the error when the token is missing', async () => {
    const store = new GitLabProjectsStore(async () => null, status(200))
    await store.load(account)
    const state = store.getState(account)
    assert.equal(state?.loading, false)
    assert.ok(state?.error?.message.includes('keychain'))
  })

  it('forgets lists of accounts that signed out', async () => {
    const store = new GitLabProjectsStore(
      async () => 'glpat-x',
      pages([[apiProject(1, 'root/a', 'user')]])
    )
    await store.load(account)
    store.retainOnly([])
    assert.equal(store.getState(account), undefined)
  })
})

describe('groupGitLabProjects', () => {
  it('puts personal projects first, then groups by full path', () => {
    const projects = [
      apiProject(1, 'team/backend/api', 'group'),
      apiProject(2, 'root/notes', 'user', 'public'),
      apiProject(3, 'alpha/site', 'group'),
      apiProject(4, 'team/backend/worker', 'group'),
    ]
      .map(parseGitLabProject)
      .filter((p): p is IGitLabProject => p !== null)

    const groups = groupGitLabProjects(projects, 'root')
    assert.deepEqual(
      groups.map(g => g.identifier),
      [YourRepositoriesIdentifier, 'alpha', 'team/backend']
    )
    assert.deepEqual(
      groups[2].items.map(i => i.text[0]),
      ['team/backend/api', 'team/backend/worker']
    )
    assert.equal(groups[0].items[0].url, `${server}/root/notes.git`)
  })
})

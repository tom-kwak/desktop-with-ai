import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  GitLabFetch,
  GitLabSignInError,
  fetchGitLabUser,
  parseGitLabUser,
} from '../../../src/lib/gitlab/gitlab-api'

const user = {
  id: 7,
  username: 'jane',
  name: 'Jane Doe',
  avatar_url: 'https://gitlab.example.com/avatar.png',
  web_url: 'https://gitlab.example.com/jane',
}

function respond(status: number, body?: unknown): GitLabFetch {
  return async () => ({
    status,
    json: async () => {
      if (body === undefined) {
        throw new SyntaxError('Unexpected token <')
      }
      return body
    },
  })
}

async function signInErrorKind(fetchImpl: GitLabFetch): Promise<string> {
  try {
    await fetchGitLabUser('https://gitlab.example.com', 'glpat-x', fetchImpl)
  } catch (e) {
    assert.ok(e instanceof GitLabSignInError)
    return e.kind
  }
  assert.fail('expected fetchGitLabUser to throw')
}

describe('fetchGitLabUser', () => {
  it('sends the token to the user endpoint and returns the user', async () => {
    const calls = new Array<{ url: string; headers: Record<string, string> }>()
    const result = await fetchGitLabUser(
      'https://gitlab.example.com',
      'glpat-x',
      async (url, init) => {
        calls.push({ url, headers: init.headers })
        return { status: 200, json: async () => user }
      }
    )

    assert.deepEqual(result, {
      id: 7,
      username: 'jane',
      name: 'Jane Doe',
      avatarURL: 'https://gitlab.example.com/avatar.png',
      webURL: 'https://gitlab.example.com/jane',
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://gitlab.example.com/api/v4/user')
    assert.equal(calls[0].headers['PRIVATE-TOKEN'], 'glpat-x')
  })

  it('reports a rejected token', async () => {
    assert.equal(
      await signInErrorKind(respond(401, { message: '401 Unauthorized' })),
      'invalid-token'
    )
  })

  it('reports a token without the needed scope', async () => {
    assert.equal(
      await signInErrorKind(respond(403, { error: 'insufficient_scope' })),
      'insufficient-scope'
    )
  })

  it("passes on GitLab's explanation for a fine-grained token", async () => {
    const description =
      'Access denied: This operation requires a fine-grained personal access token with the following user permissions: [User: Read].'
    try {
      await fetchGitLabUser(
        'https://gitlab.example.com',
        'glpat-x',
        respond(403, {
          error: 'insufficient_granular_scope',
          error_description: description,
        })
      )
      assert.fail('expected fetchGitLabUser to throw')
    } catch (e) {
      assert.ok(e instanceof GitLabSignInError)
      assert.equal(e.kind, 'insufficient-scope')
      assert.ok(e.message.includes('User: Read'))
      assert.ok(e.message.endsWith(description))
    }
  })

  it('reports an unreachable server', async () => {
    assert.equal(
      await signInErrorKind(async () => {
        throw new TypeError('Failed to fetch')
      }),
      'unreachable'
    )
  })

  it('reports a server that does not answer like GitLab', async () => {
    assert.equal(await signInErrorKind(respond(404)), 'not-gitlab')
    assert.equal(await signInErrorKind(respond(200)), 'not-gitlab')
    assert.equal(
      await signInErrorKind(respond(200, { login: 'octocat' })),
      'not-gitlab'
    )
  })

  it('reports other server errors as unexpected', async () => {
    assert.equal(
      await signInErrorKind(respond(500, { message: 'Internal' })),
      'unexpected'
    )
  })
})

describe('parseGitLabUser', () => {
  it('falls back to the username when the name is empty', () => {
    assert.deepEqual(parseGitLabUser({ id: 1, username: 'bot', name: '' }), {
      id: 1,
      username: 'bot',
      name: 'bot',
      avatarURL: null,
      webURL: null,
    })
  })
})

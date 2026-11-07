import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import {
  GitLabAccountsStorageKey,
  GitLabAccountsStore,
  IGitLabAccount,
  getGitLabTokenKey,
} from '../../../src/lib/gitlab/gitlab-accounts-store'
import {
  GitLabFetch,
  GitLabSignInError,
} from '../../../src/lib/gitlab/gitlab-api'
import { GitLabServerURLError } from '../../../src/lib/gitlab/gitlab-server-url'
import { InMemoryStore, AsyncInMemoryStore } from '../../helpers/stores'

function gitLabUser(id: number, username: string): GitLabFetch {
  return async () => ({
    status: 200,
    json: async () => ({ id, username, name: username.toUpperCase() }),
  })
}

const rejectToken: GitLabFetch = async () => ({
  status: 401,
  json: async () => ({ message: '401 Unauthorized' }),
})

describe('GitLabAccountsStore', () => {
  let dataStore: InMemoryStore
  let secureStore: AsyncInMemoryStore
  let store: GitLabAccountsStore

  beforeEach(() => {
    dataStore = new InMemoryStore()
    secureStore = new AsyncInMemoryStore()
    store = new GitLabAccountsStore(dataStore, secureStore)
  })

  it('starts empty', () => {
    assert.deepEqual(store.getAll(), [])
  })

  it('saves a verified account and keeps its token in the secure store', async () => {
    const account = await store.signIn(
      'localhost:8929',
      ' glpat-a ',
      gitLabUser(1, 'root')
    )

    assert.equal(account.serverURL, 'https://localhost:8929')
    assert.equal(account.username, 'root')
    assert.deepEqual(store.getAll(), [account])
    assert.equal(await store.getToken(account), 'glpat-a')

    const persisted = dataStore.getItem(GitLabAccountsStorageKey)
    assert.ok(persisted !== null)
    assert.ok(!persisted.includes('glpat-a'), 'token must not be in storage')
  })

  it('loads saved accounts in a new store', async () => {
    const account = await store.signIn(
      'http://localhost:8929',
      'glpat-a',
      gitLabUser(1, 'root')
    )

    const reloaded = new GitLabAccountsStore(dataStore, secureStore)
    assert.deepEqual(reloaded.getAll(), [account])
  })

  it('ignores unreadable saved data', () => {
    dataStore.setItem(GitLabAccountsStorageKey, '{not json')
    assert.deepEqual(
      new GitLabAccountsStore(dataStore, secureStore).getAll(),
      []
    )

    dataStore.setItem(
      GitLabAccountsStorageKey,
      JSON.stringify([{ serverURL: 'https://a', id: 'x' }])
    )
    assert.deepEqual(
      new GitLabAccountsStore(dataStore, secureStore).getAll(),
      []
    )
  })

  it('replaces the account when signing in to the same server again', async () => {
    const first = await store.signIn(
      'https://gitlab.example.com',
      'glpat-a',
      gitLabUser(1, 'jane')
    )
    const second = await store.signIn(
      'https://gitlab.example.com/',
      'glpat-b',
      gitLabUser(2, 'john')
    )

    assert.deepEqual(store.getAll(), [second])
    assert.equal(await store.getToken(second), 'glpat-b')
    assert.equal(await store.getToken(first), null)
  })

  it('keeps accounts on different servers side by side', async () => {
    await store.signIn('https://gitlab.com', 'glpat-a', gitLabUser(1, 'jane'))
    await store.signIn(
      'https://gitlab.example.com',
      'glpat-b',
      gitLabUser(2, 'jane')
    )

    assert.deepEqual(
      store.getAll().map(a => a.serverURL),
      ['https://gitlab.com', 'https://gitlab.example.com']
    )
  })

  it('leaves stored accounts unchanged when the token is rejected', async () => {
    await assert.rejects(
      store.signIn('https://gitlab.com', 'bad', rejectToken),
      (e: unknown) =>
        e instanceof GitLabSignInError && e.kind === 'invalid-token'
    )
    assert.deepEqual(store.getAll(), [])
    assert.equal(
      await secureStore.getItem(getGitLabTokenKey('https://gitlab.com'), ''),
      null
    )
  })

  it('rejects an unusable address before contacting the server', async () => {
    let called = false
    await assert.rejects(
      store.signIn('http://gitlab.example.com', 'glpat-a', async () => {
        called = true
        return { status: 200, json: async () => ({}) }
      }),
      GitLabServerURLError
    )
    assert.equal(called, false)
  })

  it('signs out by removing the account and its token', async () => {
    const account = await store.signIn(
      'https://gitlab.com',
      'glpat-a',
      gitLabUser(1, 'jane')
    )
    await store.signOut(account)

    assert.deepEqual(store.getAll(), [])
    assert.equal(await store.getToken(account), null)
  })

  it('notifies subscribers when accounts change', async () => {
    const updates = new Array<ReadonlyArray<IGitLabAccount>>()
    const subscription = store.onDidUpdate(accounts => updates.push(accounts))

    const account = await store.signIn(
      'https://gitlab.com',
      'glpat-a',
      gitLabUser(1, 'jane')
    )
    await store.signOut(account)
    subscription.dispose()
    await store.signIn('https://gitlab.com', 'glpat-a', gitLabUser(1, 'jane'))

    assert.deepEqual(
      updates.map(u => u.length),
      [1, 0]
    )
  })
})

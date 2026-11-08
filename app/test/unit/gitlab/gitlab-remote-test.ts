import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  matchGitLabRemote,
  parseGitRemoteURL,
} from '../../../src/lib/gitlab/gitlab-remote'
import { IGitLabAccount } from '../../../src/lib/gitlab/gitlab-accounts-store'
import { GitLabSettings } from '../../../src/lib/gitlab/gitlab-settings'
import { findGitLabRemote } from '../../../src/ui/gitlab/gitlab-merge-requests-toolbar-button'
import { InMemoryStore } from '../../helpers/stores'

function account(serverURL: string, username = 'root'): IGitLabAccount {
  return {
    serverURL,
    id: 1,
    username,
    name: username,
    avatarURL: null,
    webURL: null,
  }
}

const local = account('http://localhost:8929')
const company = account('https://example.com/gitlab', 'jane')

describe('parseGitRemoteURL', () => {
  it('keeps nested group paths', () => {
    assert.deepEqual(
      parseGitRemoteURL('http://localhost:8929/team/backend/api.git'),
      { kind: 'http', host: 'localhost:8929', path: 'team/backend/api' }
    )
  })

  it('reads scp-like and ssh:// remotes', () => {
    assert.deepEqual(parseGitRemoteURL('git@gitlab.com:team/api.git'), {
      kind: 'ssh',
      host: 'gitlab.com',
      path: 'team/api',
    })
    assert.deepEqual(
      parseGitRemoteURL('ssh://git@localhost:2224/team/backend/api.git'),
      { kind: 'ssh', host: 'localhost', path: 'team/backend/api' }
    )
  })

  it('rejects local paths and unknown schemes', () => {
    assert.equal(parseGitRemoteURL('/Users/me/repo'), null)
    assert.equal(parseGitRemoteURL('file:///Users/me/repo'), null)
  })
})

describe('matchGitLabRemote', () => {
  it('matches an http remote by host and port', () => {
    assert.deepEqual(
      matchGitLabRemote('http://localhost:8929/test/my-project.git', [local]),
      { account: local, projectPath: 'test/my-project' }
    )
    assert.equal(
      matchGitLabRemote('http://localhost:9999/test/my-project.git', [local]),
      null
    )
  })

  it('matches an SSH remote by host name even on another port', () => {
    assert.deepEqual(
      matchGitLabRemote('ssh://git@localhost:2224/a/b/c.git', [local]),
      { account: local, projectPath: 'a/b/c' }
    )
  })

  it('strips the path of a GitLab installed under a sub-path', () => {
    assert.deepEqual(
      matchGitLabRemote('https://example.com/gitlab/team/api.git', [company]),
      { account: company, projectPath: 'team/api' }
    )
    assert.equal(
      matchGitLabRemote('https://example.com/other/team/api.git', [company]),
      null
    )
  })

  it('ignores GitHub and other hosts', () => {
    assert.equal(
      matchGitLabRemote('https://github.com/desktop/desktop.git', [local]),
      null
    )
  })
})

describe('findGitLabRemote', () => {
  it('prefers origin over other remotes', () => {
    const match = findGitLabRemote(
      [
        { name: 'fork', url: 'http://localhost:8929/me/api.git' },
        { name: 'origin', url: 'http://localhost:8929/team/api.git' },
      ],
      [local]
    )
    assert.equal(match?.projectPath, 'team/api')
  })

  it('falls back to another remote on a GitLab server', () => {
    const match = findGitLabRemote(
      [
        { name: 'origin', url: 'https://github.com/me/api.git' },
        { name: 'gitlab', url: 'git@localhost:team/api.git' },
      ],
      [local]
    )
    assert.equal(match?.projectPath, 'team/api')
  })
})

describe('GitLabSettings', () => {
  it('is off by default and remembers the switch', () => {
    const store = new InMemoryStore()
    const settings = new GitLabSettings(store)
    assert.equal(settings.isEnabled(), false)

    const changes = new Array<boolean>()
    settings.onDidChange(v => changes.push(v))
    settings.setEnabled(true)
    settings.setEnabled(true)

    assert.equal(new GitLabSettings(store).isEnabled(), true)
    settings.setEnabled(false)
    assert.deepEqual(changes, [true, false])
  })
})

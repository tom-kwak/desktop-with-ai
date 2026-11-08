import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  GitLabServerURLError,
  getGitLabTokenSettingsURL,
  normalizeGitLabServerURL,
} from '../../../src/lib/gitlab/gitlab-server-url'

function errorKind(address: string): string | null {
  try {
    normalizeGitLabServerURL(address)
    return null
  } catch (e) {
    assert.ok(e instanceof GitLabServerURLError)
    return e.kind
  }
}

describe('normalizeGitLabServerURL', () => {
  it('keeps an https address and drops a trailing slash', () => {
    assert.equal(
      normalizeGitLabServerURL('https://gitlab.com/'),
      'https://gitlab.com'
    )
  })

  it('assumes https when no scheme is given', () => {
    assert.equal(
      normalizeGitLabServerURL('  gitlab.example.com  '),
      'https://gitlab.example.com'
    )
  })

  it('keeps a port and a relative URL path', () => {
    assert.equal(
      normalizeGitLabServerURL('https://example.com:8443/gitlab/'),
      'https://example.com:8443/gitlab'
    )
  })

  it('drops a pasted API path', () => {
    assert.equal(
      normalizeGitLabServerURL('https://gitlab.com/api/v4'),
      'https://gitlab.com'
    )
  })

  it('allows plain http only for this computer', () => {
    assert.equal(
      normalizeGitLabServerURL('http://localhost:8929'),
      'http://localhost:8929'
    )
    assert.equal(
      normalizeGitLabServerURL('http://127.0.0.1:8929/'),
      'http://127.0.0.1:8929'
    )
    assert.equal(errorKind('http://gitlab.example.com'), 'insecure-protocol')
  })

  it('rejects empty, malformed and non-web addresses', () => {
    assert.equal(errorKind('   '), 'empty')
    assert.equal(errorKind('https://'), 'invalid')
    assert.equal(errorKind('ssh://git@gitlab.com'), 'invalid')
  })

  it('rejects credentials in the address', () => {
    assert.equal(errorKind('https://user:secret@gitlab.com'), 'invalid')
  })
})

describe('getGitLabTokenSettingsURL', () => {
  it('points at the personal access token settings page', () => {
    assert.equal(
      getGitLabTokenSettingsURL('https://example.com/gitlab'),
      'https://example.com/gitlab/-/user_settings/personal_access_tokens'
    )
  })
})

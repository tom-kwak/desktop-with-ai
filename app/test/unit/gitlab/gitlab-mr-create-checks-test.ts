import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  ICreateMergeRequestInput,
  getCreateMergeRequestProblem,
  pickDefaultTarget,
} from '../../../src/lib/gitlab/gitlab-mr-create-checks'

const ok: ICreateMergeRequestInput = {
  title: 'Add login',
  sourceBranch: 'feature',
  targetBranch: 'main',
  remoteBranches: ['main', 'feature'],
  existingIid: null,
  commitsAhead: 2,
}

const problem = (change: Partial<ICreateMergeRequestInput>) =>
  getCreateMergeRequestProblem({ ...ok, ...change })

describe('getCreateMergeRequestProblem', () => {
  it('accepts a valid merge request', () => {
    assert.equal(problem({}), null)
    assert.equal(problem({ remoteBranches: null, commitsAhead: null }), null)
  })

  it('explains every reason GitLab would refuse it', () => {
    assert.equal(problem({ existingIid: 4 })?.existingIid, 4)
    assert.ok(problem({ remoteBranches: ['main'] })?.message.includes('Push'))
    assert.ok(problem({ targetBranch: '' })?.message.includes('target'))
    assert.ok(problem({ targetBranch: 'feature' })?.message.includes('itself'))
    assert.ok(problem({ targetBranch: 'gone' })?.message.includes('gone'))
    assert.ok(problem({ title: '  ' })?.message.includes('title'))
    for (const p of [
      problem({ existingIid: 4 }),
      problem({ targetBranch: 'feature' }),
      problem({ title: '' }),
    ]) {
      assert.equal(p?.blocking, true)
    }
  })

  it('only warns when there seem to be no new commits', () => {
    assert.equal(problem({ commitsAhead: 0 })?.blocking, false)
  })
})

describe('pickDefaultTarget', () => {
  it('uses the default branch unless it is the source', () => {
    assert.equal(pickDefaultTarget('main', 'feature', ['main']), 'main')
    assert.equal(
      pickDefaultTarget('main', 'main', ['main', 'topic', 'develop']),
      'develop'
    )
    assert.equal(pickDefaultTarget('main', 'main', ['main', 'topic']), 'topic')
    assert.equal(pickDefaultTarget(null, 'main', ['main']), '')
  })
})

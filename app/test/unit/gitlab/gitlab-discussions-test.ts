import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  GitLabRequestFetch,
  IGitLabDiffFile,
  IGitLabNotePosition,
  fetchMergeRequestDiffs,
  fetchMergeRequestDiscussions,
  getDiffExcerpt,
} from '../../../src/lib/gitlab/gitlab-merge-requests'
import { linkGitLabReferences } from '../../../src/lib/gitlab/gitlab-markdown'

const connection = (fetch: GitLabRequestFetch) => ({
  serverURL: 'http://localhost:8929',
  token: 'glpat-x',
  fetch,
})

const diffNote = {
  id: 5,
  type: 'DiffNote',
  body: 'Typo here',
  system: false,
  resolvable: true,
  resolved: false,
  author: { username: 'root', name: 'Administrator' },
  created_at: '2026-11-08T05:00:53Z',
  position: {
    position_type: 'text',
    old_path: 'src/a.ts',
    new_path: 'src/a.ts',
    old_line: null,
    new_line: 12,
    head_sha: 'abc',
    line_range: {
      start: { old_line: null, new_line: 11, type: 'new' },
      end: { old_line: null, new_line: 12, type: 'new' },
    },
  },
}

describe('fetchMergeRequestDiscussions', () => {
  it('keeps line comments with their position and drops system notes', async () => {
    const discussions = await fetchMergeRequestDiscussions(
      connection(async () => ({
        status: 200,
        json: async () => [
          { id: 'a', notes: [{ id: 1, body: 'added 1 commit', system: true }] },
          {
            id: 'b',
            notes: [{ id: 2, body: 'LGTM', system: false, type: null }],
          },
          {
            id: 'c',
            notes: [
              diffNote,
              { ...diffNote, id: 6, body: 'Fixed', position: undefined },
            ],
          },
        ],
      })),
      1,
      1
    )

    assert.deepEqual(
      discussions.map(d => [d.id, d.notes.map(n => n.body), d.position]),
      [
        ['b', ['LGTM'], null],
        [
          'c',
          ['Typo here', 'Fixed'],
          {
            oldPath: 'src/a.ts',
            newPath: 'src/a.ts',
            oldLine: null,
            newLine: 12,
            startOldLine: null,
            startNewLine: 11,
            headSha: 'abc',
          },
        ],
      ]
    )
  })
})

describe('fetchMergeRequestDiffs', () => {
  it('falls back to /changes on servers without /diffs', async () => {
    const urls = new Array<string>()
    const files = await fetchMergeRequestDiffs(
      connection(async url => {
        urls.push(url)
        return url.includes('/diffs')
          ? { status: 404, json: async () => ({ message: '404 Not found' }) }
          : {
              status: 200,
              json: async () => ({
                changes: [{ old_path: 'a', new_path: 'a', diff: '@@' }],
              }),
            }
      }),
      1,
      2
    )
    assert.deepEqual(files, [{ oldPath: 'a', newPath: 'a', diff: '@@' }])
    assert.ok(urls[1].endsWith('/projects/1/merge_requests/2/changes'))
  })
})

describe('getDiffExcerpt', () => {
  const files: ReadonlyArray<IGitLabDiffFile> = [
    {
      oldPath: 'src/a.ts',
      newPath: 'src/a.ts',
      diff: [
        '@@ -1,2 +1,2 @@',
        ' first',
        '-old second',
        '+new second',
        '@@ -10,5 +10,6 @@ function f() {',
        ' ten',
        ' eleven',
        '-twelve',
        '+TWELVE',
        '+twelve and a half',
        ' thirteen',
        '\\ No newline at end of file',
      ].join('\n'),
    },
  ]

  const at = (p: Partial<IGitLabNotePosition>): IGitLabNotePosition => ({
    oldPath: 'src/a.ts',
    newPath: 'src/a.ts',
    oldLine: null,
    newLine: null,
    startOldLine: null,
    startNewLine: null,
    headSha: null,
    ...p,
  })

  const show = (lines: ReturnType<typeof getDiffExcerpt>) =>
    lines?.map(l => `${l.commented ? '>' : ' '}${l.kind[0]} ${l.text}`)

  it('shows the commented line with context from the same hunk', () => {
    assert.deepEqual(show(getDiffExcerpt(files, at({ newLine: 13 }))), [
      ' c eleven',
      ' d twelve',
      ' a TWELVE',
      '>a twelve and a half',
    ])
    // Context doesn't reach into the previous hunk.
    assert.deepEqual(show(getDiffExcerpt(files, at({ newLine: 10 }))), [
      '>c ten',
    ])
  })

  it('finds removed lines by their old line number', () => {
    assert.deepEqual(show(getDiffExcerpt(files, at({ oldLine: 12 }), 1)), [
      ' c eleven',
      '>d twelve',
    ])
  })

  it('marks every line of a multi-line comment', () => {
    assert.deepEqual(
      show(getDiffExcerpt(files, at({ newLine: 13, startNewLine: 12 }), 0)),
      ['>a TWELVE', '>a twelve and a half']
    )
  })

  it('returns null when the line is not in the diff', () => {
    assert.equal(getDiffExcerpt(files, at({ newLine: 99 })), null)
    assert.equal(
      getDiffExcerpt(
        files,
        at({ oldPath: 'other.ts', newPath: 'other.ts', newLine: 1 })
      ),
      null
    )
  })
})

describe('linkGitLabReferences', () => {
  const link = (md: string) =>
    linkGitLabReferences(
      md,
      'http://localhost:8929/team/api',
      'http://localhost:8929'
    )

  it('links merge requests, issues and people', () => {
    assert.equal(
      link('Fixes #3, see !12 (thanks @jane.doe)'),
      'Fixes [#3](http://localhost:8929/team/api/-/issues/3), see [!12](http://localhost:8929/team/api/-/merge_requests/12) (thanks [@jane.doe](http://localhost:8929/jane.doe))'
    )
  })

  it('points uploads at the project', () => {
    assert.equal(
      link('![shot](/uploads/abc/shot.png)'),
      '![shot](http://localhost:8929/team/api/uploads/abc/shot.png)'
    )
  })

  it('leaves code, emails and headings alone', () => {
    const md = [
      '# Title',
      'mail me@example.com or run `git log #3`',
      '```',
      'see !12 and @jane',
      '```',
    ].join('\n')
    assert.equal(link(md), md)
  })
})

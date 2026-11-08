import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  MarkdownEdit,
  applyMarkdownEdit,
} from '../../../src/lib/gitlab/gitlab-markdown-edit'

/** `|` marks the cursor, `[` `]` a selection, in input and expected text. */
function run(input: string, edit: MarkdownEdit) {
  const start = input.search(/[|[]/)
  const clean = input.replace(/[|[\]]/g, '')
  const end = input.includes('[') ? input.indexOf(']') - 1 : start
  const r = applyMarkdownEdit(clean, start, end, edit)
  const t = r.text
  return r.selectionStart === r.selectionEnd
    ? t.slice(0, r.selectionStart) + '|' + t.slice(r.selectionStart)
    : t.slice(0, r.selectionStart) +
        '[' +
        t.slice(r.selectionStart, r.selectionEnd) +
        ']' +
        t.slice(r.selectionEnd)
}

describe('applyMarkdownEdit', () => {
  it('wraps and unwraps the selection', () => {
    assert.equal(run('say [hi] now', 'bold'), 'say **[hi]** now')
    assert.equal(run('say **[hi]** now', 'bold'), 'say [hi] now')
    assert.equal(run('say [**hi**] now', 'bold'), 'say [hi] now')
    assert.equal(run('a|b', 'italic'), 'a_|_b')
    assert.equal(run('[x]', 'strike'), '~~[x]~~')
  })

  it('uses inline code for one line and a block for several', () => {
    assert.equal(run('run [ls]', 'code'), 'run `[ls]`')
    assert.equal(run('[a\nb]', 'code'), '```\n[a\nb]\n```\n')
  })

  it('makes links and selects what to type next', () => {
    assert.equal(run('[docs]', 'link'), '[docs]([url])')
    assert.equal(run('[https://x.io]', 'link'), '[|](https://x.io)')
  })

  it('toggles list and quote prefixes on every selected line', () => {
    assert.equal(run('[a\nb]', 'bullets'), '[- a\n- b]')
    assert.equal(run('[- a\n- b]', 'bullets'), '[a\nb]')
    assert.equal(run('[a\nb]', 'numbers'), '[1. a\n2. b]')
    assert.equal(run('[- a]', 'tasks'), '[- [ ] a]')
    assert.equal(run('hi|', 'quote'), '> hi|')
  })

  it('continues lists on Enter and ends them on an empty item', () => {
    assert.equal(run('- a|', 'newline'), '- a\n- |')
    assert.equal(run('1. a|', 'newline'), '1. a\n2. |')
    const task = '  - [x] done'
    assert.deepEqual(
      applyMarkdownEdit(task, task.length, task.length, 'newline'),
      {
        text: `${task}\n  - [ ] `,
        selectionStart: task.length + 9,
        selectionEnd: task.length + 9,
      }
    )
    assert.equal(run('> q|', 'newline'), '> q\n> |')
    assert.equal(run('- a\n- |', 'newline'), '- a\n|')
    assert.equal(run('plain|', 'newline'), 'plain|')
  })
})

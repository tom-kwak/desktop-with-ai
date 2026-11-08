/** A formatting action of the markdown editor. */
export type MarkdownEdit =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'link'
  | 'quote'
  | 'bullets'
  | 'numbers'
  | 'tasks'
  /** Enter: continue or end a list or quote. */
  | 'newline'

export interface IMarkdownEditResult {
  readonly text: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

const result = (
  text: string,
  selectionStart: number,
  selectionEnd = selectionStart
): IMarkdownEditResult => ({ text, selectionStart, selectionEnd })

/** Wrap the selection in `marker`, or unwrap it if it's already wrapped. */
function toggleWrap(
  text: string,
  start: number,
  end: number,
  marker: string
): IMarkdownEditResult {
  const n = marker.length
  const before = text.slice(0, start)
  const selected = text.slice(start, end)
  const after = text.slice(end)

  if (before.endsWith(marker) && after.startsWith(marker)) {
    return result(
      before.slice(0, -n) + selected + after.slice(n),
      start - n,
      end - n
    )
  }
  if (
    selected.length >= 2 * n &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(n, -n)
    return result(before + inner + after, start, start + inner.length)
  }
  return result(before + marker + selected + marker + after, start + n, end + n)
}

function code(text: string, start: number, end: number) {
  const selected = text.slice(start, end)
  if (!selected.includes('\n')) {
    return toggleWrap(text, start, end, '`')
  }
  const before = text.slice(0, start)
  const lead = before.length === 0 || before.endsWith('\n') ? '' : '\n'
  const block = `${lead}\`\`\`\n${selected}\n\`\`\`\n`
  const inner = start + lead.length + 4
  return result(
    before + block + text.slice(end),
    inner,
    inner + selected.length
  )
}

function link(text: string, start: number, end: number) {
  const selected = text.slice(start, end)
  const before = text.slice(0, start)
  const after = text.slice(end)
  if (/^https?:\/\/\S+$/.test(selected)) {
    // Selected a URL: ask for the text.
    return result(`${before}[](${selected})${after}`, start + 1)
  }
  const url = 'url'
  const urlStart = start + selected.length + 3
  return result(
    `${before}[${selected}](${url})${after}`,
    urlStart,
    urlStart + url.length
  )
}

/** The start of the line containing `index`. */
const lineStart = (text: string, index: number) =>
  text.lastIndexOf('\n', index - 1) + 1

/** The end of the line containing `index`, before its line break. */
function lineEnd(text: string, index: number) {
  const i = text.indexOf('\n', index)
  return i === -1 ? text.length : i
}

const linePrefixes: Record<
  'quote' | 'bullets' | 'numbers' | 'tasks',
  { readonly match: RegExp; readonly make: (i: number) => string }
> = {
  quote: { match: /^> ?/, make: () => '> ' },
  bullets: { match: /^[-*+] (?!\[[ xX]\] )/, make: () => '- ' },
  numbers: { match: /^\d+\. /, make: i => `${i + 1}. ` },
  tasks: { match: /^[-*+] \[[ xX]\] /, make: () => '- [ ] ' },
}

/** Add a prefix to every selected line, or remove it if all have it. */
function toggleLinePrefix(
  text: string,
  start: number,
  end: number,
  kind: keyof typeof linePrefixes
) {
  const { match, make } = linePrefixes[kind]
  const from = lineStart(text, start)
  // A selection ending right after a line break doesn't include the next line.
  const to = lineEnd(
    text,
    end > start && text[end - 1] === '\n' ? end - 1 : end
  )
  const lines = text.slice(from, to).split('\n')
  const remove = lines.every(l => match.test(l))

  const changed = lines.map((l, i) =>
    remove
      ? l.replace(match, '')
      : make(i) + l.replace(/^(> ?|[-*+] (\[[ xX]\] )?|\d+\. )/, '')
  )
  const replaced = changed.join('\n')
  const newText = text.slice(0, from) + replaced + text.slice(to)

  if (start === end && lines.length === 1) {
    const cursor = start + (replaced.length - lines[0].length)
    return result(newText, Math.max(from, cursor))
  }
  return result(newText, from, from + replaced.length)
}

/**
 * Enter at the end of a list item or quote starts the next one, like
 * GitLab's editor; Enter on an empty item ends the list instead.
 */
function newline(text: string, cursor: number): IMarkdownEditResult {
  const from = lineStart(text, cursor)
  const line = text.slice(from, cursor)
  const m = /^(\s*)(> |[-*+] \[[ xX]\] |[-*+] |(\d+)\. )(.*)$/.exec(line)
  if (m === null) {
    return result(text, cursor)
  }
  const [, indent, marker, num, content] = m

  if (content.trim().length === 0) {
    // An empty item ends the list.
    return result(text.slice(0, from) + text.slice(cursor), from)
  }

  const next =
    num !== undefined
      ? `${parseInt(num, 10) + 1}. `
      : marker.includes('[')
      ? marker.replace(/\[[xX]\]/, '[ ]')
      : marker
  const insert = `\n${indent}${next}`
  return result(
    text.slice(0, cursor) + insert + text.slice(cursor),
    cursor + insert.length
  )
}

/** Apply a formatting action to `text` with the given selection. */
export function applyMarkdownEdit(
  text: string,
  start: number,
  end: number,
  edit: MarkdownEdit
): IMarkdownEditResult {
  switch (edit) {
    case 'bold':
      return toggleWrap(text, start, end, '**')
    case 'italic':
      return toggleWrap(text, start, end, '_')
    case 'strike':
      return toggleWrap(text, start, end, '~~')
    case 'code':
      return code(text, start, end)
    case 'link':
      return link(text, start, end)
    case 'quote':
    case 'bullets':
    case 'numbers':
    case 'tasks':
      return toggleLinePrefix(text, start, end, edit)
    case 'newline':
      return newline(text, start)
  }
}

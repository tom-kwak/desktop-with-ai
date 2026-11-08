/** What kind of event a GitLab system note records, for its icon. */
export type SystemNoteKind =
  | 'approved'
  | 'unapproved'
  | 'resolved'
  | 'commits'
  | 'edited'
  | 'review'
  | 'people'
  | 'merged'
  | 'closed'
  | 'reopened'
  | 'draft'
  | 'label'
  | 'mention'
  | 'pipeline'
  | 'other'

export interface ISystemNoteSummary {
  readonly kind: SystemNoteKind
  /** The event in one line, without markdown, e.g. "added 2 commits". */
  readonly text: string
  /** Extra lines GitLab lists, such as the added commits. */
  readonly details: ReadonlyArray<string>
}

const kinds: ReadonlyArray<[RegExp, SystemNoteKind]> = [
  [/^unapproved/, 'unapproved'],
  [/^approved/, 'approved'],
  [/^resolved|^unresolved/, 'resolved'],
  [/^added \d+ commit|^added \d+ new commit/, 'commits'],
  [
    /^changed (the )?(description|title|target branch)|^changed title/,
    'edited',
  ],
  [/review|^requested changes/, 'review'],
  [/^assigned|^unassigned|^removed assignee/, 'people'],
  [
    /^merged|^enabled an automatic merge|^aborted the automatic merge|^set to auto-merge/,
    'merged',
  ],
  [/^closed/, 'closed'],
  [/^reopened/, 'reopened'],
  [/draft|ready/, 'draft'],
  [/label/, 'label'],
  [/^mentioned in|^marked .* as a duplicate|^created branch/, 'mention'],
  [/pipeline/, 'pipeline'],
]

/** Markdown and inline HTML reduced to plain text. */
function plain(text: string) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Summarize a GitLab system note. Bodies are markdown with some HTML; for
 * new commits GitLab adds a `<ul>` of them and a "Compare" link.
 */
export function describeSystemNote(body: string): ISystemNoteSummary {
  const [firstLine, ...rest] = body.trim().split('\n')
  const text = plain(firstLine)
  const lower = text.toLowerCase()
  const kind = kinds.find(([re]) => re.test(lower))?.[1] ?? 'other'

  const restText = rest.join('\n')
  const items = Array.from(restText.matchAll(/<li>([\s\S]*?)<\/li>/g)).map(m =>
    plain(m[1])
  )
  const details =
    items.length > 0
      ? items
      : kind === 'commits'
      ? []
      : rest
          .map(plain)
          .filter(l => l.length > 0 && !/^compare with/i.test(l))
          .slice(0, 5)

  return { kind, text, details: details.filter(d => d.length > 0) }
}

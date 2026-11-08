import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { RelativeTime } from '../relative-time'
import { IGitLabNote } from '../../lib/gitlab/gitlab-merge-requests'
import { describeSystemNote } from '../../lib/gitlab/gitlab-system-notes'
import { UserAvatar } from './gitlab-mr-common'

const icons = {
  approved: octicons.thumbsup,
  unapproved: octicons.thumbsdown,
  resolved: octicons.checkCircle,
  commits: octicons.gitCommit,
  edited: octicons.pencil,
  review: octicons.eye,
  people: octicons.person,
  merged: octicons.gitMerge,
  closed: octicons.gitPullRequestClosed,
  reopened: octicons.gitPullRequest,
  draft: octicons.gitPullRequestDraft,
  label: octicons.tag,
  mention: octicons.crossReference,
  pipeline: octicons.rocket,
  other: octicons.dotFill,
}

/**
 * GitLab's recorded events (approvals, resolved threads, new commits…) as
 * a compact timeline between comments, like GitLab's activity feed.
 */
export function GitLabMREvents(props: {
  readonly notes: ReadonlyArray<IGitLabNote>
}) {
  return (
    <ol className="gl-events">
      {props.notes.map(note => {
        const event = describeSystemNote(note.body)
        return (
          <li key={note.id} className={`gl-event gl-event-${event.kind}`}>
            <span className="gl-event-icon">
              <Octicon symbol={icons[event.kind]} />
            </span>
            <span className="gl-event-text">
              {note.author !== null && (
                <>
                  <UserAvatar user={note.author} size="small" />
                  <strong>{note.author.name}</strong>{' '}
                </>
              )}
              {event.text}
              {note.createdAt !== '' && (
                <span className="gl-meta">
                  {' · '}
                  <RelativeTime date={new Date(note.createdAt)} />
                </span>
              )}
              {event.details.length > 0 && (
                <ul className="gl-event-details">
                  {event.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

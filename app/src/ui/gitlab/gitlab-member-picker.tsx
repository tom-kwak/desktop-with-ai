import * as React from 'react'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { TextBox } from '../lib/text-box'
import { IGitLabMember } from '../../lib/gitlab/gitlab-merge-request-actions'
import { UserAvatar } from './gitlab-mr-common'

interface IGitLabMemberPickerProps {
  readonly label: string
  readonly members: ReadonlyArray<IGitLabMember> | null
  readonly selected: ReadonlyArray<IGitLabMember>
  readonly onChange: (selected: ReadonlyArray<IGitLabMember>) => void
  readonly disabled?: boolean
}

interface IGitLabMemberPickerState {
  readonly open: boolean
  readonly query: string
}

/** People picked as chips, with a searchable list to add more. */
export class GitLabMemberPicker extends React.Component<
  IGitLabMemberPickerProps,
  IGitLabMemberPickerState
> {
  public state: IGitLabMemberPickerState = { open: false, query: '' }

  private toggleOpen = () => this.setState(s => ({ open: !s.open, query: '' }))

  private onQueryChanged = (query: string) => this.setState({ query })

  private onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter in the search box shouldn't submit the surrounding form.
    if (event.key === 'Enter') {
      event.preventDefault()
      return
    }
    if (event.key === 'Escape' && this.state.open) {
      event.preventDefault()
      event.stopPropagation()
      this.setState({ open: false })
    }
  }

  private remove = (member: IGitLabMember) => () =>
    this.props.onChange(this.props.selected.filter(m => m.id !== member.id))

  private toggle = (member: IGitLabMember) => () => {
    const { selected } = this.props
    this.props.onChange(
      selected.some(m => m.id === member.id)
        ? selected.filter(m => m.id !== member.id)
        : [...selected, member]
    )
  }

  public render() {
    const { label, selected, disabled } = this.props
    return (
      <div className="gl-member-picker">
        <div className="gl-member-picker-header">
          <span className="gl-field-label">{label}</span>
          <button
            type="button"
            className="gl-link-button"
            onClick={this.toggleOpen}
            disabled={disabled}
            aria-expanded={this.state.open}
          >
            {this.state.open ? 'Done' : 'Edit'}
          </button>
        </div>
        <div className="gl-member-chips">
          {selected.length === 0 ? (
            <span className="gl-meta">None</span>
          ) : (
            selected.map(m => (
              <span key={m.id} className="gl-member-chip">
                <UserAvatar user={m} size="small" />
                {m.name}
                {!disabled && (
                  <button
                    type="button"
                    aria-label={`Remove ${m.name}`}
                    onClick={this.remove(m)}
                  >
                    <Octicon symbol={octicons.x} />
                  </button>
                )}
              </span>
            ))
          )}
        </div>
        {this.state.open && this.renderOptions()}
      </div>
    )
  }

  private renderOptions() {
    const { members, selected } = this.props
    if (members === null) {
      return <div className="gl-member-options gl-meta">Loading people…</div>
    }
    const query = this.state.query.trim().toLowerCase()
    const shown = members.filter(
      m =>
        query.length === 0 ||
        m.name.toLowerCase().includes(query) ||
        m.username.toLowerCase().includes(query)
    )
    return (
      <div className="gl-member-options">
        <TextBox
          placeholder="Search people"
          value={this.state.query}
          onValueChanged={this.onQueryChanged}
          onKeyDown={this.onKeyDown}
          autoFocus={true}
        />
        <ul>
          {shown.map(m => {
            const isSelected = selected.some(s => s.id === m.id)
            return (
              <li key={m.id}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={isSelected}
                  className={classNames({ selected: isSelected })}
                  onClick={this.toggle(m)}
                >
                  <span className="gl-check">
                    {isSelected && <Octicon symbol={octicons.check} />}
                  </span>
                  <UserAvatar user={m} size="small" />
                  <span>{m.name}</span>
                  <span className="gl-meta">@{m.username}</span>
                </button>
              </li>
            )
          })}
          {shown.length === 0 && <li className="gl-meta">No one found.</li>}
        </ul>
      </div>
    )
  }
}

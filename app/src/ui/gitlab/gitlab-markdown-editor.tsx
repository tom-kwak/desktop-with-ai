import * as React from 'react'
import classNames from 'classnames'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { GitLabMarkdown } from './gitlab-markdown'
import {
  MarkdownEdit,
  applyMarkdownEdit,
} from '../../lib/gitlab/gitlab-markdown-edit'

interface IGitLabMarkdownEditorProps {
  readonly value: string
  readonly onChange: (value: string) => void
  /** Names the text box for screen readers, and shows when it's empty. */
  readonly placeholder: string
  readonly label?: string
  readonly minRows?: number
  readonly autoFocus?: boolean
  readonly disabled?: boolean
  /** ⌘/Ctrl+Enter. */
  readonly onSubmitShortcut?: () => void
  /** Escape. */
  readonly onCancelShortcut?: () => void
}

interface IGitLabMarkdownEditorState {
  readonly tab: 'write' | 'preview'
  readonly focused: boolean
}

interface IToolbarButton {
  readonly edit: MarkdownEdit
  readonly icon: typeof octicons.bold
  readonly label: string
  readonly shortcut?: string
}

const mod = __DARWIN__ ? '⌘' : 'Ctrl+'

const toolbar: ReadonlyArray<ReadonlyArray<IToolbarButton>> = [
  [
    { edit: 'bold', icon: octicons.bold, label: 'Bold', shortcut: `${mod}B` },
    {
      edit: 'italic',
      icon: octicons.italic,
      label: 'Italic',
      shortcut: `${mod}I`,
    },
    {
      edit: 'strike',
      icon: octicons.strikethrough,
      label: 'Strikethrough',
    },
  ],
  [
    { edit: 'quote', icon: octicons.quote, label: 'Quote' },
    { edit: 'code', icon: octicons.code, label: 'Code', shortcut: `${mod}E` },
    { edit: 'link', icon: octicons.link, label: 'Link', shortcut: `${mod}K` },
  ],
  [
    { edit: 'bullets', icon: octicons.listUnordered, label: 'Bulleted list' },
    { edit: 'numbers', icon: octicons.listOrdered, label: 'Numbered list' },
    { edit: 'tasks', icon: octicons.tasklist, label: 'Task list' },
  ],
]

const shortcutEdits: Record<string, MarkdownEdit> = {
  b: 'bold',
  i: 'italic',
  e: 'code',
  k: 'link',
}

/**
 * A markdown text box like GitLab's: Write and Preview tabs, a formatting
 * toolbar, keyboard shortcuts, list continuation on Enter, and a height
 * that grows with the text.
 */
export class GitLabMarkdownEditor extends React.Component<
  IGitLabMarkdownEditorProps,
  IGitLabMarkdownEditorState
> {
  public state: IGitLabMarkdownEditorState = { tab: 'write', focused: false }

  private textArea: HTMLTextAreaElement | null = null
  private pendingSelection: [number, number] | null = null

  public componentDidMount() {
    this.resize()
  }

  public componentDidUpdate(prevProps: IGitLabMarkdownEditorProps) {
    if (prevProps.value !== this.props.value) {
      this.resize()
    }
    if (this.pendingSelection !== null && this.textArea !== null) {
      const [start, end] = this.pendingSelection
      this.pendingSelection = null
      this.textArea.focus()
      this.textArea.setSelectionRange(start, end)
    }
  }

  /** Put the cursor in the text box, e.g. after opening a reply. */
  public focus() {
    this.textArea?.focus()
  }

  private resize() {
    const ta = this.textArea
    if (ta === null) {
      return
    }
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight + 2, 420)}px`
  }

  private onTextAreaRef = (ta: HTMLTextAreaElement | null) => {
    this.textArea = ta
    this.resize()
  }

  private onChange = (event: React.ChangeEvent<HTMLTextAreaElement>) =>
    this.props.onChange(event.currentTarget.value)

  private onFocus = () => this.setState({ focused: true })
  private onBlur = () => this.setState({ focused: false })

  private apply(edit: MarkdownEdit) {
    const ta = this.textArea
    if (ta === null || this.props.disabled) {
      return
    }
    const result = applyMarkdownEdit(
      this.props.value,
      ta.selectionStart,
      ta.selectionEnd,
      edit
    )
    this.pendingSelection = [result.selectionStart, result.selectionEnd]
    this.props.onChange(result.text)
  }

  private onToolbarClick = (edit: MarkdownEdit) => () => {
    if (this.state.tab === 'preview') {
      this.setState({ tab: 'write' }, () => this.apply(edit))
    } else {
      this.apply(edit)
    }
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const cmd = __DARWIN__ ? event.metaKey : event.ctrlKey

    if (event.key === 'Enter' && cmd) {
      event.preventDefault()
      this.props.onSubmitShortcut?.()
      return
    }

    if (event.key === 'Escape' && this.props.onCancelShortcut !== undefined) {
      event.preventDefault()
      event.stopPropagation()
      this.props.onCancelShortcut()
      return
    }

    const edit =
      cmd && !event.shiftKey && !event.altKey
        ? shortcutEdits[event.key.toLowerCase()]
        : undefined
    if (edit !== undefined) {
      event.preventDefault()
      this.apply(edit)
      return
    }

    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !cmd &&
      !event.nativeEvent.isComposing
    ) {
      const ta = event.currentTarget
      if (ta.selectionStart === ta.selectionEnd) {
        const result = applyMarkdownEdit(
          this.props.value,
          ta.selectionStart,
          ta.selectionEnd,
          'newline'
        )
        if (result.text !== this.props.value) {
          event.preventDefault()
          this.pendingSelection = [result.selectionStart, result.selectionEnd]
          this.props.onChange(result.text)
        }
      }
    }
  }

  private showWrite = () =>
    this.setState({ tab: 'write' }, () => this.textArea?.focus())

  private showPreview = () => this.setState({ tab: 'preview' })

  public render() {
    const { tab, focused } = this.state
    const { label, disabled } = this.props

    return (
      <div
        className={classNames('gl-editor', {
          focused,
          disabled,
        })}
      >
        {label !== undefined && <div className="gl-field-label">{label}</div>}
        <div className="gl-editor-frame">
          <div className="gl-editor-header">
            <div className="gl-editor-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'write'}
                className={classNames({ selected: tab === 'write' })}
                onClick={this.showWrite}
              >
                Write
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'preview'}
                className={classNames({ selected: tab === 'preview' })}
                onClick={this.showPreview}
              >
                Preview
              </button>
            </div>
            <div className="gl-editor-toolbar" role="toolbar">
              {toolbar.map((group, i) => (
                <div key={i} className="gl-editor-toolbar-group">
                  {group.map(b => (
                    <button
                      key={b.edit}
                      type="button"
                      aria-label={
                        b.shortcut ? `${b.label} (${b.shortcut})` : b.label
                      }
                      onClick={this.onToolbarClick(b.edit)}
                      disabled={disabled}
                      tabIndex={-1}
                    >
                      <Octicon symbol={b.icon} />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
          {tab === 'write' ? (
            <textarea
              ref={this.onTextAreaRef}
              className="gl-editor-input"
              aria-label={label ?? this.props.placeholder}
              placeholder={this.props.placeholder}
              value={this.props.value}
              onChange={this.onChange}
              onKeyDown={this.onKeyDown}
              onFocus={this.onFocus}
              onBlur={this.onBlur}
              rows={this.props.minRows ?? 3}
              disabled={disabled}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus={this.props.autoFocus}
              spellCheck={true}
            />
          ) : (
            <div className="gl-editor-preview">
              {this.props.value.trim().length > 0 ? (
                <GitLabMarkdown markdown={this.props.value} title="Preview" />
              ) : (
                <span className="gl-meta">Nothing to preview.</span>
              )}
            </div>
          )}
          <div className="gl-editor-footer">
            <Octicon symbol={octicons.markdown} />
            <span>
              Markdown supported · {mod}B bold · {mod}I italic · {mod}K link
            </span>
          </div>
        </div>
      </div>
    )
  }
}

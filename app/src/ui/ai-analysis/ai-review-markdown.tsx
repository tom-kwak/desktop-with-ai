import * as React from 'react'
import { SandboxedMarkdown } from '../lib/sandboxed-markdown'
import { openExternal } from '../main-process-proxy'
import { Emoji } from '../../lib/emoji'

/** A review isn't expected to contain emoji shortcodes, so none are resolved. */
const NoEmoji = new Map<string, Emoji>()

/**
 * Headings sized for a dialog rather than a full page, matching the compact
 * style used for other Copilot summaries.
 */
const ReviewMarkdownCSS = `
  .markdown-body h1,
  .markdown-body h2,
  .markdown-body h3 {
    font-size: 1.1em;
    margin-top: 1em;
    margin-bottom: 0.25em;
    padding-bottom: 0;
    border-bottom: none;
  }
  .markdown-body > :first-child {
    margin-top: 0;
  }
`

interface IAIReviewMarkdownProps {
  readonly markdown: string
}

/**
 * A review rendered as sanitized markdown, scrolling within its container.
 * Links open in the external browser.
 */
export class AIReviewMarkdown extends React.Component<IAIReviewMarkdownProps> {
  private onLinkClicked = (url: string) => {
    openExternal(url)
  }

  public render() {
    return (
      <div className="ai-analysis-text">
        <SandboxedMarkdown
          markdown={this.props.markdown}
          emoji={NoEmoji}
          underlineLinks={true}
          title="AI review"
          customCSS={ReviewMarkdownCSS}
          onMarkdownLinkClicked={this.onLinkClicked}
        />
      </div>
    )
  }
}

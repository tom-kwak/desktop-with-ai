import * as React from 'react'
import { SandboxedMarkdown } from '../lib/sandboxed-markdown'
import { openExternal } from '../main-process-proxy'
import { Emoji } from '../../lib/emoji'
import { linkGitLabReferences } from '../../lib/gitlab/gitlab-markdown'

/** Where GitLab references and uploads in markdown point to. */
export interface IGitLabMarkdownLinks {
  readonly projectURL: string
  readonly serverURL: string
}

/** Set by the merge request page so every comment links the same way. */
export const GitLabMarkdownContext =
  React.createContext<IGitLabMarkdownLinks | null>(null)

const NoEmoji = new Map<string, Emoji>()

/** Sized for comments in a dialog rather than a full page. */
const CommentCSS = `
  html, body, .markdown-body {
    margin: 0;
    padding: 0;
  }
  .markdown-body { font-size: 13px; line-height: 1.6; }
  .markdown-body p, .markdown-body ul, .markdown-body ol,
  .markdown-body blockquote, .markdown-body table {
    margin-top: 0;
    margin-bottom: 0.6em;
  }
  .markdown-body pre {
    margin: 0.4em 0 0.6em;
    padding: 10px 12px;
    border-radius: 4px;
  }
  .markdown-body blockquote {
    padding: 0 0.8em;
  }
  .markdown-body > :first-child { margin-top: 0; }
  .markdown-body > :last-child { margin-bottom: 0; }
  .markdown-body h1, .markdown-body h2 {
    font-size: 1.3em;
    padding-bottom: 0.2em;
  }
  .markdown-body h3, .markdown-body h4,
  .markdown-body h5, .markdown-body h6 {
    font-size: 1.1em;
  }
  .markdown-body h1, .markdown-body h2, .markdown-body h3,
  .markdown-body h4, .markdown-body h5, .markdown-body h6 {
    margin-top: 0.8em;
    margin-bottom: 0.4em;
  }
  .markdown-body img { max-width: 100%; }
`

/**
 * The color actually painted behind `element`: the first ancestor with a
 * non-transparent background. The sandboxed frame can't be see-through
 * (Chromium paints it white), so it gets this color instead.
 */
function backgroundBehind(element: HTMLElement): string | null {
  for (
    let el: HTMLElement | null = element;
    el !== null;
    el = el.parentElement
  ) {
    const color = getComputedStyle(el).backgroundColor
    if (
      color !== '' &&
      color !== 'transparent' &&
      !/rgba\(.*,\s*0\)$/.test(color)
    ) {
      return color
    }
  }
  return null
}

interface IGitLabMarkdownState {
  /** CSS for the frame, set once the surrounding colors are known. */
  readonly css: string | null
}

interface IGitLabMarkdownProps {
  readonly markdown: string
  /** Read by screen readers as the frame's name. */
  readonly title: string
}

/**
 * GitLab markdown (descriptions and comments), sanitized and rendered in a
 * sandbox. References like `!12`, `#3` and `@user` become links, and links
 * open in the browser.
 */
export class GitLabMarkdown extends React.Component<
  IGitLabMarkdownProps,
  IGitLabMarkdownState
> {
  public static contextType = GitLabMarkdownContext
  public declare context: React.ContextType<typeof GitLabMarkdownContext>

  public state: IGitLabMarkdownState = { css: null }

  private container: HTMLDivElement | null = null

  public componentDidMount() {
    // The frame only reads its CSS when it first renders, so wait for the
    // colors of where it sits before rendering it.
    const el = this.container
    if (el === null) {
      return
    }
    const background = backgroundBehind(el)
    const color = getComputedStyle(el).color
    this.setState({
      css: `${CommentCSS}
        html, body, .markdown-body {
          ${background !== null ? `background-color: ${background};` : ''}
          ${color !== '' ? `color: ${color};` : ''}
        }`,
    })
  }

  private onContainerRef = (el: HTMLDivElement | null) => {
    this.container = el
  }

  private onLinkClicked = (url: string) => {
    openExternal(url)
  }

  public render() {
    const links = this.context
    const markdown =
      links === null
        ? this.props.markdown
        : linkGitLabReferences(
            this.props.markdown,
            links.projectURL,
            links.serverURL
          )

    return (
      <div className="gl-markdown" ref={this.onContainerRef}>
        {this.state.css !== null && (
          <SandboxedMarkdown
            markdown={markdown}
            baseHref={links === null ? undefined : `${links.projectURL}/`}
            emoji={NoEmoji}
            underlineLinks={true}
            title={this.props.title}
            customCSS={this.state.css}
            onMarkdownLinkClicked={this.onLinkClicked}
          />
        )}
      </div>
    )
  }
}

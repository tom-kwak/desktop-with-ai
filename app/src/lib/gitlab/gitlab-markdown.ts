/**
 * Turn GitLab's short references in markdown into links, the way GitLab
 * renders them: `!12` (merge request), `#3` (issue), `@user`, and file
 * uploads, which GitLab writes as `/uploads/...` relative to the project.
 *
 * Code spans and fenced code blocks are left as they are.
 */
export function linkGitLabReferences(
  markdown: string,
  projectURL: string,
  serverURL: string
): string {
  const project = projectURL.replace(/\/+$/, '')
  const server = serverURL.replace(/\/+$/, '')

  const linkText = (text: string) =>
    text
      .replace(/(\]\(|src=["'])\/uploads\//g, `$1${project}/uploads/`)
      .replace(
        /(^|[\s([{])!(\d+)\b/g,
        (_, pre, n) => `${pre}[!${n}](${project}/-/merge_requests/${n})`
      )
      .replace(
        /(^|[\s([{])#(\d+)\b/g,
        (_, pre, n) => `${pre}[#${n}](${project}/-/issues/${n})`
      )
      .replace(
        /(^|[\s([{])@([A-Za-z0-9_][A-Za-z0-9_.-]*[A-Za-z0-9_])/g,
        (_, pre, user) => `${pre}[@${user}](${server}/${user})`
      )

  const out = new Array<string>()
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      out.push(line)
    } else if (inFence) {
      out.push(line)
    } else {
      // Split out inline code so references inside it stay plain.
      out.push(
        line
          .split(/(`[^`]*`)/)
          .map(part => (part.startsWith('`') ? part : linkText(part)))
          .join('')
      )
    }
  }
  return out.join('\n')
}

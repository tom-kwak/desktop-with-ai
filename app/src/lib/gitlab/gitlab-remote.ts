import { IGitLabAccount } from './gitlab-accounts-store'

/** A repository remote that points at a project on a signed-in GitLab server. */
export interface IGitLabRemoteMatch {
  readonly account: IGitLabAccount
  /** For example `group/subgroup/project`. */
  readonly projectPath: string
}

interface IParsedRemote {
  readonly kind: 'http' | 'ssh'
  /** Host with port for http(s) remotes, host name only for SSH ones. */
  readonly host: string
  /** The path after the host, without leading slash or `.git`. */
  readonly path: string
}

function trimProjectPath(path: string) {
  return path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
}

/**
 * Parse a Git remote URL into host and path. Unlike the GitHub remote
 * parser this keeps every path segment, because GitLab projects can sit in
 * nested groups (`group/subgroup/project`).
 */
export function parseGitRemoteURL(remoteURL: string): IParsedRemote | null {
  const url = remoteURL.trim()

  // scp-like SSH: git@host:group/project.git
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(url)
  if (scp !== null && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return {
      kind: 'ssh',
      host: scp[1].toLowerCase(),
      path: trimProjectPath(scp[2]),
    }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const path = trimProjectPath(decodeURIComponent(parsed.pathname))
  if (path.length === 0) {
    return null
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return { kind: 'http', host: parsed.host.toLowerCase(), path }
  }

  if (parsed.protocol === 'ssh:' || parsed.protocol === 'git+ssh:') {
    return { kind: 'ssh', host: parsed.hostname.toLowerCase(), path }
  }

  return null
}

/**
 * Find the signed-in GitLab account a remote belongs to, and the project
 * path on that server.
 *
 * HTTP(S) remotes must match the server's host and port (and its path
 * prefix, for GitLab installed under a sub-path). SSH remotes usually use
 * another port, so only the host name is compared.
 */
export function matchGitLabRemote(
  remoteURL: string,
  accounts: ReadonlyArray<IGitLabAccount>
): IGitLabRemoteMatch | null {
  const remote = parseGitRemoteURL(remoteURL)
  if (remote === null) {
    return null
  }

  for (const account of accounts) {
    const server = new URL(account.serverURL)
    const prefix = trimProjectPath(server.pathname)

    const hostMatches =
      remote.kind === 'http'
        ? remote.host === server.host.toLowerCase()
        : remote.host === server.hostname.toLowerCase()
    if (!hostMatches) {
      continue
    }

    let projectPath = remote.path
    if (remote.kind === 'http' && prefix.length > 0) {
      if (!projectPath.startsWith(`${prefix}/`)) {
        continue
      }
      projectPath = projectPath.slice(prefix.length + 1)
    }

    // A GitLab project path always has a namespace and a name.
    if (projectPath.split('/').filter(s => s.length > 0).length < 2) {
      continue
    }

    return { account, projectPath }
  }

  return null
}

/**
 * The signed-in GitLab account for the URL Git asks credentials for.
 *
 * Git usually sends only protocol and host, so a host match is enough; when
 * it also sends a path, it has to sit under the server's path prefix.
 */
export function findGitLabAccountForCredentialURL(
  url: URL,
  accounts: ReadonlyArray<IGitLabAccount>
): IGitLabAccount | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null
  }
  const path = trimProjectPath(decodeURIComponent(url.pathname))

  for (const account of accounts) {
    const server = new URL(account.serverURL)
    if (
      server.protocol !== url.protocol ||
      server.host.toLowerCase() !== url.host.toLowerCase()
    ) {
      continue
    }
    const prefix = trimProjectPath(server.pathname)
    if (
      path.length > 0 &&
      prefix.length > 0 &&
      path !== prefix &&
      !path.startsWith(`${prefix}/`)
    ) {
      continue
    }
    return account
  }
  return null
}

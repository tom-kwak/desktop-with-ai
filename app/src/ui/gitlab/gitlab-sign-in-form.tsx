import * as React from 'react'
import { Form } from '../lib/form'
import { TextBox } from '../lib/text-box'
import { PasswordTextBox } from '../lib/password-text-box'
import { Button } from '../lib/button'
import { Loading } from '../lib/loading'
import { Errors } from '../lib/errors'
import { LinkButton } from '../lib/link-button'
import {
  DefaultGitLabServerURL,
  getGitLabTokenSettingsURL,
  normalizeGitLabServerURL,
} from '../../lib/gitlab/gitlab-server-url'
import { IGitLabAccount } from '../../lib/gitlab/gitlab-accounts-store'
import { getGitLabAccountsStore } from '../../lib/gitlab/gitlab-accounts'

interface IGitLabSignInFormProps {
  /** Called after the token is verified and the account is saved. */
  readonly onSignedIn: (account: IGitLabAccount) => void

  /** Buttons to show after the "Sign in" button, such as Cancel. */
  readonly additionalButtons?: ReadonlyArray<JSX.Element>

  /** Whether the server address field should take focus when shown. */
  readonly autoFocus?: boolean
}

interface IGitLabSignInFormState {
  readonly serverAddress: string
  readonly token: string
  readonly loading: boolean
  readonly error: Error | null
}

/** Signs in to a GitLab server with a personal access token. */
export class GitLabSignInForm extends React.Component<
  IGitLabSignInFormProps,
  IGitLabSignInFormState
> {
  private mounted = false

  public constructor(props: IGitLabSignInFormProps) {
    super(props)
    this.state = {
      serverAddress: DefaultGitLabServerURL,
      token: '',
      loading: false,
      error: null,
    }
  }

  public componentDidMount() {
    this.mounted = true
  }

  public componentWillUnmount() {
    this.mounted = false
  }

  public render() {
    const { serverAddress, token, loading, error } = this.state
    const canSubmit =
      serverAddress.trim().length > 0 && token.trim().length > 0 && !loading

    return (
      <Form className="gitlab-sign-in-form" onSubmit={this.onSubmit}>
        <TextBox
          label="GitLab server address"
          value={serverAddress}
          autoFocus={this.props.autoFocus}
          disabled={loading}
          onValueChanged={this.onServerAddressChanged}
          placeholder={DefaultGitLabServerURL}
        />

        <PasswordTextBox
          label="Personal access token"
          value={token}
          disabled={loading}
          onValueChanged={this.onTokenChanged}
          placeholder="glpat-…"
        />

        <p className="gitlab-token-help">
          {this.renderTokenSettingsLink()} with the <code>api</code> scope, or a
          fine-grained token with the <code>User: Read</code> permission. The
          token is stored in your system keychain.
        </p>

        {error !== null ? <Errors>{error.message}</Errors> : null}

        <div className="actions">
          <Button type="submit" disabled={!canSubmit}>
            {loading ? <Loading /> : null} Sign in
          </Button>
          {this.props.additionalButtons}
        </div>
      </Form>
    )
  }

  private renderTokenSettingsLink() {
    let tokenSettingsURL: string | null = null
    try {
      tokenSettingsURL = getGitLabTokenSettingsURL(
        normalizeGitLabServerURL(this.state.serverAddress)
      )
    } catch {
      tokenSettingsURL = null
    }

    return tokenSettingsURL === null ? (
      'Create a personal access token'
    ) : (
      <LinkButton uri={tokenSettingsURL}>
        Create a personal access token
      </LinkButton>
    )
  }

  private onServerAddressChanged = (serverAddress: string) => {
    this.setState({ serverAddress, error: null })
  }

  private onTokenChanged = (token: string) => {
    this.setState({ token, error: null })
  }

  private onSubmit = async () => {
    const { serverAddress, token } = this.state
    this.setState({ loading: true, error: null })

    try {
      const account = await getGitLabAccountsStore().signIn(
        serverAddress,
        token
      )
      if (this.mounted) {
        this.setState({ loading: false, token: '' })
      }
      this.props.onSignedIn(account)
    } catch (e) {
      if (this.mounted) {
        this.setState({
          loading: false,
          error: e instanceof Error ? e : new Error(String(e)),
        })
      }
    }
  }
}

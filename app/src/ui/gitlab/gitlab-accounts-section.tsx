import * as React from 'react'
import { Disposable } from 'event-kit'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { CallToAction } from '../lib/call-to-action'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { GitLabSignInForm } from './gitlab-sign-in-form'
import { IGitLabAccount } from '../../lib/gitlab/gitlab-accounts-store'
import {
  getGitLabAccountsStore,
  getGitLabSettings,
} from '../../lib/gitlab/gitlab-accounts'

interface IGitLabAccountsSectionState {
  readonly accounts: ReadonlyArray<IGitLabAccount>
  readonly showSignInForm: boolean
  readonly enabled: boolean
}

/**
 * The GitLab part of Preferences > Accounts: the switch for all GitLab
 * features and, while it's on, the signed-in GitLab accounts, signing out,
 * and signing in to another server with a personal access token.
 */
export class GitLabAccountsSection extends React.Component<
  {},
  IGitLabAccountsSectionState
> {
  private subscriptions = new Array<Disposable>()

  public constructor(props: {}) {
    super(props)
    this.state = {
      accounts: getGitLabAccountsStore().getAll(),
      showSignInForm: false,
      enabled: getGitLabSettings().isEnabled(),
    }
  }

  public componentDidMount() {
    this.subscriptions.push(
      getGitLabAccountsStore().onDidUpdate(accounts =>
        this.setState({ accounts })
      ),
      getGitLabSettings().onDidChange(enabled => this.setState({ enabled }))
    )
  }

  public componentWillUnmount() {
    this.subscriptions.forEach(s => s.dispose())
    this.subscriptions = []
  }

  public render() {
    const { accounts, showSignInForm, enabled } = this.state

    return (
      <div className="gitlab-accounts">
        <Checkbox
          label="Enable GitLab integration"
          value={enabled ? CheckboxValue.On : CheckboxValue.Off}
          onChange={this.onEnabledChanged}
        />
        <p className="gitlab-enable-description">
          Adds GitLab sign-in, a GitLab tab when cloning, and merge requests for
          repositories hosted on a signed-in GitLab server.
        </p>
        {enabled && (
          <>
            {accounts.map(this.renderAccount)}
            {showSignInForm
              ? this.renderSignInForm()
              : this.renderSignInAction()}
          </>
        )}
      </div>
    )
  }

  private onEnabledChanged = (event: React.FormEvent<HTMLInputElement>) => {
    getGitLabSettings().setEnabled(event.currentTarget.checked)
  }

  private renderAccount = (account: IGitLabAccount) => {
    return (
      <Row className="account-info" key={account.serverURL}>
        <div className="user-info-container">
          <div className="user-info">
            <div className="account-title">
              {account.name === account.username
                ? `@${account.username}`
                : `@${account.username} (${account.name})`}
            </div>
            <div className="endpoint">{account.serverURL}</div>
          </div>
        </div>
        <Button onClick={this.signOut(account)}>
          {__DARWIN__ ? 'Sign Out' : 'Sign out'}
        </Button>
      </Row>
    )
  }

  private renderSignInAction() {
    if (this.state.accounts.length > 0) {
      return <Button onClick={this.showSignInForm}>Add GitLab account</Button>
    }

    return (
      <CallToAction
        actionTitle={(__DARWIN__ ? 'Sign Into' : 'Sign into') + ' GitLab'}
        onAction={this.showSignInForm}
      >
        <div>
          Sign in to gitlab.com or your own GitLab server with a personal access
          token.
        </div>
      </CallToAction>
    )
  }

  private renderSignInForm() {
    return (
      <GitLabSignInForm
        autoFocus={true}
        onSignedIn={this.hideSignInForm}
        additionalButtons={[
          <Button key="cancel" onClick={this.hideSignInForm}>
            Cancel
          </Button>,
        ]}
      />
    )
  }

  private showSignInForm = () => {
    this.setState({ showSignInForm: true })
  }

  private hideSignInForm = () => {
    this.setState({ showSignInForm: false })
  }

  private signOut = (account: IGitLabAccount) => {
    return () => {
      getGitLabAccountsStore()
        .signOut(account)
        .catch(e => log.error('[GitLab] sign out failed', e))
    }
  }
}

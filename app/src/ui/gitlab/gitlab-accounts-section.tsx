import * as React from 'react'
import { Disposable } from 'event-kit'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { CallToAction } from '../lib/call-to-action'
import { GitLabSignInForm } from './gitlab-sign-in-form'
import { IGitLabAccount } from '../../lib/gitlab/gitlab-accounts-store'
import { getGitLabAccountsStore } from '../../lib/gitlab/gitlab-accounts'

interface IGitLabAccountsSectionState {
  readonly accounts: ReadonlyArray<IGitLabAccount>
  readonly showSignInForm: boolean
}

/**
 * The GitLab part of Preferences > Accounts: the signed-in GitLab accounts,
 * signing out, and signing in to another server with a personal access token.
 */
export class GitLabAccountsSection extends React.Component<
  {},
  IGitLabAccountsSectionState
> {
  private subscription: Disposable | null = null

  public constructor(props: {}) {
    super(props)
    this.state = {
      accounts: getGitLabAccountsStore().getAll(),
      showSignInForm: false,
    }
  }

  public componentDidMount() {
    this.subscription = getGitLabAccountsStore().onDidUpdate(accounts =>
      this.setState({ accounts })
    )
  }

  public componentWillUnmount() {
    this.subscription?.dispose()
    this.subscription = null
  }

  public render() {
    const { accounts, showSignInForm } = this.state

    return (
      <div className="gitlab-accounts">
        {accounts.map(this.renderAccount)}
        {showSignInForm ? this.renderSignInForm() : this.renderSignInAction()}
      </div>
    )
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

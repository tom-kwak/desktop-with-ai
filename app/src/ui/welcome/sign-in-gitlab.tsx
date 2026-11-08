import * as React from 'react'
import { WelcomeStep } from './welcome'
import { Button } from '../lib/button'
import { GitLabSignInForm } from '../gitlab/gitlab-sign-in-form'

interface ISignInGitLabProps {
  readonly advance: (step: WelcomeStep) => void
}

/** The Welcome flow step to sign in to GitLab with a personal access token. */
export class SignInGitLab extends React.Component<ISignInGitLabProps> {
  public render() {
    return (
      <section id="sign-in-gitlab" aria-label="Sign in to GitLab">
        <h1 className="welcome-title">Sign in to GitLab</h1>
        <p className="welcome-text">
          Enter your GitLab server and a personal access token. Use gitlab.com
          or your organization's own GitLab.
        </p>

        <GitLabSignInForm
          autoFocus={true}
          onSignedIn={this.onSignedIn}
          additionalButtons={[
            <Button key="cancel" onClick={this.cancel}>
              Cancel
            </Button>,
          ]}
        />
      </section>
    )
  }

  private onSignedIn = () => {
    this.props.advance(WelcomeStep.ConfigureGit)
  }

  private cancel = () => {
    this.props.advance(WelcomeStep.Start)
  }
}

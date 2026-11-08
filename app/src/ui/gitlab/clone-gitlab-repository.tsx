import * as React from 'react'
import memoizeOne from 'memoize-one'
import { Disposable } from 'event-kit'
import { DialogContent } from '../dialog'
import { Row } from '../lib/row'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import { Select } from '../lib/select'
import { SectionFilterList } from '../lib/section-filter-list'
import { IFilterListGroup } from '../lib/filter-list'
import { HighlightText } from '../lib/highlight-text'
import { TooltippedContent } from '../lib/tooltipped-content'
import { LinkButton } from '../lib/link-button'
import { Ref } from '../lib/ref'
import { ClickSource } from '../lib/list'
import { Octicon, syncClockwise } from '../octicons'
import { IMatches } from '../../lib/fuzzy-find'
import { IGitLabAccount } from '../../lib/gitlab/gitlab-accounts-store'
import {
  IGitLabProject,
  IGitLabProjectsState,
} from '../../lib/gitlab/gitlab-projects'
import {
  getGitLabAccountsStore,
  getGitLabProjectsStore,
} from '../../lib/gitlab/gitlab-accounts'
import {
  ICloneableRepositoryListItem,
  YourRepositoriesIdentifier,
} from '../clone-repository/group-repositories'
import { groupGitLabProjects } from './group-gitlab-projects'

const RowHeight = 31

interface ICloneGitLabRepositoryProps {
  /** The local path to clone to. */
  readonly path: string
  readonly onPathChanged: (path: string) => void
  readonly onChooseDirectory: () => Promise<string | undefined>

  readonly filterText: string
  readonly onFilterTextChanged: (filterText: string) => void

  /** The server of the account to list, or null for the first account. */
  readonly selectedServerURL: string | null
  readonly onSelectedServerChanged: (serverURL: string) => void

  readonly selectedProject: IGitLabProject | null
  readonly onSelectionChanged: (project: IGitLabProject | null) => void

  /** Called when a project is activated, e.g. with Enter. */
  readonly onProjectClicked: (
    project: IGitLabProject,
    source: ClickSource
  ) => void
}

interface ICloneGitLabRepositoryState {
  readonly accounts: ReadonlyArray<IGitLabAccount>
  /** Bumped whenever a project list changes, to re-render. */
  readonly projectsVersion: number
}

/**
 * The GitLab tab of the clone dialog: the user's projects on a server.
 *
 * The dialog only shows this tab while a GitLab account is signed in.
 */
export class CloneGitLabRepository extends React.Component<
  ICloneGitLabRepositoryProps,
  ICloneGitLabRepositoryState
> {
  private subscriptions = new Array<Disposable>()

  private getGroups = memoizeOne(
    (projects: ReadonlyArray<IGitLabProject> | null, username: string) =>
      projects === null ? [] : groupGitLabProjects(projects, username)
  )

  private getSelectedListItem = memoizeOne(
    (
      groups: ReadonlyArray<IFilterListGroup<ICloneableRepositoryListItem>>,
      project: IGitLabProject | null
    ) => {
      if (project === null) {
        return null
      }
      for (const group of groups) {
        const item = group.items.find(i => i.url === project.httpCloneURL)
        if (item !== undefined) {
          return item
        }
      }
      return null
    }
  )

  public constructor(props: ICloneGitLabRepositoryProps) {
    super(props)
    this.state = {
      accounts: getGitLabAccountsStore().getAll(),
      projectsVersion: 0,
    }
  }

  public componentDidMount() {
    this.subscriptions.push(
      getGitLabAccountsStore().onDidUpdate(accounts =>
        this.setState({ accounts })
      ),
      getGitLabProjectsStore().onDidUpdate(() =>
        this.setState(s => ({ projectsVersion: s.projectsVersion + 1 }))
      )
    )
    this.loadIfNeeded()
  }

  public componentDidUpdate() {
    this.loadIfNeeded()
  }

  public componentWillUnmount() {
    this.subscriptions.forEach(s => s.dispose())
    this.subscriptions = []
  }

  private get selectedAccount(): IGitLabAccount | null {
    const { accounts } = this.state
    return (
      accounts.find(a => a.serverURL === this.props.selectedServerURL) ??
      accounts.at(0) ??
      null
    )
  }

  private getProjectsState(): IGitLabProjectsState | undefined {
    const account = this.selectedAccount
    return account === null
      ? undefined
      : getGitLabProjectsStore().getState(account)
  }

  /** Load the selected account's projects the first time they're shown. */
  private loadIfNeeded() {
    const account = this.selectedAccount
    if (account !== null && this.getProjectsState() === undefined) {
      getGitLabProjectsStore().load(account)
    }
  }

  private refresh = () => {
    const account = this.selectedAccount
    if (account !== null) {
      getGitLabProjectsStore().load(account)
    }
  }

  public render() {
    const account = this.selectedAccount
    if (account === null) {
      return null
    }

    const projectsState = this.getProjectsState()
    const groups = this.getGroups(
      projectsState?.projects ?? null,
      account.username
    )

    return (
      <DialogContent className="clone-github-repository-content clone-gitlab-repository-content">
        {this.state.accounts.length > 1 && (
          <Row className="account-picker-row">
            <Select
              label="GitLab account"
              value={account.serverURL}
              onChange={this.onAccountChanged}
            >
              {this.state.accounts.map(a => (
                <option key={a.serverURL} value={a.serverURL}>
                  @{a.username} — {a.serverURL}
                </option>
              ))}
            </Select>
          </Row>
        )}

        <Row>
          <SectionFilterList<ICloneableRepositoryListItem>
            className="clone-github-repo"
            rowHeight={RowHeight}
            selectedItem={this.getSelectedListItem(
              groups,
              this.props.selectedProject
            )}
            renderItem={this.renderItem}
            renderGroupHeader={this.renderGroupHeader}
            onSelectionChanged={this.onListSelectionChanged}
            invalidationProps={groups}
            groups={groups}
            filterText={this.props.filterText}
            onFilterTextChanged={this.props.onFilterTextChanged}
            renderNoItems={this.renderNoItems}
            renderPostFilter={this.renderPostFilter}
            onItemClick={this.onItemClick}
            placeholderText="Filter your projects"
            getGroupAriaLabel={this.getGroupAriaLabelGetter(groups)}
          />
        </Row>

        <Row className="local-path-field">
          <TextBox
            value={this.props.path}
            label={__DARWIN__ ? 'Local Path' : 'Local path'}
            placeholder="repository path"
            onValueChanged={this.props.onPathChanged}
          />
          <Button onClick={this.props.onChooseDirectory}>Choose…</Button>
        </Row>
      </DialogContent>
    )
  }

  private onAccountChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    this.props.onSelectedServerChanged(event.currentTarget.value)
  }

  private findProject(item: ICloneableRepositoryListItem) {
    const projects = this.getProjectsState()?.projects ?? []
    return projects.find(p => p.httpCloneURL === item.url) ?? null
  }

  private onListSelectionChanged = (
    item: ICloneableRepositoryListItem | null
  ) => {
    this.props.onSelectionChanged(item === null ? null : this.findProject(item))
  }

  private onItemClick = (
    item: ICloneableRepositoryListItem,
    source: ClickSource
  ) => {
    const project = this.findProject(item)
    if (project !== null) {
      this.props.onProjectClicked(project, source)
    }
  }

  private getYourRepositoriesLabel() {
    return __DARWIN__ ? 'Your Repositories' : 'Your repositories'
  }

  private getGroupAriaLabelGetter =
    (groups: ReadonlyArray<IFilterListGroup<ICloneableRepositoryListItem>>) =>
    (group: number) => {
      const identifier = groups[group].identifier
      return identifier === YourRepositoriesIdentifier
        ? this.getYourRepositoriesLabel()
        : identifier
    }

  private renderGroupHeader = (identifier: string) => {
    return (
      <div className="clone-repository-list-content clone-repository-list-group-header">
        {identifier === YourRepositoriesIdentifier
          ? this.getYourRepositoriesLabel()
          : identifier}
      </div>
    )
  }

  private renderItem = (
    item: ICloneableRepositoryListItem,
    matches: IMatches
  ) => {
    return (
      <div className="clone-repository-list-item">
        <Octicon className="icon" symbol={item.icon} />
        <TooltippedContent
          className="name"
          tooltip={item.text[0]}
          onlyWhenOverflowed={true}
          tagName="div"
        >
          <HighlightText text={item.text[0]} highlight={matches.title} />
        </TooltippedContent>
      </div>
    )
  }

  private renderPostFilter = () => {
    const loading = this.getProjectsState()?.loading ?? false
    const tooltip = 'Refresh the list of projects'
    return (
      <Button
        disabled={loading}
        onClick={this.refresh}
        ariaLabel={tooltip}
        tooltip={tooltip}
      >
        <Octicon
          symbol={syncClockwise}
          className={loading ? 'spin' : undefined}
        />
      </Button>
    )
  }

  private renderNoItems = () => {
    const account = this.selectedAccount
    const state = this.getProjectsState()
    if (account === null) {
      return null
    }

    if (state?.error) {
      return (
        <div className="no-items empty-repository-list">
          <div>
            {state.error.message}{' '}
            <LinkButton onClick={this.refresh}>Try again</LinkButton>
          </div>
        </div>
      )
    }

    if (state === undefined || (state.loading && !state.projects?.length)) {
      return (
        <div className="no-items loading">{`Loading projects from ${account.serverURL}…`}</div>
      )
    }

    if (this.props.filterText.length !== 0) {
      return (
        <div className="no-items no-results-found">
          <div>
            Sorry, I can't find any project matching{' '}
            <Ref>{this.props.filterText}</Ref>
          </div>
        </div>
      )
    }

    return (
      <div className="no-items empty-repository-list">
        <div>
          Looks like <Ref>{account.username}</Ref> isn't a member of any
          projects on {account.serverURL}.{' '}
          <LinkButton onClick={this.refresh}>Refresh this list</LinkButton> if
          you've created one recently.
        </div>
      </div>
    )
  }
}

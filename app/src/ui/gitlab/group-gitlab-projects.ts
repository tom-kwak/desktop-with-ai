import entries from 'lodash/entries'
import groupBy from 'lodash/groupBy'
import { IGitLabProject } from '../../lib/gitlab/gitlab-projects'
import { caseInsensitiveEquals, compare } from '../../lib/compare'
import { IFilterListGroup } from '../lib/filter-list'
import * as octicons from '../octicons/octicons.generated'
import {
  ICloneableRepositoryListItem,
  YourRepositoriesIdentifier,
} from '../clone-repository/group-repositories'

/**
 * Group GitLab projects for the clone dialog the way GitHub repositories are
 * grouped: the user's personal projects first under "Your repositories",
 * then one group per group/subgroup path, each sorted by name.
 */
export function groupGitLabProjects(
  projects: ReadonlyArray<IGitLabProject>,
  username: string
): ReadonlyArray<IFilterListGroup<ICloneableRepositoryListItem>> {
  const groups = groupBy(projects, p =>
    p.isPersonal && caseInsensitiveEquals(p.namespacePath, username)
      ? YourRepositoriesIdentifier
      : p.namespacePath
  )

  return entries(groups)
    .map(([identifier, items]) => ({
      identifier,
      items: items
        .map<ICloneableRepositoryListItem>(p => ({
          id: p.webURL,
          text: [p.pathWithNamespace],
          name: p.name,
          url: p.httpCloneURL,
          icon: p.visibility === 'private' ? octicons.lock : octicons.repo,
        }))
        .sort((x, y) => compare(x.name, y.name)),
    }))
    .sort((x, y) => {
      if (x.identifier === YourRepositoriesIdentifier) {
        return -1
      } else if (y.identifier === YourRepositoriesIdentifier) {
        return 1
      } else {
        return compare(x.identifier, y.identifier)
      }
    })
}

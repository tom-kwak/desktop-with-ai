import { Disposable, Emitter } from 'event-kit'
import { IDataStore } from '../stores/stores'

/** The local storage key for the GitLab integration switch. */
export const GitLabEnabledStorageKey = 'reviewdesk-gitlab-enabled'

/**
 * The switch that turns every GitLab feature on or off: GitLab sign-in, the
 * GitLab clone tab and merge requests. Off by default, so the app behaves
 * like GitHub Desktop until the user opts in.
 */
export class GitLabSettings {
  private readonly emitter = new Emitter()

  public constructor(private readonly dataStore: IDataStore) {}

  public isEnabled(): boolean {
    return this.dataStore.getItem(GitLabEnabledStorageKey) === '1'
  }

  public setEnabled(enabled: boolean) {
    if (enabled === this.isEnabled()) {
      return
    }
    this.dataStore.setItem(GitLabEnabledStorageKey, enabled ? '1' : '0')
    this.emitter.emit('did-change', enabled)
  }

  /** Call `fn` with the new value whenever the switch changes. */
  public onDidChange(fn: (enabled: boolean) => void): Disposable {
    return this.emitter.on('did-change', fn)
  }
}

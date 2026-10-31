import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { AISettingsDialog } from '../../../src/ui/ai-analysis/ai-settings-dialog'
import { getAIReviewDatabase } from '../../../src/lib/ai/ai-review-database'
import { DialogStackContext } from '../../../src/ui/dialog/dialog'
import { Repository } from '../../../src/models/repository'
import { render, screen, fireEvent, waitFor } from '../../helpers/ui/render'

const fail = async () => {
  throw new Error('storage failed')
}

describe('AISettingsDialog', () => {
  let view: ReturnType<typeof render> | undefined
  let restore: (() => void) | undefined

  beforeEach(async () => {
    const electron = await import('electron')
    const previousSend = electron.ipcRenderer.send
    electron.ipcRenderer.send = () => {}
    const { showModal, close } = HTMLDialogElement.prototype
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function () {
      this.open = false
    }
    restore = () => {
      electron.ipcRenderer.send = previousSend
      HTMLDialogElement.prototype.showModal = showModal
      HTMLDialogElement.prototype.close = close
    }

    await getAIReviewDatabase().settings.clear()
  })

  afterEach(() => {
    view?.unmount()
    view = undefined
    restore?.()
  })

  function renderDialog(onDismissed: () => void) {
    view = render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <AISettingsDialog
          repository={new Repository('/tmp/repo', 1, null, false)}
          onDismissed={onDismissed}
        />
      </DialogStackContext.Provider>
    )
  }

  it('hides the form when the settings cannot be loaded', async () => {
    const get = mock.method(getAIReviewDatabase().settings, 'get', fail)
    try {
      renderDialog(() => {})

      await waitFor(() => screen.getByText(/couldn't be loaded/))
      assert.equal(screen.queryByLabelText('Agent'), null)
      const save = screen.getByRole('button', { name: 'Save' })
      assert.equal(save.getAttribute('aria-disabled'), 'true')
    } finally {
      get.mock.restore()
    }
  })

  it('can save again after a failed save', async () => {
    let dismissed = 0
    renderDialog(() => dismissed++)
    await waitFor(() => screen.getByLabelText('Agent'))

    const put = mock.method(getAIReviewDatabase().settings, 'put', fail)
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => screen.getByText(/storage failed/))
    } finally {
      put.mock.restore()
    }

    assert.equal(dismissed, 0)
    assert.ok(screen.getByLabelText('Agent'))

    const save = screen.getByRole('button', { name: 'Save' })
    assert.equal(save.getAttribute('aria-disabled'), null)
    fireEvent.click(save)
    await waitFor(() => assert.equal(dismissed, 1))
  })
})

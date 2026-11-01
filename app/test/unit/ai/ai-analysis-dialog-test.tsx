import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'
import { chmod, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { AIAnalysisDialog } from '../../../src/ui/ai-analysis/ai-analysis-dialog'
import { getAIReviewDatabase } from '../../../src/lib/ai/ai-review-database'
import { DialogStackContext } from '../../../src/ui/dialog/dialog'
import { Repository } from '../../../src/models/repository'
import { render, screen, waitFor } from '../../helpers/ui/render'

describe('AIAnalysisDialog', { skip: process.platform === 'win32' }, () => {
  const previousShell = process.env.SHELL
  let view: ReturnType<typeof render> | undefined
  let restore: (() => void) | undefined
  let directory: string
  let restoreStylesheet: (() => void) | undefined

  beforeEach(async () => {
    // The stylesheet of the rendered review only exists in a build.
    const files: typeof import('fs/promises') = require('fs/promises')
    const readFile = mock.method(files, 'readFile', async () => '')
    restoreStylesheet = () => readFile.mock.restore()

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

    // Stands in for the login shell, and so for the agent it would run.
    directory = await mkdtemp(join(tmpdir(), 'ai-analysis-dialog-'))
    const shell = join(directory, 'fake-shell')
    await writeFile(shell, '#!/bin/sh\ncat > /dev/null\necho "## The review"\n')
    await chmod(shell, 0o755)
    process.env.SHELL = shell

    const db = getAIReviewDatabase()
    await db.reviews.clear()
    await db.settings.clear()
  })

  afterEach(async () => {
    view?.unmount()
    view = undefined
    restore?.()
    restoreStylesheet?.()
    process.env.SHELL = previousShell
    await rm(directory, { recursive: true, force: true })
  })

  function renderDialog() {
    view = render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <AIAnalysisDialog
          repository={new Repository('/tmp/repo', 1, null, false)}
          title="Review"
          subject="1 commit"
          getInput={async () => ({ log: 'log', diff: 'diff' })}
          onDismissed={() => {}}
        />
      </DialogStackContext.Provider>
    )
  }

  it('saves a review and lists it', async () => {
    renderDialog()

    await waitFor(() => screen.getByLabelText('History'))
    assert.equal(screen.queryByText(/couldn't be saved/), null)
    assert.equal(await getAIReviewDatabase().reviews.count(), 1)
  })

  it('still shows the review when the history is unavailable', async () => {
    const { reviews } = getAIReviewDatabase()
    const where = mock.method(reviews, 'where', () => {
      throw new Error('storage failed')
    })

    try {
      renderDialog()

      await waitFor(() => screen.getByText(/couldn't be saved/))
      assert.equal(screen.queryByText(/storage failed/), null)
      assert.ok(document.querySelector('.ai-analysis-text'))
      assert.ok(screen.getByLabelText('History'))
    } finally {
      where.mock.restore()
    }
  })
})

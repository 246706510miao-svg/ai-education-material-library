// Web e2e scenario: assistant IconActions belong to the settled answer, so
// they arrive with `turn/end` and not before. The recorded turn narrates in
// plain text before its tool call, which is the event order that would show the
// footer beside mid-turn narration for the seconds a tool runs and then move it
// down. A `hang` sidecar on the SECOND model call parks the turn after the
// narration and the tool result are durable, so the running state is stable by
// construction rather than by timing; stopping from that park writes the
// `turn/end` that hands the footer to the turn's transcript tail.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed } from 'vitest'
import type { ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/turn-tail-actions', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
// Three goldens for the same message: parked mid-turn, aborted, and completed.
const RUNNING_EXPECTED = join(SNAPSHOT_DIR, 'running.expected.md')
const SETTLED_EXPECTED = join(SNAPSHOT_DIR, 'settled.expected.md')
const USAGE_HIDDEN_EXPECTED = join(SNAPSHOT_DIR, 'usage-hidden.expected.md')
const COMPLETED_EXPECTED = join(SNAPSHOT_DIR, 'completed.expected.md')
const FOCUSED_EXPECTED = join(SNAPSHOT_DIR, 'focused.expected.md')
const MODE = webSnapshotMode()

// The recording must carry text in the SAME assistant message as the tool
// call; a Think-only step would leave nothing for the footer to attach to and
// the scenario would pass against either implementation.
const NARRATION = 'Reading the workspace now.'
const PROMPT = `Begin your reply with the plain sentence "${NARRATION}" as text, and in that same message call the bash tool with the command "echo alpha". After the tool result, reply with the single word DONE and stop.`

describe('web e2e: assistant IconActions wait for the turn to end', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let sessionEvents: SessionEvent[]
  let sidecarDir: string | undefined

  afterEach(async () => {
    // close() carries the fixture-consumption tripwire, so its failure is the
    // scenario's failure; run every teardown step, then rethrow what failed.
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    browser = undefined
    const closing = scaffold
    scaffold = undefined
    await closing?.close().catch((error: unknown) => failures.push(error))
    if (sidecarDir !== undefined) await rm(sidecarDir, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    sidecarDir = undefined
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'turn-tail-actions teardown failed')
  })

  /** Boot scaffold + page, materializing the sidecar before the replay row installs. */
  async function launch(
    buildOverride?: (sidecarHome: string) => ReplayOverrideDoc,
    // Throughput snapshots require a nonzero interval between replayed chunks.
    paceMs = 1,
    compareReplaySession = buildOverride === undefined,
  ): Promise<void> {
    sessionEvents = []
    let overridePath: string | undefined
    if (buildOverride !== undefined) {
      sidecarDir = await mkdtemp(join(tmpdir(), 'dsh-web-e2e-sidecar-'))
      overridePath = join(sidecarDir, 'replay.override.json')
      await writeFile(overridePath, JSON.stringify(buildOverride(sidecarDir)))
    }
    scaffold = await launchWebScaffold(
      MODE === 'record'
        ? {}
        : {
          replayFixture: FIXTURE,
          ...(overridePath === undefined ? {} : { replayOverride: overridePath }),
          compareReplaySession,
          paceMs,
        },
    )
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    const workspace = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspace)
    await scaffold.ctx.workspaceRegistry.create(workspace)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    tripwire = watchConsole(page)
    await page.route('**/api/axisverse/materials/uploads', route => route.fulfill({ json: { items: [] } }))
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
  }

  /** Send the recorded prompt with the settled barrier pre-armed (returned wrapped so the caller can act mid-turn). */
  async function sendPrompt(timeoutMs?: number): Promise<{ settled: ReturnType<WebScaffold['whenTurnSettled']> }> {
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold!.whenTurnSettled(timeoutMs)
    await input.fill(PROMPT)
    await input.press('Enter')
    return { settled }
  }

  it.skipIf(MODE !== 'record')('records the narrate-then-call turn live through the composer', async () => {
    await launch()
    onTestFailed(() => saveFailureShot(page, 'web-e2e-turn-tail-actions-record'))
    const { settled } = await sendPrompt(180_000)
    const sessionId = await settled
    await recordFixture(scaffold!, sessionId, FIXTURE)
  }, 200_000)

  it.skipIf(MODE === 'record')('matches the canonical persisted session', async () => {
    await launch()
    const { settled } = await sendPrompt(30_000)
    await settled
  })

  it.skipIf(MODE === 'record')('revisits recorded questions through student learning history', async () => {
    await launch()
    const { settled } = await sendPrompt(30_000)
    await settled
    const historyEntry = page.locator('summary').filter({ hasText: 'Learning records' })
    await historyEntry.click()
    const history = page.getByRole('region', { name: 'Learning records', exact: true })
    await history.getByRole('article').waitFor()
    expect(await history.getByRole('treeitem').count()).toBe(0)
    await history.getByRole('button', { name: /^Edit the title of/ }).click()
    await page.getByRole('textbox', { name: 'Question title' }).fill('Triple integral definition')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await history.getByRole('button', { name: 'Mark “Triple integral definition” for review' }).click()
    await history.getByRole('region', { name: 'To review', exact: true }).waitFor()
    const snapshot = await captureStableAria(page, 'section[aria-label="Learning records"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'student-history.expected.md'), snapshot, MODE)
    await history.getByRole('searchbox').fill('polar')
    await history.getByText('No matching records').waitFor()
    await history.getByRole('searchbox').fill('triple')
    await history.getByRole('article').waitFor()
    const warningStart = tripwire.warnings.length
    await page.reload()
    await page.locator('summary').filter({ hasText: 'Learning records' }).click()
    await history.getByRole('button', { name: 'Unmark “Triple integral definition” for review' }).waitFor()
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await history.getByRole('button', { name: /^Triple integral definition Triple integrals/ }).click()
    await history.waitFor({ state: 'hidden' })
    await page.getByText('DONE', { exact: true }).waitFor()
    await historyEntry.click()
    await history.getByRole('button', { name: 'Delete the record “Triple integral definition”' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete record', exact: true }).click()
    await history.getByText('Record removed', { exact: true }).waitFor()
    expect(await history.getByRole('article').count()).toBe(0)
    await history.getByRole('button', { name: 'Undo', exact: true }).click()
    await history.getByRole('article').waitFor()
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('opens uploaded course materials from the student navigation', async () => {
    await launch()
    const { settled } = await sendPrompt(30_000)
    await settled
    await page.route('**/api/axisverse/materials', route => route.fulfill({
      json: { items: [{ id: 'doc_uploaded', title: 'Calculus_chapter9_original.pdf', pages: 524, course: 'Calculus', unit: 'Multiple integrals', sources: [{ id: 'doc_first', pageStart: 1, pageCount: 500 }, { id: 'doc_last', pageStart: 501, pageCount: 24 }] }] },
    }))
    expect(await page.getByRole('button', { name: 'Settings', exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: 'Course materials', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Course materials' })
    await panel.getByRole('heading', { name: 'Calculus_chapter9_original.pdf' }).waitFor()
    expect(await panel.getByRole('link', { name: 'View', exact: true }).count()).toBe(0)
    expect(await panel.getByRole('link', { name: 'Download', exact: true }).getAttribute('href')).toBe('/api/axisverse/materials/doc_uploaded/file?download=1')
    const snapshot = await captureStableAria(page, '[role="dialog"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'student-course-materials.expected.md'), snapshot, MODE)
    await page.route('**/api/axisverse/materials/doc_uploaded/outline', route => route.fulfill({ json: { items: [{ title: 'Double integrals', page: 1 }, { title: 'Triple integrals', page: 501 }] } }))
    await panel.getByRole('button', { name: 'Summarize material', exact: true }).click()
    const summary = page.getByRole('dialog', { name: 'Summarize material' })
    await summary.getByRole('checkbox', { name: /Triple integrals/ }).waitFor()
    await summary.getByRole('button', { name: 'Clear all', exact: true }).click()
    expect(await summary.locator('input:checked').count()).toBe(0)
    expect(await summary.getByRole('button', { name: 'Generate summary' }).isDisabled()).toBe(true)
    await summary.getByRole('checkbox', { name: /Triple integrals/ }).check()
    await summary.getByRole('button', { name: 'Select all', exact: true }).click()
    expect(await summary.locator('input:checked').count()).toBe(2)
    const summarySnapshot = await captureStableAria(page, '[role="dialog"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/student-material-summary.expected.md', import.meta.url)), summarySnapshot, MODE)
    await summary.getByRole('button', { name: 'Back to course materials' }).click()
    await page.route('**/api/axisverse/materials/doc_uploaded', route => route.fulfill({ json: { id: 'doc_uploaded' } }))
    await page.route('**/api/axisverse/materials/doc_uploaded/restore', route => route.fulfill({ json: { id: 'doc_uploaded' } }))
    await panel.getByRole('button', { name: 'Delete', exact: true }).click()
    const removal = page.getByRole('dialog', { name: 'Delete material' })
    await removal.getByRole('button', { name: 'Cancel', exact: true }).click()
    await panel.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.route('**/api/axisverse/materials', route => route.fulfill({ json: { items: [] } }))
    await removal.getByRole('button', { name: 'Delete material', exact: true }).click()
    await panel.getByText('No uploaded course materials yet', { exact: true }).waitFor()
    const removedSnapshot = await captureStableAria(page, '[role="dialog"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'student-course-materials-removed.expected.md'), removedSnapshot, MODE)
    await page.route('**/api/axisverse/materials', route => route.fulfill({ json: { items: [{ id: 'doc_uploaded', title: 'Calculus_chapter9_original.pdf', pages: 524, course: 'Calculus', unit: 'Multiple integrals', sources: [{ id: 'doc_first', pageStart: 1, pageCount: 500 }, { id: 'doc_last', pageStart: 501, pageCount: 24 }] }] } }))
    await panel.getByRole('button', { name: 'Undo', exact: true }).click()
    await panel.getByRole('heading', { name: 'Calculus_chapter9_original.pdf' }).waitFor()
    await panel.getByRole('button', { name: 'Ask from material', exact: true }).click()
    await panel.waitFor({ state: 'hidden' })
    await page.getByText('Based only on this material', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Remove material', exact: true }).click()
    expect(await page.getByText('Based only on this material', { exact: true }).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('displays selected material without routing text in the recorded conversation', async () => {
    // This case adds material context to the recorded prompt; assert its admission separately from the response replay.
    let marker = ''
    await launch((sidecarHome) => {
      marker = join(sidecarHome, '.material-ready')
      return { patches: [{ at: 1, entry: { kind: 'hang', readyFile: marker } }] }
    }, 1, false)
    await page.route('**/api/axisverse/materials', route => route.fulfill({
      json: { items: [{ id: 'doc_local_original', title: 'notes_original.pdf', pages: 524, course: 'Calculus', unit: '',
        sources: [{ id: 'doc_first', pageStart: 1, pageCount: 500 }, { id: 'doc_last', pageStart: 501, pageCount: 24 }] }] },
    }))
    await page.getByRole('button', { name: 'Course materials', exact: true }).click()
    await page.getByRole('button', { name: 'Ask from material', exact: true }).click()
    await page.getByText('Based only on this material', { exact: true }).waitFor()
    const { settled } = await sendPrompt(120_000)
    await expect.poll(() => existsSync(marker), { timeout: 20_000 }).toBe(true)
    const recordedInput = JSON.stringify(sessionEvents.filter(event => event.type === 'user/message'))
    expect(recordedInput).toContain('/api/axisverse/materials/doc_local_original/file')
    expect(recordedInput).toContain('/api/axisverse/materials/doc_first/file')
    expect(recordedInput).toContain('/api/axisverse/materials/doc_last/file')
    const userRow = page.locator('[data-chat-flow-kind="user"]')
    await userRow.getByText('notes_original.pdf', { exact: true }).waitFor()
    expect(await userRow.innerText()).not.toContain('/api/')
    expect(await userRow.innerText()).not.toContain('Material page ranges')
    expect(await userRow.innerText()).toContain(PROMPT)
    const input = page.locator('[data-composer-input]').first()
    await input.fill('Explain the next concept from this material.')
    await input.press('ControlOrMeta+Enter')
    const followUp = page.locator('[data-pending-steering]')
    await followUp.getByText('Explain the next concept from this material.', { exact: true }).waitFor()
    expect(await page.locator('[data-chat-flow]').getByText('notes_original.pdf', { exact: true }).count()).toBe(1)
    expect(await followUp.innerText()).not.toContain('notes_original.pdf')
    expect(await followUp.innerText()).not.toContain('/api/')
    const first = await captureStableAria(page, '[data-chat-flow-kind="user"]', scaffold!.workspaceCwd)
    const next = await captureStableAria(page, '[data-pending-steering]', scaffold!.workspaceCwd)
    const snapshot = `${first}\n${next}`
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/student-material-question.expected.md', import.meta.url)), snapshot, MODE)
    await page.getByRole('button', { name: 'Stop generating' }).click()
    await settled
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('keeps simple activity separate from recorded tool details', async () => {
    let marker = ''
    await launch((sidecarHome) => {
      marker = join(sidecarHome, '.simple-ready')
      return { patches: [{ at: 1, entry: { kind: 'hang', readyFile: marker } }] }
    })
    await scaffold!.ctx.settings.update('ui-chat', { transcriptView: 'study' })
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
    })
    const home = await captureStableAria(page, 'body', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'student-home.expected.md'), home, MODE)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.clock.install()
    await page.clock.pauseAt(new Date(Date.now() + 1000))
    const { settled } = await sendPrompt(120_000)
    await page.locator('input[type="range"]:disabled').waitFor({ state: 'attached' })
    expect(await page.getByRole('heading', { name: 'Question → Insight' }).isVisible()).toBe(true)
    expect(await page.locator('[data-study-status]').count()).toBe(0)
    await page.clock.runFor(1200)
    await page.clock.resume()
    await page.getByRole('heading', { name: 'Question → Insight' }).waitFor({ state: 'hidden' })
    await expect.poll(() => existsSync(marker), { timeout: 20_000 }).toBe(true)
    await page.locator('[data-study-status]').waitFor()
    expect(await page.getByRole('status').textContent()).toBe('Thinking…')
    expect(await page.locator('[data-chat-flow-kind="tool-call"]').count()).toBe(0)
    expect(await page.locator('[data-variant="think"]').count()).toBe(0)
    const status = await captureStableAria(page, '[data-study-status]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'simple-status.expected.md'), status, MODE)
    const conversation = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'student-conversation.expected.md'), conversation, MODE)
    await page.getByRole('button', { name: 'Stop generating' }).click()
    await settled
    await page.locator('[data-study-status]').waitFor({ state: 'hidden' })
    expect(await page.locator('[data-study-status]').count()).toBe(0)
    expect(await page.locator('[data-chat-flow-kind="tool-call"]').count()).toBe(0)
    const footer = page.locator('[data-turn-tail]').last()
    await footer.waitFor()
    expect(await footer.getByRole('button').count()).toBe(1)
    expect(await footer.getByRole('button', { name: 'Copy', exact: true }).isVisible()).toBe(true)
    const footerAria = await captureStableAria(page, '[data-turn-tail]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'student-copy-footer.expected.md'), footerAria, MODE)
    await page.getByRole('button', { name: 'Add files or run commands', exact: true }).click()
    expect(await page.getByRole('menuitem').allTextContents()).toEqual(['Upload a problem imageRead a problem or your working', 'Add study materialsSave to my library'])
    const menu = await captureStableAria(page, '[role="menu"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'student-upload-menu.expected.md'), menu, MODE)
    await page.getByRole('menuitem', { name: /Add study materials/ }).click()
    const materialDialog = page.getByRole('dialog', { name: 'Study materials' })
    const uploadId = `doc_local_${'a'.repeat(64)}`
    let indexingFinished = false
    await page.route('**/api/axisverse/materials/upload', route => route.fulfill({ status: 202, json: {
      id: uploadId, uploadId, stored: true, searchable: false, phase: 'recognizing', pollAfterMs: 100, totalPages: 53, completedPages: 2,
    } }))
    await page.route(`**/api/axisverse/materials/uploads/${uploadId}`, route => route.fulfill({ json: indexingFinished
      ? { id: 'doc_uploaded', searchable: true, phase: 'ready' }
      : { id: uploadId, searchable: false, phase: 'recognizing', pollAfterMs: 100, totalPages: 53, completedPages: 2 } }))
    await materialDialog.locator('input[type="file"]').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 fixture') })
    await materialDialog.getByRole('status').filter({ hasText: 'Processing… · 2 / 53 pages' }).waitFor()
    expect(await materialDialog.getByText('Thinking…', { exact: true }).count()).toBe(0)
    const processingAria = await captureStableAria(page, '[role="dialog"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'student-upload-processing.expected.md'), processingAria, MODE)
    await page.route('**/api/axisverse/materials/uploads', route => route.fulfill({ json: { items: [{
      id: uploadId, uploadId, name: 'notes.pdf', size: 15, stored: true, searchable: false,
      phase: 'recognizing', pollAfterMs: 100, totalPages: 53, completedPages: 2,
    }] } }))
    const uploadReloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: 'Add files or run commands', exact: true }).click()
    await page.getByRole('menuitem', { name: /Add study materials/ }).click()
    await materialDialog.getByRole('status').filter({ hasText: 'Processing… · 2 / 53 pages' }).waitFor()
    expect(await materialDialog.getByRole('button', { name: 'Retry', exact: true }).count()).toBe(0)
    acknowledgeReloadConnectionLoss(tripwire, uploadReloadWarnings)
    indexingFinished = true
    await materialDialog.getByText(/Uploaded successfully/).waitFor()
    expect(await materialDialog.getByRole('textbox').count()).toBe(0)
    const materialAnswer = await captureStableAria(page, '[role="dialog"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'student-upload-answer.expected.md'), materialAnswer, MODE)
    await materialDialog.getByRole('button', { name: 'Close study materials' }).click()
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('withholds the footer while the turn runs and grants it at turn/end', async () => {
    expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    let marker = ''
    // Patch the SECOND call: the first one delivers the narration and the tool
    // call as recorded, so the park happens with a durable mid-turn message.
    await launch((sidecarHome) => {
      marker = join(sidecarHome, '.hang-ready')
      return { patches: [{ at: 1, entry: { kind: 'hang', readyFile: marker } }] }
    })
    onTestFailed(() => saveFailureShot(page, 'web-e2e-turn-tail-actions'))
    // The barrier is armed before the park and awaited only after the stop
    // click, so its budget must cover the whole parked phase: marker poll,
    // live-state polls, and two captures with their stability windows. The
    // replay default (30s) leaves no headroom on a slow runner.
    const { settled } = await sendPrompt(120_000)
    // The marker IS the synchronization: the second call is provably parked,
    // so the first step's message and tool result are already durable.
    await expect.poll(() => existsSync(marker), { timeout: 20_000 }).toBe(true)
    expect(await page.locator('[data-turn-process]').count()).toBe(0)
    await expect.poll(
      () => page.getByRole('status').filter({ hasText: 'Deep diving...' }).isVisible(),
      { timeout: 10_000 },
    ).toBe(true)
    await page.locator('[data-streaming="true"]')
      .getByText('partial', { exact: true })
      .waitFor({ timeout: 10_000 })
    // Only the user bubble owns a footer (clock + copy; user bubbles carry no
    // branch action): the narration is not the answer yet.
    const copyButtons = page.getByRole('button', { name: 'Copy' })
    await expect.poll(() => copyButtons.count(), { timeout: 10_000 }).toBe(1)
    expect(await page.getByRole('button', { name: 'Branch into a new conversation' }).count()).toBe(0)
    await copyButtons.first().focus()
    const running = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(RUNNING_EXPECTED, running, MODE)

    // Closing the turn from the park is the state change under test: an
    // aborted turn is durably closed, so its transcript tail (the frozen
    // partial) takes the seat while the mid-turn narration keeps none.
    await page.getByRole('button', { name: 'Stop generating' }).click()
    await settled
    expect(sessionEvents.filter(e => e.type === 'turn/end').map(e => e.data.reason.kind)).toEqual(['aborted'])
    await page.locator('[data-turn-process]').waitFor({ timeout: 10_000 })
    await expect.poll(() => copyButtons.count(), { timeout: 10_000 }).toBe(2)
    await expect.poll(() => page.locator('[data-streaming="true"]').count(), { timeout: 10_000 }).toBe(0)
    await copyButtons.last().focus()
    const settledAria = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(SETTLED_EXPECTED, settledAria, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('keeps completed usage out of the student footer after reload', async () => {
    await launch(undefined, 5)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-turn-usage-hidden'))
    const { settled } = await sendPrompt(120_000)
    await settled
    await page.getByText('DONE', { exact: true }).waitFor()
    await page.locator('[data-turn-tail]').waitFor()
    expect(await page.getByRole('button', { name: /^Usage / }).count()).toBe(0)
    expect(await page.getByRole('button', { name: /^Ran for / }).count()).toBe(0)
    expect(await page.locator('[data-turn-tail]').getByRole('button', { name: 'Copy', exact: true }).isVisible()).toBe(true)
    const footer = await captureStableAria(page, '[data-turn-tail]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(USAGE_HIDDEN_EXPECTED, footer, MODE)

    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.getByText('DONE', { exact: true }).waitFor()
    await page.locator('[data-turn-tail]').waitFor()
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    expect(await page.getByRole('button', { name: /^Usage / }).count()).toBe(0)
    expect(await page.getByRole('button', { name: /^Ran for / }).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('folds the Turn process after the completed reply becomes the answer', async () => {
    await launch(undefined, 5)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-turn-tail-actions-completed'))
    const { settled } = await sendPrompt()
    await settled
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 10_000 }).toBe(1)
    const process = page.locator('[data-turn-process]')
    await expect.poll(() => process.count(), { timeout: 10_000 }).toBe(1)
    expect(await process.getAttribute('aria-expanded')).toBe('false')
    expect(await process.evaluate(element => getComputedStyle(element).borderBottomWidth)).toBe('1px')
    const processBottom = await process.evaluate(element =>
      element.closest<HTMLElement>('[data-chat-flow-kind="turn-process"]')?.getBoundingClientRect().bottom)
    const answerTop = await page.getByText('DONE', { exact: true }).evaluate(element =>
      element.closest<HTMLElement>('[data-chat-flow-kind="assistant-step"]')?.getBoundingClientRect().top)
    expect(answerTop).toBe((processBottom ?? 0) + 8)
    await process.focus()
    const completed = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(COMPLETED_EXPECTED, completed, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('switches a completed Turn between Compact and Normal', async () => {
    await launch()
    onTestFailed(() => saveFailureShot(page, 'web-e2e-turn-process-setting'))
    const { settled } = await sendPrompt()
    await settled
    const process = page.locator('[data-turn-process]')
    const tool = page.getByRole('button', { name: 'Bash Print alpha to stdout' })
    await process.waitFor({ timeout: 10_000 })
    expect(await process.getAttribute('aria-expanded')).toBe('false')
    expect(await tool.isVisible()).toBe(false)

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('button', { name: 'Compact', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Normal', exact: true }).click()
    await page.keyboard.press('Escape')

    await expect.poll(() => process.count(), { timeout: 10_000 }).toBe(0)
    await tool.waitFor({ state: 'visible', timeout: 10_000 })
    await expect.poll(async () => readFile(join(scaffold!.harnessHome, 'settings.yaml'), 'utf8'), { timeout: 5_000 })
      .toMatch(/ui-chat:\n\s+transcriptView: normal/)

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const restored = page.getByRole('dialog', { name: 'Settings' })
    await restored.getByRole('button', { name: 'Normal', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Compact', exact: true }).click()
    await page.keyboard.press('Escape')
    await process.waitFor({ timeout: 10_000 })
    expect(await process.getAttribute('aria-expanded')).toBe('false')
    expect(await tool.isVisible()).toBe(false)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps a focused process member open when the completed reply arrives', async () => {
    await launch(undefined, 200)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-turn-tail-actions-focused'))
    const { settled } = await sendPrompt()
    const tool = page.getByRole('button', { name: 'Bash Print alpha to stdout' })
    await tool.waitFor({ timeout: 30_000 })
    await tool.focus()
    expect(await tool.evaluate(element => element.ownerDocument.activeElement === element)).toBe(true)
    await settled
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 10_000 }).toBe(1)
    const process = page.locator('[data-turn-process]')
    await expect.poll(() => process.count(), { timeout: 10_000 }).toBe(1)
    expect(await process.getAttribute('aria-expanded')).toBe('true')
    expect(await tool.evaluate(element => element.ownerDocument.activeElement === element)).toBe(true)
    const focused = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(FOCUSED_EXPECTED, focused, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps a closed fixture inventory', async () => {
    await assertFixtureInventory(
      SNAPSHOT_DIR,
      [
        'completed.expected.md', 'focused.expected.md', 'running.expected.md', 'session.v3.jsonl',
        'settled.expected.md', 'usage-hidden.expected.md', 'simple-status.expected.md',
        'student-home.expected.md', 'student-conversation.expected.md', 'student-copy-footer.expected.md',
        'student-upload-menu.expected.md', 'student-upload-answer.expected.md',
        'student-upload-processing.expected.md', 'student-course-materials-removed.expected.md',
        'student-history.expected.md', 'student-course-materials.expected.md',
      ],
    )
  })
})

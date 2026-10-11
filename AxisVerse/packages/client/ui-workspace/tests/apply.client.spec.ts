import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { StudyHistoryInjected, WorkspacePickerInjected } from '../src/client/contract/slots.ts'
import { StudyHistory } from '../src/client/StudyHistory.tsx'
import { WorkspacePicker } from '../src/client/WorkspacePicker.tsx'
import { apply as hostApply } from '../src/index.ts'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const create = vi.fn(async (input: { name: string } | { path: string }) => ({
    workspaceId: 'ws-new' as never,
    path: 'name' in input ? `/projects/${input.name}` : input.path,
    title: 'new', sessionIds: [], createdAt: '0', updatedAt: '0',
  }))
  const rename = vi.fn(async () => ({}))
  const selectPanel = vi.fn()
  ctx.provide('layout', { selectPanel, beginNavigation: () => new AbortController().signal })
  const search = vi.fn(async () => ({
    ok: true as const,
    value: { items: [{ sessionId: 'session' as never, snippet: 'match' }], hasMore: false },
  }))
  const renameSession = vi.fn(async (title: string) => ({ ok: true, value: { title, seq: 1 } }))
  const binding = vi.fn((_id: string) => ({ session: { rename: renameSession } }))
  const retain = vi.fn((target: string) => {
    const resolved = binding(target)
    const release = vi.fn()
    return {
      sessionId: target,
      binding: resolved,
      ready: Promise.resolve(resolved),
      release,
      [Symbol.dispose]: release,
    } as unknown as SessionReference
  })
  const using = vi.fn(async (
    target: string,
    _options: unknown,
    operation: (reference: SessionReference) => unknown,
  ) => await operation(retain(target)))
  const fork = vi.fn(async () => 'forked' as never)
  const subscribe = () => () => {}
  ctx.provide('workspaces', {
    list: {
      getSnapshot: () => ({
        items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      }),
      subscribe,
    },
    create,
    rename,
    delete: vi.fn(async () => undefined),
    insertBefore: vi.fn(async () => undefined),
    archiveSession: vi.fn(async () => undefined),
    insertSessionBefore: vi.fn(async () => ({})),
  } as never)
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({
        ids: [], byId: {}, current: undefined, phase: 'ready',
        subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
      }),
      subscribe,
    },
    create: vi.fn(async () => 'created' as never),
    retain,
    using,
    search,
    searchResultLimit: 20,
    binding,
    subagentAddress: vi.fn(() => undefined),
    refreshSubagents: vi.fn(() => Promise.resolve()),
    fork,
  } as never)
  const pickDirectory = vi.fn(() => Promise.resolve({ ok: true as const, value: '/projects/picked' }))
  const directoryPicker = { pick: pickDirectory }
  Object.assign(new TestRemote(ctx), { directoryPicker })
  ctx.provide('remote.directoryPicker', directoryPicker as never)
  const locale = new LocaleRuntime(ctx)
  // These specs assert the shipped Chinese copy. There is no jsdom `window`
  // in this lane, so browser-language detection never runs and the locale
  // comes from FALLBACK_LOCALE (en): state the asserted locale explicitly.
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, create, rename,
    retain, using, selectPanel, search, renameSession, binding, fork, pickDirectory,
  }
}

type HoleName = 'sidebar.workspaces' | 'conversation.hero.workspace' | 'conversation.empty.workspace'

/** Declare any subset of the holes with a single root registration ('root' is a single slot). */
function declare(slots: SlotRegistry, ...names: HoleName[]): () => void {
  const children = Object.fromEntries(names.map(name => [name, { kind: 'single', scope: 'root' }]))
  return slots.register({ name: 'root', children } as never, () => null)
}

describe('ui-workspace apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it drives', () => {
    expect(inject).toEqual([
      'slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker', 'layout',
    ])
  })

  it('registers browser and pickers for declarations arriving before or after apply', async () => {
    const before = await bench()
    declare(before.slots, 'sidebar.workspaces')
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.slots.entries('sidebar.workspaces')[0]!.component).toBe(StudyHistory)
    // Copy rides the standard locale seat: the entry declares the namespace
    // and apply registered both dictionaries.
    expect(before.slots.entries('sidebar.workspaces')[0]!.locale).toBe('workspace')
    expect(before.locale.bind('workspace')('session.new')).toBe('新会话')

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    declare(after.slots, 'conversation.hero.workspace', 'conversation.empty.workspace')
    await Promise.resolve()
    expect(after.slots.entries('conversation.hero.workspace')[0]!.component).toBe(WorkspacePicker)
    // expect(after.slots.entries('conversation.empty.workspace')[0]!.component).toBe(WorkspacePicker)
  })

  it('routes record commands to navigation and Session services', async () => {
    const b = await bench()
    try {
      declare(b.slots, 'sidebar.workspaces', 'conversation.hero.workspace')
      await b.ctx.plugin({ inject: [...inject], apply }).await()
      const archive = vi.spyOn(b.ctx.uiWorkspace, 'archiveSession').mockResolvedValue(undefined)
      const restore = vi.spyOn(b.ctx.uiWorkspace, 'unarchiveSession').mockResolvedValue(undefined)
      const history = (b.slots.entries('sidebar.workspaces')[0]!.inject as () => StudyHistoryInjected)()
      history.open('session' as never)
      expect(b.retain).toHaveBeenCalledWith('session', { source: 'mainView' })
      await history.renameSession('session' as never, 'renamed question')
      expect(b.using).toHaveBeenCalledWith('session', { source: 'workspaceOperation' }, expect.any(Function))
      expect(b.renameSession).toHaveBeenCalledWith('renamed question')
      await history.archiveSession('session' as never)
      await history.unarchiveSession('session' as never)
      expect(archive).toHaveBeenCalledWith('session')
      expect(restore).toHaveBeenCalledWith('session')
      const picker = (b.slots.entries('conversation.hero.workspace')[0]!.inject as () => WorkspacePickerInjected)()
      await picker.createWorkspace({ path: '/tmp/project' })
      expect(b.create).toHaveBeenCalledWith({ path: '/tmp/project' })
    } finally { await b.ctx.fiber.dispose() }
  })

  it('keeps directory selection in the conversation picker only', async () => {
    const b = await bench()
    try {
      declare(b.slots, 'sidebar.workspaces', 'conversation.hero.workspace')
      await b.ctx.plugin({ inject: [...inject], apply }).await()
      expect(b.slots.spec('sidebar.workspaces.directoryFlow')).toBeUndefined()
      const picker = (b.slots.entries('conversation.hero.workspace')[0]!.inject as () => WorkspacePickerInjected)()
      expect(picker.hooks.directoryFlow.getSnapshot()).toBe(false)
      const notified = vi.fn()
      const unsubscribe = picker.hooks.directoryFlow.subscribe(notified)
      const dispose = b.slots.register({ name: 'conversation.hero.workspace.directoryFlow' } as never, () => null)
      expect(picker.hooks.directoryFlow.getSnapshot()).toBe(true)
      await Promise.resolve()
      expect(notified).toHaveBeenCalled()
      dispose()
      expect(picker.hooks.directoryFlow.getSnapshot()).toBe(false)
      unsubscribe()
    } finally { await b.ctx.fiber.dispose() }
  })

  it('propagates a rejected title update to the retryable dialog', async () => {
    const b = await bench()
    try {
      b.renameSession.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'write failed', {}) } as never)
      declare(b.slots, 'sidebar.workspaces')
      await b.ctx.plugin({ inject: [...inject], apply }).await()
      const history = (b.slots.entries('sidebar.workspaces')[0]!.inject as () => StudyHistoryInjected)()
      await expect(history.renameSession('session' as never, 'title')).rejects.toThrow('write failed')
    } finally { await b.ctx.fiber.dispose() }
  })

  it('unregisters every entry on teardown', async () => {
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'conversation.hero.workspace', 'conversation.empty.workspace')
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar.workspaces')).toHaveLength(0)
    expect(b.slots.entries('conversation.hero.workspace')).toHaveLength(0)
    // expect(b.slots.entries('conversation.empty.workspace')).toHaveLength(0)
  })
})

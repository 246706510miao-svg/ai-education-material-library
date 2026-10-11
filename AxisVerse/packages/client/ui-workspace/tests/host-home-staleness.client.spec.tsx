// @vitest-environment jsdom
/** Learning history never exposes Host home paths or Workspace titles. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen } from '@testing-library/react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-workspace/client'

usePinnedBrowserLanguages('zh-CN')

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

/** Test-owned sidebar shell role: declares and renders the browsing region. */
type FrameProps = PropsRenderSlots<'sidebar.workspaces'>
function SidebarFrame({ renderSlot }: FrameProps) {
  return <>{renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })}</>
}

/** The assembled sidebar over one Workspace inside the POSIX home the Host reports. */
async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('layout', { selectPanel: vi.fn() })
  runtime.releaseWorkspaceSource()
  const directoryPicker = {}
  const { remote } = runtime
  remote.provideNamespaces({ directoryPicker })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.workspaces.update((draft) => {
    draft.items = [{
      workspaceId: 'w1' as WorkspaceId, title: 'Project', path: '/home/u/Documents/project',
      sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }] as never
  })
  await runtime.root.declare(
    { 'sidebar.workspaces': { kind: 'single', scope: 'root' } } as never,
    SidebarFrame as never,
  )
  await runtime.mount({ inject: [...inject], apply })
  return { runtime, remote }
}

describe('Host details in assembled learning history', () => {
  it('omits project names and paths before and after a host reconnect', async () => {
    const { runtime, remote } = await bench()
    try {
      remote.$host = { home: undefined, isLoopback: true }
      runtime.renderRoot()
      expect(screen.queryByText('Project')).toBeNull()
      expect(screen.queryByText('/home/u/Documents/project')).toBeNull()
      remote.$host = { home: '/home/u', isLoopback: true }
      act(() => { runtime.ctx.emit('connection/reset') })
      expect(screen.queryByText('~/Documents/project')).toBeNull()
      expect(screen.queryByRole('treeitem')).toBeNull()
      expect(screen.getByRole('searchbox', { name: '搜索题目或知识点' })).toBeTruthy()
    } finally { await runtime.dispose() }
  })
})

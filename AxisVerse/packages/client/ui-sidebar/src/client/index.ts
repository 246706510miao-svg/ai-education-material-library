/** Registers the sidebar shell and global panel navigation. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session root standard-props merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the conversation header slot declarations.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarPanelMetadata, SidebarRootInjected } from './contract/slots.ts'
import { HeaderLeadingControls } from './HeaderLeadingControls.tsx'
import { AxisNavigation } from './AxisNavigation.tsx'
import { deleteCourseMaterial, loadCourseMaterials, loadCourseOutline, restoreCourseMaterial } from './course-materials.ts'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
type SessionId = Parameters<IConversation['selectCourseMaterial']>[0]
import { en, zh, type SidebarKey } from './locales.ts'

export type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps, SidebarFooterActionOwnerProps,
  SidebarPanelIconOwnerProps, SidebarPanelMetadata,
  SidebarRootComponentProps, SidebarRootInjected, SidebarSectionOwnerProps, SidebarSettingsOwnerProps,
} from './contract/slots.ts'
export type { SidebarKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Sidebar controls and global panel copy. */
    sidebar: SidebarKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'sidebar'

interface WorkspaceNavigation {
  startSession(workspaceId?: Parameters<SidebarRootInjected['startSession']>[0], beforeOpen?: (sessionId: SessionId) => void): Promise<void>
}

/** Services required by the sidebar plugin. */
export const inject = ['slots', 'layout', 'uiWorkspace', 'locale', 'conversation', 'sessions']

/** Registers the sidebar shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar: dictionaries')
  const panels = createSnapshotStore<readonly SidebarPanelMetadata[]>([])
  const syncPanels = (): void => {
    const next = ctx.slots.entriesOfSlot('sidebar.panellist').map(({ options }) => {
      // The list registration requires an id; StoredEntry erases the slot kind.
      const id = options.id as MainPanelId
      return { id, order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? id }
    }).sort((a, b) => a.order - b.order)
    const previous = panels.getSnapshot()
    if (previous.length === next.length && previous.every((panel, index) => {
      const candidate = next[index] as SidebarPanelMetadata
      return panel.id === candidate.id && panel.order === candidate.order && panel.label === candidate.label
    })) return
    panels.set(next)
  }
  ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', syncPanels), 'ui-sidebar: panel entries')
  ctx.effect(() => ctx.locale.subscribe(syncPanels), 'ui-sidebar: panel labels')

  const injectProps = (): SidebarRootInjected => ({
    loadCourseMaterials,
    loadCourseOutline,
    deleteCourseMaterial,
    restoreCourseMaterial,
    openCourseQuestion: async (material, headings) => {
      const result = { opened: false }
      await workspaceNavigation.startSession(undefined, (sessionId) => {
        ctx.conversation.selectCourseMaterial(sessionId, material)
        if (headings !== undefined) {
          const binding = ctx.sessions.binding(sessionId)
          if (binding === undefined) throw new Error('Session unavailable')
          const input = ctx.conversation.input.for(binding.ctx)
          input.setDraft(ctx.locale.bind(NS)('library.summaryPrompt', { headings: headings.join('\n') }))
          input.submit('queue')
        }
        result.opened = true
      })
      if (!result.opened) throw new Error('Session unavailable')
    },
    // The shell's New Session button rides the Workspace UI's shared action
    // (current Session Workspace, then recent Workspace).
    startSession: (workspaceId) => { void workspaceNavigation.startSession(workspaceId, (sessionId) => { ctx.conversation.selectCourseMaterial(sessionId, null) }).catch((error: unknown) => { console.warn('New question failed', error) }) },
    toggleSidebar: () => { ctx.layout.toggleSidebar() },
    selectPanel: (id) => { ctx.layout.selectPanel(id) },
    hooks: { panels },
  })
  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar',
    locale: NS,
    children: {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
      'sidebar.toggle.badge': { kind: 'single', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
      'sidebar.settings': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
    inject: injectProps,
  }, AxisNavigation))
  // macOS desktop hides the collapsed sidebar entirely, so the open/New
  // Session controls move into the conversation header's leading seat; the
  // occupant reuses the shell's injected actions and shows itself purely
  // through CSS against the AppFrame's data-sidebar-collapsed attribute.
  ctx.slots.inject('conversation.session.header.leading', () => ctx.slots.register({
    name: 'conversation.session.header.leading',
    locale: NS,
    inject: injectProps,
  }, HeaderLeadingControls))
  syncPanels()
}

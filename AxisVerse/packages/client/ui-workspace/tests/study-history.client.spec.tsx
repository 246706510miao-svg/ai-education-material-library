// @vitest-environment jsdom
/** Learning record interactions, archive filtering and browser-local review persistence. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { StudyHistoryProps } from '../src/client/contract/slots.ts'
import { StudyHistory } from '../src/client/StudyHistory.tsx'
import { createStudyHistoryStore } from '../src/client/study-history-store.ts'
import { studyRecords } from '../src/client/study-history.ts'
import { zh } from '../src/client/locales.ts'

const now = new Date(2026, 8, 27, 12).getTime()
const sid = (value: string) => value as SessionId
const row = (id: string, displayTitle: string, updatedAt = now, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id: sid(id), displayTitle, updatedAt, blank: false, running: false, retainedBy: {}, ...extra,
})
const sample = [row('a', '交换积分次序：抛物线与直线'), row('b', '三重积分的定义是什么', now - 86_400_000),
  row('c', '极坐标的面积元素', now - 20 * 86_400_000)]
const state = (rows: SessionSummary[]): SessionListState => ({
  ids: rows.map(value => value.id), byId: Object.fromEntries(rows.map(value => [value.id, value])),
  phase: 'ready', subagentsByParent: {}, jobsBySession: {},
})
beforeEach(() => { localStorage.clear(); vi.spyOn(Date, 'now').mockReturnValue(now) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

function mount(overrides: Partial<StudyHistoryProps> = {}) {
  const store = createStudyHistoryStore().create()
  const props: StudyHistoryProps = {
    wide: true, expandSidebar: vi.fn(), useSessions: selector => selector(state(sample)),
    useWorkspaces: selector => selector({ items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null }),
    usePanelInfo: selector => selector({ activePanelId: null }), useSessionStatus: selector => selector(new Map()),
    useSessionRetainInfo: () => undefined,
    useResource: (() => ({ status: 'none', value: undefined, failure: undefined, reload: () => {} })),
    useStore: bindSnapshotSelector(store), actions: store.actions,
    open: vi.fn(), renameSession: vi.fn(async () => {}), archiveSession: vi.fn(async () => {}),
    unarchiveSession: vi.fn(async () => {}), t: makeTranslate(zh, commonZh), ...overrides,
  }
  return { props, store, view: render(<StudyHistory {...props} />) }
}

describe('student learning history', () => {
  it('groups once by review or calendar day and hides blank, archived and delegated sessions', () => {
    const list = state([...sample, row('blank', '新会话', now, { blank: true, retainedBy: { mainView: 1 } }),
      row('hidden', '归档题目'), row('child', '内部任务', now, { origin: 'subagent' })])
    const records = studyRecords(list, [sid('hidden')], [sid('b')], now)
    expect(records.map(record => [record.id, record.group])).toEqual([['a', 'today'], ['b', 'review'], ['c', 'older']])
    mount({ useSessions: selector => selector(list),
      useWorkspaces: selector => selector({ items: [], archivedSessionIds: [sid('hidden')], phase: 'ready', state: 'idle', error: null }) })
    expect(screen.queryByText('新会话')).toBeNull()
    expect(screen.queryByText('内部任务')).toBeNull()
    expect(screen.queryByText('归档题目')).toBeNull()
    expect(screen.getByRole('region', { name: '今天' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '最近 7 天' })).toBeTruthy()
  })

  it('searches topic hints, opens the original question and closes the drawer', () => {
    const { props } = mount()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '  三重积分 ' } })
    expect(screen.getAllByRole('article')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /三重积分的定义是什么.*三重积分/ }))
    expect(props.open).toHaveBeenCalledWith('b')
    expect(props.expandSidebar).toHaveBeenCalledOnce()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在的题目' } })
    expect(screen.getByText('没有找到相关记录')).toBeTruthy()
  })

  it('persists review bookmarks across remounts and supports clearing the filter result', () => {
    const first = mount()
    fireEvent.click(screen.getByRole('button', { name: '标记“交换积分次序：抛物线与直线”为待复习' }))
    expect(first.store.getSnapshot().reviewIds).toEqual(['a'])
    first.view.unmount()
    const second = mount()
    fireEvent.click(screen.getByRole('button', { name: '待复习1' }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('region', { name: '待复习' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消“交换积分次序：抛物线与直线”的待复习标记' }))
    expect(screen.getByText('暂时没有待复习的题目')).toBeTruthy()
    expect(second.store.getSnapshot().reviewIds).toEqual([])
  })

  it('keeps failed renames retryable without displaying host diagnostics', async () => {
    const renameSession = vi.fn().mockRejectedValueOnce(new Error('internal_field secret')).mockResolvedValueOnce(undefined)
    mount({ renameSession })
    fireEvent.click(screen.getByRole('button', { name: '修改“三重积分的定义是什么”的标题' }))
    const input = screen.getByRole('textbox', { name: '题目标题' })
    fireEvent.change(input, { target: { value: '  三重积分定义  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).toBe('暂时未能保存，请重试。')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(renameSession).toHaveBeenLastCalledWith('b', '三重积分定义')
  })

  it('confirms record removal and restores the same conversation on undo', async () => {
    const { props, view } = mount()
    fireEvent.click(screen.getByRole('button', { name: '删除“三重积分的定义是什么”的记录' }))
    expect(props.archiveSession).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除记录' }))
    await screen.findByText('记录已移除')
    expect(props.archiveSession).toHaveBeenCalledWith('b')
    props.useWorkspaces = selector => selector({ items: [], archivedSessionIds: [sid('b')], state: 'idle', phase: 'ready', error: null })
    view.rerender(<StudyHistory {...props} />)
    expect(screen.queryByText('三重积分的定义是什么')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => { expect(screen.queryByText('记录已移除')).toBeNull() })
    expect(props.unarchiveSession).toHaveBeenCalledWith('b')
  })
})

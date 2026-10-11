// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CourseLibrary } from '../src/client/CourseLibrary.tsx'
import { deleteCourseMaterial, loadCourseMaterials, restoreCourseMaterial } from '../src/client/course-materials.ts'
import { en } from '../src/client/locales.ts'
import type { SidebarRootComponentProps } from '../src/client/contract/slots.ts'

const t: SidebarRootComponentProps['t'] = key => (en as Record<string, string>)[key] ?? key
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('opens material questions without sending and summarizes only selected original headings', async () => {
  const material = { id: 'doc_uploaded' as never, title: 'Calculus chapter 9', pages: 53, course: 'Calculus', unit: '' }
  const open = vi.fn().mockResolvedValue(undefined)
  render(<CourseLibrary t={t} loadCourseMaterials={async () => [material]} openCourseQuestion={open}
    loadCourseOutline={async () => [{ title: 'Double integrals', page: 1 }, { title: 'Triple integrals', page: 26 }]} onOpen={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Course materials' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Ask from material' }))
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  expect(open).toHaveBeenCalledWith(material, undefined)
  fireEvent.click(screen.getByRole('button', { name: 'Course materials' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Summarize material' }))
  await screen.findByRole('checkbox', { name: /Double integrals/ })
  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
  expect(screen.getByRole('button', { name: 'Generate summary' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getAllByRole('checkbox').every(input => !(input as HTMLInputElement).checked)).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: /Triple integrals/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
  expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).checked)).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: /Double integrals/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Generate summary' }))
  await waitFor(() => { expect(open).toHaveBeenLastCalledWith(material, ['Triple integrals']) })
})

it('loads metadata on opening and offers download without a view action', async () => {
  const load = vi.fn().mockResolvedValue([{ id: 'doc_uploaded', title: 'Calculus chapter 9', pages: 53, course: 'Calculus', unit: 'Multiple integrals' }])
  render(<CourseLibrary t={t} loadCourseMaterials={load} onOpen={() => {}} />)
  expect(load).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Course materials' }))
  expect(await screen.findByText('Calculus chapter 9')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'View' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe('/api/axisverse/materials/doc_uploaded/file?download=1')
  expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
})

it('keeps a failed removal visible and reloads only after confirmed removal or undo', async () => {
  const item = { id: 'doc_uploaded' as never, title: 'Calculus chapter 9', pages: 53, course: 'Calculus', unit: '' }
  let items = [item]
  const remove = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async () => { items = [] })
  const restore = vi.fn(async () => { items = [item] })
  render(<CourseLibrary t={t} loadCourseMaterials={async () => items} deleteCourseMaterial={remove}
    restoreCourseMaterial={restore} onOpen={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Course materials' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete material' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('heading', { name: item.title })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Delete material' }))
  await screen.findByText('No uploaded course materials yet')
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await screen.findByRole('heading', { name: item.title })
  expect(restore).toHaveBeenCalledWith(item.id)
})

it('reports host removal and restoration failures to the dialog', async () => {
  const request = vi.fn().mockResolvedValueOnce(new Response('', { status: 502 })).mockResolvedValueOnce(new Response('', { status: 404 }))
  vi.stubGlobal('fetch', request)
  const id = 'doc_uploaded' as never
  await expect(deleteCourseMaterial(id)).rejects.toThrow('unavailable')
  await expect(restoreCourseMaterial(id)).rejects.toThrow('unavailable')
  expect(request).toHaveBeenNthCalledWith(1, '/api/axisverse/materials/doc_uploaded', { method: 'DELETE', credentials: 'same-origin' })
  expect(request).toHaveBeenNthCalledWith(2, '/api/axisverse/materials/doc_uploaded/restore', { method: 'POST', credentials: 'same-origin' })
})

it('distinguishes failure from an empty library and retries', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
  render(<CourseLibrary t={t} loadCourseMaterials={load} onOpen={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Course materials' }))
  await screen.findByRole('alert')
  expect(screen.queryByText('No uploaded course materials yet')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('No uploaded course materials yet')
})

it('cancels closed panel requests and returns keyboard focus', async () => {
  let signal: AbortSignal | undefined
  const load = (value: AbortSignal): Promise<[]> => { signal = value; return new Promise(() => {}) }
  render(<CourseLibrary t={t} loadCourseMaterials={load} onOpen={() => {}} />)
  const trigger = screen.getByRole('button', { name: 'Course materials' })
  fireEvent.click(trigger)
  await waitFor(() => { expect(signal).toBeDefined() })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(signal?.aborted).toBe(true)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('rejects malformed document links received over the wire', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ id: '../other', title: 'Untrusted', pages: 53, course: 'Calculus', unit: '' }] }))))
  await expect(loadCourseMaterials(new AbortController().signal)).rejects.toThrow('invalid-response')
})

it('retains all searchable source ranges and rejects gaps in a whole-material response', async () => {
  const item = { id: 'doc_local_book', title: 'Original.pdf', pages: 524, course: 'Calculus', unit: '', sources: [
    { id: 'doc_first', pageStart: 1, pageCount: 500 }, { id: 'doc_last', pageStart: 501, pageCount: 24 },
  ] }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [item] })))
  expect(await loadCourseMaterials(new AbortController().signal)).toEqual([item])
  item.sources[1]!.pageStart = 502
  await expect(loadCourseMaterials(new AbortController().signal)).rejects.toThrow('invalid-response')
})

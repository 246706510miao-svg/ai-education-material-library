// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createMockStudyMaterialOperations, createLiveStudyMaterialOperations } from '../src/client/study-materials.ts'
import type { StudyMaterialOperations, StudyMaterialProgress, StudyMaterialReceipt, StudyMaterialId } from '../src/client/study-materials.ts'
import { StudyMaterials } from '../src/client/skeleton/StudyMaterials.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('material demo adapter', () => {
  it('reports upload then processing without reading document contents', async () => {
    vi.useFakeTimers()
    const api = createMockStudyMaterialOperations(10)
    const file = new File(['text'], 'notes.pdf', { type: 'application/pdf' })
    const states: StudyMaterialProgress[] = []
    const result = api.uploadStudyMaterial(file, new AbortController().signal, value => states.push(value))
    await vi.runAllTimersAsync()
    const receipt = await result
    expect(states.map(state => state.status)).toEqual(['uploading', 'uploading', 'uploading', 'uploading', 'processing'])
    expect(receipt).toMatchObject({ mode: 'mock', name: 'notes.pdf', size: 4 })
    const answer = api.askStudyMaterial(receipt, 'Explain this', new AbortController().signal)
    await vi.runAllTimersAsync()
    expect(await answer).toEqual({ mode: 'mock', question: 'Explain this', materialName: 'notes.pdf' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels processing without later progress and rejects invalid files', async () => {
    vi.useFakeTimers()
    const api = createMockStudyMaterialOperations(10)
    const controller = new AbortController()
    const progress = vi.fn()
    const pending = api.uploadStudyMaterial(new File(['data'], 'notes.pdf'), controller.signal, progress)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    await vi.runAllTimersAsync()
    expect(progress).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    await expect(api.uploadStudyMaterial(new File([], 'empty.pdf'), new AbortController().signal, progress)).rejects.toThrow('empty')
    await expect(api.uploadStudyMaterial(new File(['a'], 'bad.exe'), new AbortController().signal, progress)).rejects.toThrow('unsupported')
  })
})

function panel(operations: Pick<StudyMaterialOperations, 'studyMaterialMode' | 'uploadStudyMaterial' | 'listStudyMaterialUploads' | 'resumeStudyMaterialUpload'>) {
  const view = render(<StudyMaterials t={makeTranslate(zh)} {...operations} menuOpen
    anchor={<button>Add</button>} onMenuClose={() => {}} onPickImages={() => {}} />)
  fireEvent.click(view.getByRole('menuitem', { name: /添加学习资料/ }))
  const pick = (name = 'notes.pdf'): void => { fireEvent.change(view.getByLabelText('选择学习资料', { selector: 'input' }), { target: { files: [new File(['content'], name)] } }) }
  return { view, pick }
}

describe('student material workflow', () => {
  it('restores real page progress after remount without uploading the PDF again', async () => {
    const uploadId = `doc_local_${'a'.repeat(64)}` as never
    const upload = vi.fn()
    const signals: AbortSignal[] = []
    const api = { studyMaterialMode: 'live' as const, uploadStudyMaterial: upload,
      listStudyMaterialUploads: async () => [{ mode: 'live' as const, id: uploadId, uploadId, name: 'scan.pdf', size: 100,
        searchable: false, phase: 'recognizing' as const, completedPages: 128, totalPages: 592, pollAfterMs: 1500 }],
      resumeStudyMaterialUpload: vi.fn((_material: StudyMaterialReceipt, signal: AbortSignal) => {
        signals.push(signal); return new Promise<never>(() => {})
      }) }
    const first = panel(api)
    await first.view.findAllByText(/128 \/ 592 页/)
    expect(first.view.getByRole('status').textContent).toContain('Processing…')
    expect(first.view.queryByRole('button', { name: '重试' })).toBeNull()
    first.view.unmount()
    expect(signals[0]?.aborted).toBe(true)
    const second = panel(api)
    await second.view.findAllByText(/128 \/ 592 页/)
    expect(upload).not.toHaveBeenCalled()
    expect(api.resumeStudyMaterialUpload).toHaveBeenCalledTimes(2)
  })

  it('retries a restored failed original through the host rather than uploading it again', async () => {
    const uploadId = `doc_local_${'a'.repeat(64)}` as never
    const upload = vi.fn()
    const resume = vi.fn(async (_material: StudyMaterialReceipt & { uploadId: StudyMaterialId }, _signal: AbortSignal,
      _progress: (value: StudyMaterialProgress) => void, _retry: boolean) => ({ mode: 'live' as const, id: 'doc_ready' as never, uploadId,
      name: 'scan.pdf', size: 100, searchable: true }))
    const { view } = panel({ studyMaterialMode: 'live', uploadStudyMaterial: upload, resumeStudyMaterialUpload: resume,
      listStudyMaterialUploads: async () => [{ mode: 'live', id: uploadId, uploadId, name: 'scan.pdf', size: 100,
        searchable: false, phase: 'failed', completedPages: 128, totalPages: 592, pollAfterMs: 1500, errorCode: 'recognitionTimeout' }] })
    await view.findByText(/文字识别长时间没有进展/)
    fireEvent.click(view.getByRole('button', { name: '重试' }))
    await view.findByText(/上传成功/)
    expect(resume.mock.calls[0]?.[3]).toBe(true)
    expect(upload).not.toHaveBeenCalled()
  })
  it('shows confirmed upload success without a question form and keeps it on reopen', async () => {
    vi.useFakeTimers()
    const mock = createMockStudyMaterialOperations(10)
    const { view, pick } = panel({ studyMaterialMode: 'live', async uploadStudyMaterial(...args) {
      const receipt = await mock.uploadStudyMaterial(...args)
      return { ...receipt, mode: 'live', searchable: true }
    } })
    pick()
    expect(view.getByRole('status').textContent).toContain('Uploading…')
    expect(view.queryByText(/上传成功/)).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(40))
    expect(view.getByRole('status').textContent).toContain('Processing…')
    await act(() => vi.runAllTimersAsync())
    expect(view.getByText(/上传成功/)).toBeTruthy()
    expect(view.queryByRole('textbox')).toBeNull()
    expect(view.queryByText('体验资料问答')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '关闭学习资料' }))
    fireEvent.click(view.getByRole('menuitem', { name: /添加学习资料/ }))
    expect(view.getByText(/上传成功/)).toBeTruthy()
  })

  it('distinguishes a stored PDF whose text could not be indexed', async () => {
    const mock = createMockStudyMaterialOperations(0)
    const { view, pick } = panel({ studyMaterialMode: 'live', async uploadStudyMaterial(...args) {
      const receipt = await mock.uploadStudyMaterial(...args)
      return { ...receipt, mode: 'live', searchable: false }
    } })
    pick()
    expect(await view.findByText(/处理已停止，原文件已保存/)).toBeTruthy()
    expect(view.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('shows a failure, retries, and aborts pending work on removal or unmount', async () => {
    vi.useFakeTimers()
    const mock = createMockStudyMaterialOperations(10)
    const upload = vi.fn(mock.uploadStudyMaterial).mockRejectedValueOnce(new Error('network'))
    const { view, pick } = panel({ ...mock, uploadStudyMaterial: upload })
    pick()
    await act(async () => {})
    expect(view.getByText(/处理失败/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '重试' }))
    fireEvent.click(view.getByRole('button', { name: '移除 notes.pdf' }))
    await act(() => vi.runAllTimersAsync())
    expect(view.queryByText(/模拟处理完成/)).toBeNull()
    pick('next.pdf')
    view.unmount()
    await vi.runAllTimersAsync()
    expect(upload.mock.calls.at(-1)![1].aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})

class UploadRequest {
  static latest: UploadRequest
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void; onload?: () => void } = {}
  onload?: () => void
  onerror?: () => void
  onabort?: () => void
  status = 0
  responseText = ''
  open = vi.fn()
  setRequestHeader = vi.fn()
  send = vi.fn()
  constructor() { UploadRequest.latest = this }
  abort(): void { this.onabort?.() }
  respond(status: number, data: unknown): void { this.status = status; this.responseText = JSON.stringify(data); this.onload?.() }
}

describe('real material upload adapter', () => {
  it('restores monitoring through an initial connection failure without offering retry', async () => {
    vi.useFakeTimers()
    const uploadId = `doc_local_${'a'.repeat(64)}` as StudyMaterialId
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ id: 'doc_ready', searchable: true, phase: 'ready' })))
    const progress = vi.fn()
    const pending = createLiveStudyMaterialOperations().resumeStudyMaterialUpload!({ mode: 'live', id: uploadId,
      uploadId, name: 'scan.pdf', size: 100, pollAfterMs: 10 }, new AbortController().signal, progress, false)
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ id: 'doc_ready', searchable: true })
    expect(progress.mock.calls).toEqual([[{ status: 'checking', progress: 100, stored: true }]])
    expect(vi.getTimerCount()).toBe(0)
  })
  it('keeps monitoring across a lost connection without reporting a failed upload', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('XMLHttpRequest', UploadRequest)
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ id: 'doc_ready', searchable: true, phase: 'ready' }))
    vi.stubGlobal('fetch', fetcher)
    const uploadId = `doc_local_${'a'.repeat(64)}`
    const progress = vi.fn()
    const pending = createLiveStudyMaterialOperations().uploadStudyMaterial(new File(['%PDF-'], 'scan.pdf'), new AbortController().signal, progress)
    UploadRequest.latest.respond(202, { id: uploadId, uploadId, stored: true, searchable: false, phase: 'queued', pollAfterMs: 10 })
    await vi.runAllTimersAsync()
    expect(progress).toHaveBeenCalledWith({ status: 'checking', progress: 100, stored: true })
    expect(await pending).toMatchObject({ id: 'doc_ready', searchable: true, uploadId })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports stored originals and actual OCR phases until searchable text is ready', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('XMLHttpRequest', UploadRequest)
    const uploadId = `doc_local_${'a'.repeat(64)}`
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({
      id: uploadId, searchable: false, phase: 'recognizing', pollAfterMs: 10,
    })).mockResolvedValueOnce(Response.json({ id: 'doc_ready', searchable: true, phase: 'ready' })))
    const progress = vi.fn()
    const pending = createLiveStudyMaterialOperations().uploadStudyMaterial(new File(['%PDF-'], 'scan.pdf'), new AbortController().signal, progress)
    UploadRequest.latest.respond(202, { id: uploadId, uploadId, stored: true, searchable: false, phase: 'queued', pollAfterMs: 10 })
    await vi.runAllTimersAsync()
    expect(await pending).toMatchObject({ id: 'doc_ready', searchable: true })
    expect(progress).toHaveBeenCalledWith({ status: 'recognizing', progress: 100, stored: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels status monitoring without pretending the stored file was deleted', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('XMLHttpRequest', UploadRequest)
    const uploadId = `doc_local_${'a'.repeat(64)}`
    const controller = new AbortController()
    const pending = createLiveStudyMaterialOperations().uploadStudyMaterial(new File(['%PDF-'], 'scan.pdf'), controller.signal, () => {})
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    UploadRequest.latest.respond(202, { id: uploadId, uploadId, stored: true, searchable: false, phase: 'queued', pollAfterMs: 100 })
    controller.abort()
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sends the original PDF and waits for a valid receipt after transfer', async () => {
    vi.stubGlobal('XMLHttpRequest', UploadRequest)
    const api = createLiveStudyMaterialOperations()
    const file = new File(['%PDF-'], '教材.pdf')
    const progress = vi.fn()
    const pending = api.uploadStudyMaterial(file, new AbortController().signal, progress)
    const request = UploadRequest.latest
    expect(request.open).toHaveBeenCalledWith('POST', '/api/axisverse/materials/upload')
    expect(request.send).toHaveBeenCalledWith(file)
    expect(request.setRequestHeader).toHaveBeenCalledWith('X-Material-Name', encodeURIComponent(file.name))
    request.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 5 })
    expect(progress).toHaveBeenLastCalledWith({ status: 'uploading', progress: 60 })
    request.upload.onload?.()
    expect(progress).toHaveBeenLastCalledWith({ status: 'processing', progress: 100 })
    request.respond(200, { id: 'doc_saved', searchable: true })
    expect(await pending).toMatchObject({ mode: 'live', id: 'doc_saved', searchable: true })
  })

  it.each([[502, { code: 'unavailable' }], [200, { status: 'processing' }], [413, { code: 'tooLarge' }]])('rejects incomplete or failed response %s', async (status, data) => {
    vi.stubGlobal('XMLHttpRequest', UploadRequest)
    const pending = createLiveStudyMaterialOperations().uploadStudyMaterial(new File(['%PDF-'], 'notes.pdf'), new AbortController().signal, () => {})
    UploadRequest.latest.respond(status, data)
    await expect(pending).rejects.toBeInstanceOf(Error)
  })

  it('cancels the browser request instead of producing a receipt', async () => {
    vi.stubGlobal('XMLHttpRequest', UploadRequest)
    const controller = new AbortController()
    const pending = createLiveStudyMaterialOperations().uploadStudyMaterial(new File(['%PDF-'], 'notes.pdf'), controller.signal, () => {})
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

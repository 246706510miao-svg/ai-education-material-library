/** Page-at-a-time reading of authenticated remote PDFs without a browser PDF plugin. */
import { getDocument, GlobalWorkerOptions } from './assets/build/pdf.mjs'

const copy = {
  zh: { title: '课程资料', back: '返回 AxisVerse', download: '下载 PDF', previous: '上一页', next: '下一页', page: '页码', loading: '正在加载教材…', rendering: '正在显示页面…', error: '教材暂时无法打开，请重试。', retry: '重试', plus: '放大', minus: '缩小', canvas: '教材页面' },
  en: { title: 'Course materials', back: 'Back to AxisVerse', download: 'Download PDF', previous: 'Previous', next: 'Next', page: 'Page', loading: 'Loading material…', rendering: 'Rendering page…', error: 'Unable to open the material. Please retry.', retry: 'Retry', plus: 'Zoom in', minus: 'Zoom out', canvas: 'Textbook page' },
}
const text = copy[navigator.language.startsWith('zh') ? 'zh' : 'en']
document.documentElement.lang = navigator.language.startsWith('zh') ? 'zh-CN' : 'en'
const element = id => document.getElementById(id)
for (const key of ['title', 'back', 'download', 'previous', 'next', 'retry']) element(key).textContent = text[key]
element('pageLabel').textContent = text.page
for (const key of ['minus', 'plus', 'canvas']) element(key).setAttribute('aria-label', text[key])
const file = location.pathname.replace(/\/view$/, '/file')
element('download').href = `${file}?download=1`
GlobalWorkerOptions.workerSrc = new URL('./assets/build/pdf.worker.mjs', import.meta.url).href

class BinaryDataFactory {
  async fetch({ kind, filename }) {
    const folder = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' }[kind]
    if (!folder || !/^[\w.-]+$/.test(filename)) throw new Error('Unsupported PDF asset')
    const response = await fetch(new URL(`./assets/${folder}/${filename}`, import.meta.url))
    if (!response.ok) throw new Error('Missing PDF asset')
    return new Uint8Array(await response.arrayBuffer())
  }
}
let task, pdf, rendering, page = 1, zoom = 1, busy = false, closed = false
const canvas = element('canvas')
function controls() {
  element('previous').disabled = busy || !pdf || page <= 1
  element('next').disabled = busy || !pdf || page >= pdf.numPages
  element('page').disabled = busy || !pdf
  element('minus').disabled = busy || !pdf || zoom <= 0.5
  element('plus').disabled = busy || !pdf || zoom >= 2
}
function failed() {
  if (closed) return
  element('status').textContent = text.error
  element('retry').hidden = false
}
async function renderPage() {
  busy = true; controls(); canvas.hidden = true
  element('status').textContent = text.rendering
  try {
    const current = await pdf.getPage(page)
    if (closed) return
    const base = current.getViewport({ scale: 1 })
    const scale = Math.min(1000, Math.max(280, innerWidth - 48)) / base.width * zoom
    const viewport = current.getViewport({ scale })
    const ratio = Math.min(devicePixelRatio || 1, 2)
    canvas.width = Math.round(viewport.width * ratio); canvas.height = Math.round(viewport.height * ratio)
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`
    rendering = current.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
    await rendering.promise
    canvas.hidden = false; element('status').textContent = ''
    canvas.setAttribute('aria-label', `${text.canvas} ${page}`)
    element('page').value = String(page); element('total').textContent = `/ ${pdf.numPages}`
    element('zoom').textContent = `${Math.round(zoom * 100)}%`
    current.cleanup()
  } catch (error) { failed() }
  finally { rendering = undefined; busy = false; if (!closed) controls() }
}
async function load() {
  busy = true; controls(); element('retry').hidden = true; canvas.hidden = true
  element('status').textContent = text.loading
  try {
    if (task) await task.destroy()
    task = getDocument({ url: file, withCredentials: true, disableStream: true, disableAutoFetch: true, rangeChunkSize: 262144, BinaryDataFactory, useWorkerFetch: false, enableXfa: false, isEvalSupported: false })
    pdf = await task.promise
    if (closed) return
    element('page').max = String(pdf.numPages)
    await renderPage()
  } catch (error) { failed(); busy = false; controls() }
}
element('previous').onclick = () => { if (!busy && page > 1) { page--; void renderPage() } }
element('next').onclick = () => { if (!busy && pdf && page < pdf.numPages) { page++; void renderPage() } }
element('page').onchange = event => { const number = Number(event.target.value); if (!busy && pdf && Number.isInteger(number) && number >= 1 && number <= pdf.numPages) { page = number; void renderPage() } else event.target.value = String(page) }
element('minus').onclick = () => { zoom = Math.max(0.5, zoom - 0.25); void renderPage() }
element('plus').onclick = () => { zoom = Math.min(2, zoom + 0.25); void renderPage() }
element('retry').onclick = () => { void load() }
addEventListener('pagehide', () => { closed = true; rendering?.cancel(); void task?.destroy() }, { once: true })
addEventListener('pageshow', event => { if (event.persisted) location.reload() })
void load()

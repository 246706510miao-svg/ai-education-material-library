// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { CourseQuestionSelection } from '../src/client/course-question.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

afterEach(() => { sessionStorage.clear() })

it('keeps document choices isolated across sessions and restores a refreshed tab', () => {
  const a = 'course-a' as SessionId, b = 'course-b' as SessionId
  const material = { id: 'doc_own' as never, title: 'My calculus notes', sources: [
    { id: 'doc_first' as never, pageStart: 1, pageCount: 500 }, { id: 'doc_last' as never, pageStart: 501, pageCount: 24 },
  ] }
  const store = new CourseQuestionSelection()
  store.set(a, material)
  expect(store.for(b).getSnapshot()).toBeNull()
  const restored = new CourseQuestionSelection()
  expect(restored.for(a).getSnapshot()).toEqual(material)
  restored.set(a, null)
  expect(new CourseQuestionSelection().for(a).getSnapshot()).toBeNull()
})

it('does not restore malformed browser data as a selected document', () => {
  const id = 'invalid' as SessionId
  sessionStorage.setItem(`axisverse.course.${id}`, '{"id":"../private","title":"test"}')
  expect(new CourseQuestionSelection().for(id).getSnapshot()).toBeNull()
  sessionStorage.setItem(`axisverse.course.${id}`, JSON.stringify({ id: 'doc_own', title: 'test', sources: [
    { id: 'doc_first', pageStart: 1, pageCount: 500 }, { id: 'doc_last', pageStart: 999, pageCount: 24 },
  ] }))
  expect(new CourseQuestionSelection().for(id).getSnapshot()).toBeNull()
})

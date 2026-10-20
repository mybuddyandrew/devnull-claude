import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { EMOJI, emojify, searchEmoji } from './emoji'

const PANE = {
  component: 'Pane',
  requestId: 'devnull',
  props: { title: '/dev/null', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const

const PARENT = '00000000-0000-4000-8000-000000000001'
const REPLY = '00000000-0000-4000-8000-000000000002'
const commit = (id: string, body: string, extra: Record<string, unknown> = {}) => ({
  id,
  short_hash: id.slice(-7),
  body,
  author: { username: 'ada', name: 'Ada Example', lane: 1 },
  stars_count: 0,
  replies_count: 0,
  starred: false,
  reply_preview: { data: [] },
  ...extra,
})

// A made-up dev-null.sh: one post with one reply, and whatever is posted or starred, recorded.
function server(on: On) {
  const calls: { method: string; path: string; body?: string }[] = []
  let replies = 1
  on('http.fetch', async (_$, e) => {
    const method = e.init?.method ?? 'GET'
    const path = new URL(e.url).pathname
    calls.push({ method, path, ...(e.init?.body ? { body: e.init.body } : {}) })
    const reply = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    if (path === `/api/v1/commits/${PARENT}/replies`) return reply({ data: [commit(REPLY, 'a reply')] })
    if (path === `/api/v1/commits/${REPLY}/star`) return reply({ data: commit(REPLY, 'a reply', { stars_count: 1, starred: true }) })
    if (path === '/api/v1/commits' && method === 'POST') {
      replies++
      return reply({ data: commit('00000000-0000-4000-8000-000000000009', 'posted') })
    }
    if (path === '/api/v1/me') return reply({ data: { id: 'u1', username: 'me' } })
    return reply({ data: [commit(PARENT, 'the post', { replies_count: replies })], meta: {} })
  })
  return calls
}

function standIns(on: On) {
  mock.store(on, { username: 'me' })
  mock.env(on, { HOME: '/tmp/devnull-test' })
  mock.clock(on, { now: Date.parse('2026-10-19T19:00:00Z') })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', async () => ({ value: true }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('audio.play', async () => ({ value: undefined }))
  on('prompt.fill', async () => ({ isFilled: true, box: { text: '', cursor: 0 } }) as never)
  on('classic.SessionStart', async () => ({}))
}

test('a post opens its replies inline; a reply can be starred there; it folds away again', async ($, on) => {
  standIns(on)
  const calls = server(on)
  await $.classic.SessionStart({ source: 'startup' })
  await $.command.run({ command: 'devnull', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...PANE })

  await ui.press({ key: `thread-0-${PARENT}` })
  expect(calls.some(c => c.path === `/api/v1/commits/${PARENT}/replies`)).toBe(true)
  expect(await ui.find({ key: `star-1-${REPLY}` })).toBeDefined()

  await ui.press({ key: `star-1-${REPLY}` })
  expect(calls.some(c => c.method === 'POST' && c.path === `/api/v1/commits/${REPLY}/star`)).toBe(true)
  expect((await ui.find({ key: `star-1-${REPLY}` }))?.text).toContain('★ 1')

  await ui.press({ key: `thread-0-${PARENT}` })
  expect(await ui.find({ key: `star-1-${REPLY}` })).toBeUndefined()
  await ui.unmount()
})

test('Reply aims the next post at the commit: it posts with parent_id and counts the reply', async ($, on) => {
  standIns(on)
  const calls = server(on)
  await $.classic.SessionStart({ source: 'startup' })
  await $.command.run({ command: 'devnull', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...PANE })
  await pane.press({ key: `reply-0-${PARENT}` })
  expect(await pane.find({ type: 'Text', text: /Replying to @ada/ })).toBeDefined()

  const out = await $.command.run({ command: 'devnull', args: 'post thanks :rocket:' } as never)
  expect(out.text).toContain('press Post')
  const band = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...BAND })
  expect((await band.find({ key: 'ship-post' }))?.text).toContain('Reply')
  await band.press({ key: 'ship-post' })
  const post = calls.find(c => c.method === 'POST' && c.path === '/api/v1/commits')
  expect(JSON.parse(post!.body!)).toEqual({ body: 'thanks 🚀', parent_id: PARENT })
  expect((await pane.find({ key: `thread-0-${PARENT}` }))?.text).toContain('2 replies')
  expect(await pane.find({ type: 'Text', text: /Replying to/ })).toBeUndefined()
  await band.unmount()
  await pane.unmount()
})

test('the pane text field offers its post in the band and clears', async ($, on) => {
  standIns(on)
  const calls = server(on)
  await $.classic.SessionStart({ source: 'startup' })
  await $.command.run({ command: 'devnull', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...PANE })
  await pane.input({ key: 'compose-0', text: 'from the field :wave:' })
  expect(calls.some(c => c.method === 'POST' && c.path === '/api/v1/commits')).toBe(false)
  expect(await pane.find({ key: 'compose-1' })).toBeDefined()
  const band = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...BAND })
  expect(await band.find({ type: 'Text', text: /from the field 👋/ })).toBeDefined()
  await band.unmount()
  await pane.unmount()
})

test('GitHub shortcodes turn into emoji outside code, and complete from a few letters', async () => {
  expect(EMOJI.rocket).toBe('🚀')
  expect(emojify('ship it :rocket: :not_a_code: `:rocket:`')).toBe('ship it 🚀 :not_a_code: `:rocket:`')
  expect(emojify('```\n:tada:\n```\n:tada:')).toBe('```\n:tada:\n```\n🎉')
  const st = searchEmoji('st')
  expect(st.length).toBeGreaterThan(0)
  expect(st.every(e => e.code.startsWith('st') || e.code.includes('st'))).toBe(true)
  expect(searchEmoji('star').some(e => e.emoji === '⭐')).toBe(true)
})

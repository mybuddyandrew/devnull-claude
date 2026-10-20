import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { toConversationRow, toMessageRow } from './rows'
import { remotesOf } from './remotes'

const PANE = {
  component: 'Pane',
  requestId: 'devnull',
  props: { title: '/dev/null', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

async function settle(): Promise<void> {
  for (let i = 0; i < 300; i++) await Promise.resolve()
}

test('Remotes is on only when GET me carries it, switched on', async () => {
  expect(remotesOf({ data: { id: 1 } })).toEqual({ on: false, unread: 0 })
  expect(remotesOf({ data: { id: 1, remotes: null } })).toEqual({ on: false, unread: 0 })
  expect(remotesOf({ data: { id: 1, remotes: { unread_count: 3 } } })).toEqual({ on: true, unread: 3 })
  expect(remotesOf({ remotes: { unread_count: 1 } })).toEqual({ on: true, unread: 1 })
})

test('inbox rows and messages read as the phone app reads them', async () => {
  const row = toConversationRow(
    { id: 'c1', kind: 'direct', partner: { id: 'u2', username: 'ada', name: 'Ada Example', lane: 2 }, last_message: { id: 9, user_id: 'u1', body: 'see you' }, ahead: 2, is_archived: false },
    'u1',
  )
  expect(row).toMatchObject({ isOrg: false, target: 'ada', title: 'Ada Example', lastText: 'see you', lastIsMine: true, ahead: 2 })
  const org = toConversationRow({ id: 'o1', kind: 'org', name: null, members: [{ user: { id: 'u1', username: 'me' } }, { user: { id: 'u2', username: 'ada' } }, { user: { id: 'u3', username: 'grace' } }] }, 'u1')
  expect(org).toMatchObject({ isOrg: true, target: 'o1', title: 'ada, grace' })
  const msg = toMessageRow({ id: 5, user_id: 'u2', body: 'hi', client_id: 'x', reactions: [{ user_id: 'u1', emoji: '❤️' }], reply_to: { id: 4, body: 'yo' } }, 'u1')
  expect(msg).toMatchObject({ id: 5, isMine: false, body: 'hi', clientId: 'x', reactions: [{ userId: 'u1', emoji: '❤️' }], replyTo: { id: 4, body: 'yo' } })
})

function server(on: On, opts: { remotes: boolean }) {
  const calls: { method: string; path: string; body?: string }[] = []
  on('http.fetch', async (_$, e) => {
    const method = e.init?.method ?? 'GET'
    const path = new URL(e.url).pathname
    calls.push({ method, path, ...(e.init?.body ? { body: e.init.body } : {}) })
    const reply = (status: number, body: unknown) => ({ value: { status, ok: status < 300, headers: {}, text: JSON.stringify(body) } })
    if (path === '/api/v1/me') return reply(200, { data: { id: 'u1', username: 'me', ...(opts.remotes ? { remotes: { unread_count: 1 } } : {}) } })
    if (!opts.remotes && path.startsWith('/api/v1/remotes')) return reply(404, { message: 'Not Found' })
    if (path === '/api/v1/remotes') {
      return reply(200, { data: [{ id: 'c1', kind: 'direct', partner: { id: 'u2', username: 'ada', name: 'Ada Example', lane: 2 }, last_message: { id: 9, user_id: 'u2', body: 'ping' }, ahead: 1 }], has_more: false, unread_count: 1, requests_count: 0 })
    }
    if (path === '/api/v1/remotes/@ada/messages' && method === 'GET') {
      return reply(200, { data: { messages: [{ id: 9, user_id: 'u2', body: 'ping from ada', reactions: [] }], has_older: false, access: 'open', read_through_id: 0, partner_read_through_id: 0, reactions_version: 0, partner_typing: false } })
    }
    if (path === '/api/v1/remotes/@ada/messages' && method === 'POST') {
      const sent = JSON.parse(e.init?.body ?? '{}') as { body: string; client_id: string }
      return reply(201, { data: { id: 10, user_id: 'u1', body: sent.body, client_id: sent.client_id, reactions: [] } })
    }
    if (path === '/api/v1/remotes/@ada/read') return reply(204, {})
    return reply(200, { data: [], meta: {} })
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
  on('classic.SessionStart', async () => ({}))
}

test('with no Remotes on the server, the tab stays hidden', async ($, on) => {
  standIns(on)
  server(on, { remotes: false })
  await $.classic.SessionStart({ source: 'startup' })
  await settle()
  await $.command.run({ command: 'devnull', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'tab-following' })).toBeDefined()
  expect(await ui.find({ key: 'tab-remotes' })).toBeUndefined()
  await ui.unmount()
})

test('inbox, thread and sending, once the server has Remotes', async ($, on) => {
  standIns(on)
  const calls = server(on, { remotes: true })
  await $.classic.SessionStart({ source: 'startup' })
  await settle()
  await $.command.run({ command: 'devnull', args: '' } as never)

  const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...PANE })
  expect(await ui.find({ key: 'tab-remotes' })).toBeDefined()
  await ui.press({ key: 'tab-remotes' })
  expect(await ui.find({ key: 'rm-open-c1' })).toBeDefined()

  await ui.press({ key: 'rm-open-c1' })
  expect(await ui.find({ type: 'Text', text: /Ada Example/ })).toBeDefined()
  expect(calls.some(c => c.method === 'PUT' && c.path === '/api/v1/remotes/@ada/read')).toBe(true)
  expect(await ui.find({ key: 'thread-reply' })).toBeDefined()

  const out = await $.command.run({ command: 'devnull', args: 'remote @ada hello there' } as never)
  expect(out.text).toBe('Pushed to @ada.')
  const post = calls.find(c => c.method === 'POST' && c.path === '/api/v1/remotes/@ada/messages')
  expect(JSON.parse(post!.body!)).toMatchObject({ body: 'hello there' })
  expect(JSON.parse(post!.body!).client_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

  await ui.press({ key: 'thread-back' })
  expect(await ui.find({ key: 'rm-open-c1' })).toBeDefined()
  await ui.unmount()
})

test('a malformed /devnull remote says how to write it', async ($, on) => {
  standIns(on)
  server(on, { remotes: true })
  await $.classic.SessionStart({ source: 'startup' })
  const out = await $.command.run({ command: 'devnull', args: 'remote hello' } as never)
  expect(out.text).toContain('/devnull remote @username')
})

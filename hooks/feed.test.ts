import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { pullStep } from './pane-scroll'
import { PULL_TICKS } from './state'

const PANE = {
  component: 'Pane',
  requestId: 'devnull',
  props: { title: '/dev/null', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const commit = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  short_hash: `abc${i}`,
  body: `post ${i}`,
  created_at: '2026-10-19T18:30:00Z',
  html_url: `https://dev-null.sh/commits/${i}`,
  stars_count: 0,
  replies_count: 0,
  starred: false,
  is_saved: false,
  images: [],
  author: { username: `user${i}`, name: `User ${i}`, lane: i % 6, avatar_url: null },
  reply_preview: { data: [] },
  ...extra,
})
const ID = (i: number) => commit(i).id

async function settle(): Promise<void> {
  for (let i = 0; i < 300; i++) await Promise.resolve()
}

type Reply = { status?: number; body: unknown }
type Fetch = { method: string; path: string; query: string }

// A made-up dev-null.sh whose answers a test sets per path, and can hold back until it lets them go.
function server(on: On, answer: (f: Fetch) => Reply | Promise<Reply>, opts: { run?: boolean; box?: string; fills?: string[] } = {}) {
  const calls: Fetch[] = []
  mock.store(on, { username: 'me', userId: 'u1' })
  mock.env(on, { HOME: '/tmp/devnull-test' })
  mock.clock(on, { now: Date.parse('2026-10-19T19:00:00Z') })
  if (opts.run !== false) on('process.run', async () => ({ value: { exitCode: 0, stdout: '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', async () => ({ value: true }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('ui.scroll', async () => ({ value: undefined }) as never)
  on('prompt.read', async () => ({ value: { text: opts.box ?? '', cursor: (opts.box ?? '').length } }) as never)
  on('prompt.fill', async (_$, e) => {
    opts.fills?.push(e.text)
    return { isFilled: true, text: e.text, cursor: e.text.length } as never
  })
  on('classic.SessionStart', async () => ({}))
  on('http.fetch', async (_$, e) => {
    const u = new URL(e.url)
    const f = { method: e.init?.method ?? 'GET', path: u.pathname, query: u.search }
    calls.push(f)
    const r = await answer(f)
    return { value: { status: r.status ?? 200, ok: (r.status ?? 200) < 300, headers: {}, text: JSON.stringify(r.body) } }
  })
  return calls
}

const held = () => {
  let release: (r: Reply) => void = () => {}
  const reply = new Promise<Reply>(r => (release = r))
  return { reply, release }
}

async function openPane($: any) {
  await $.classic.SessionStart({ source: 'startup' })
  await $.command.run({ command: 'devnull', args: '' } as never)
  return $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...PANE })
}

test('a refresh that lands after you switched tabs does not overwrite the tab you are on', async ($, on) => {
  let slow: ReturnType<typeof held> | undefined
  server(on, f => {
    if (f.path === '/api/v1/log/following') return slow ? slow.reply : { body: { data: [commit(1)], meta: {} } }
    if (f.path === '/api/v1/log/latest') return { body: { data: [commit(2)], meta: {} } }
    return { body: { data: { id: 'u1' } } }
  })
  const ui = await openPane($)
  slow = held()
  void ui.press({ key: 'refresh' })
  await settle()
  await ui.press({ key: 'tab-latest' })
  expect(await ui.find({ key: `star-0-${ID(2)}` })).toBeDefined()
  slow.release({ body: { data: [commit(9)], meta: {} } })
  await settle()
  expect(await ui.find({ key: `star-0-${ID(9)}` })).toBeUndefined()
  expect(await ui.find({ key: `star-0-${ID(2)}` })).toBeDefined()
  await ui.unmount()
})

test('two load-mores at once fetch the next page once, and no row is drawn twice', async ($, on) => {
  const page1 = Array.from({ length: 15 }, (_, i) => commit(i))
  const page2 = Array.from({ length: 15 }, (_, i) => commit(i + 15))
  let next: ReturnType<typeof held> | undefined
  const calls = server(on, f => {
    if (f.path !== '/api/v1/log/following') return { body: { data: { id: 'u1' } } }
    if (f.query.includes('cursor=p2')) return next ? next.reply : { body: { data: page2, meta: {} } }
    return { body: { data: page1, meta: { next_cursor: 'p2' } } }
  })
  const ui = await openPane($)
  next = held()
  void ui.press({ key: 'more' })
  void ui.press({ key: 'more' })
  await settle()
  next.release({ body: { data: [...page2, page1[0]], meta: {} } })
  await settle()
  expect(calls.filter(c => c.query.includes('cursor=p2')).length).toBe(1)
  const tree = JSON.stringify(await ui.drawn())
  expect(tree.split(`"star-0-${ID(0)}"`).length - 1).toBeLessThanOrEqual(1)
  await ui.unmount()
})

test('pull to refresh fires once, then waits for that refresh to finish', async () => {
  let pull = { ticks: 0, lastAt: 0 }
  const fired: number[] = []
  for (let i = 0; i < 8; i++) {
    const step = pullStep(pull, 1000 + i * 100, fired.length > 0)
    pull = { ticks: step.ticks, lastAt: 1000 + i * 100 }
    if (step.fire) fired.push(i)
  }
  expect(fired).toEqual([PULL_TICKS - 1])
  // Ticks further apart than the window start over.
  expect(pullStep({ ticks: 3, lastAt: 0 }, 10_000, false)).toEqual({ ticks: 1, fire: false })
})

test('a star pressed on a profile shows there', async ($, on) => {
  server(on, f => {
    if (f.path === '/api/v1/users/user1') return { body: { data: { username: 'user1', name: 'User 1' } } }
    if (f.path === '/api/v1/users/user1/commits') return { body: { data: [commit(7)] } }
    if (f.path === `/api/v1/commits/${ID(7)}/star`) return { body: { data: commit(7, { stars_count: 1, starred: true }) } }
    if (f.path === '/api/v1/log/following') return { body: { data: [commit(1)], meta: {} } }
    return { body: { data: { id: 'u1' } } }
  })
  const ui = await openPane($)
  await ui.press({ key: `who-0-${ID(1)}` })
  expect((await ui.find({ key: `star-0-${ID(7)}` }))?.text).toBe('☆')
  await ui.press({ key: `star-0-${ID(7)}` })
  expect((await ui.find({ key: `star-0-${ID(7)}` }))?.text).toBe('★ 1')
  await ui.unmount()
})

test('signing out forgets the account; the next sign-in neither shows its list nor keeps its id', async ($, on) => {
  let authorize = ''
  let following: ReturnType<typeof held> | undefined
  const calls = server(on, f => {
    if (f.path === '/api/v1/devices') return { body: { data: { username: 'other' } } }
    if (f.path === '/api/v1/log/following') return following ? following.reply : { body: { data: [commit(1)], meta: {} } }
    return { body: { data: { id: f.path === '/api/v1/me' ? 'u2' : 'u1' } } }
  }, { run: false })
  on('process.run', async (_$, e) => {
    if (e.argv[0] === '/usr/bin/open') authorize = e.argv[1] ?? ''
    const stdout = e.argv[1] === '-lf' ? '256 SHA256:abc devnull (ED25519)' : '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', async () => ({ value: undefined }))
  on('fs.read', async () => ({ value: '2' }))
  const ui = await openPane($)
  expect(await ui.find({ key: `star-0-${ID(1)}` })).toBeDefined()
  await $.command.run({ command: 'devnull', args: 'logout' } as never)
  expect(await ui.find({ key: 'sign-in' })).toBeDefined()

  await $.command.run({ command: 'devnull', args: 'login' } as never)
  const state = new URL(authorize).searchParams.get('state')
  following = held()
  const loggedIn = calls.length
  void $.command.run({ command: 'devnull', args: `login devnull://auth/callback?code=c&state=${state}` } as never)
  await settle()
  // The new account's list is still loading: nothing of the old one shows meanwhile.
  expect(await ui.find({ key: `star-0-${ID(1)}` })).toBeUndefined()
  // Its own id is read afresh rather than the old account's kept one.
  expect(calls.slice(loggedIn).some(c => c.path === '/api/v1/me')).toBe(true)
  following.release({ body: { data: [commit(2)], meta: {} } })
  await settle()
  await ui.unmount()
})

test('after /clear, /resume or a fork the pane still knows you are signed in and shows your log', async ($, on) => {
  server(on, f => (f.path === '/api/v1/log/following' ? { body: { data: [commit(1)], meta: {} } } : { body: { data: { id: 'u1' } } }))
  // /clear resets the session's state to its defaults and starts no session.start: only this event comes.
  for (const source of ['clear', 'resume', 'fork'] as const) {
    await $.classic.SessionStart({ source })
    await settle()
    const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...PANE })
    expect(await ui.find({ key: 'sign-in' })).toBeUndefined()
    expect(await ui.find({ key: `star-0-${ID(1)}` })).toBeDefined()
    await ui.unmount()
  }
})

test('Reply starts the post in the prompt box without throwing away what you had typed', async ($, on) => {
  const fills: string[] = []
  server(on, f => (f.path === '/api/v1/log/following' ? { body: { data: [commit(1)], meta: {} } } : { body: { data: { id: 'u1' } } }), { box: 'half a thought', fills })
  const ui = await openPane($)
  await ui.press({ key: `reply-0-${ID(1)}` })
  expect(fills.at(-1)).toBe('/devnull post half a thought')
  await ui.unmount()
})

test('what you type in the pane field survives a redraw', async ($, on) => {
  server(on, f =>
    f.path === `/api/v1/commits/${ID(1)}/star` ? { body: { data: commit(1, { stars_count: 1, starred: true }) } } : f.path === '/api/v1/log/following' ? { body: { data: [commit(1)], meta: {} } } : { body: { data: { id: 'u1' } } },
  )
  const ui = await openPane($)
  await ui.input({ key: 'compose-0', text: 'half typed', kind: 'change' })
  // A star press redraws the pane while the field holds unsent text.
  await ui.press({ key: `star-0-${ID(1)}` })
  expect((await ui.find({ key: 'compose-0' }))?.props.value).toBe('half typed')
  await ui.unmount()
})

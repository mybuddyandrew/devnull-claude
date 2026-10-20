import { expect, mock, test } from 'claude-code/testing'

import { FOLLOWING } from './fixture'

const SIG = '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n'
const UUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

type Fetched = { url: string; method?: string }

function stub(on: Parameters<typeof mock.store>[0], username: string | undefined, answers: (url: string) => unknown, seen: Fetched[] = []) {
  mock.store(on, username ? { username } : {})
  mock.env(on, { HOME: '/tmp/devnull-test' })
  // Beneath this mod the band draws nothing of its own.
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Box', props: {}, children: [] }) as never)
  mock.clock(on, { now: Date.parse('2026-10-19T19:00:00Z') })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: SIG, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', async () => ({ value: true }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('http.fetch', async (_$: unknown, e: { url: string; init?: { method?: string } }) => {
    seen.push({ url: e.url, method: e.init?.method })
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(answers(e.url)) } }
  })
  return seen
}

const call = ($: any, tool: string, args: Record<string, unknown>): Promise<{ result?: string }> =>
  $.tool.call({ tool: `mcp__devnull__${tool}`, ...args })

test('the feed tool answers with one line per commit', async ($, on) => {
  stub(on, 'me', () => FOLLOWING)
  const out = await call($, 'devnull_feed', { log: 'following' })
  expect(out.result).toContain('[0a1b2c3 id=0a1b2c3d4e] @ada (Ada Example) · 30m · ★3 ↩0: shipped the thing')
  expect(out.result).toContain('next cursor: x')
  expect((out.result ?? '').length).toBeLessThan(8000)
})

test('signed out, every tool says how to sign in', async ($, on) => {
  const seen = stub(on, undefined, () => FOLLOWING)
  const out = await call($, 'devnull_feed', { log: 'latest' })
  expect(out.result).toBe('Not signed in to /dev/null. The user can run /devnull login.')
  expect(seen.length).toBe(0)
})

test('the thread tool accepts a link and reads ancestors and replies', async ($, on) => {
  const seen = stub(on, 'me', url =>
    url.includes('/replies')
      ? { data: [{ id: 'r1', body: 'a reply', author: { username: 'grace' } }] }
      : { data: { id: UUID, body: 'the root', author: { username: 'ada' } }, ancestors: [{ id: 'p1', body: 'parent', author: { username: 'linus' } }] },
  )
  const out = await call($, 'devnull_thread', { commit: `https://dev-null.sh/@ada/commits/${UUID}` })
  expect(seen[0]!.url).toContain(`/api/v1/commits/${UUID}`)
  expect(out.result).toContain('the root')
  expect(out.result).toContain('parent')
  expect(out.result).toContain('a reply')
})

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const

test('the draft tool shows the draft above the prompt and never posts or fills the prompt box', async ($, on) => {
  const seen = stub(on, 'me', () => FOLLOWING)
  let filled = false
  on('prompt.read', async () => ({ value: { text: '', cursor: 0 } }) as never)
  on('prompt.fill', async () => {
    filled = true
    return { isFilled: true, box: { text: '', cursor: 0 } } as never
  })
  const out = await call($, 'devnull_draft', { text: 'hello world', reply_to: UUID })
  expect(out.result).toContain('Nothing is posted until the user presses Post')
  expect(seen.some(f => f.method === 'POST')).toBe(false)
  expect(filled).toBe(false)
  const band = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...BAND })
  expect(await band.find({ type: 'Text', text: /hello world/ })).toBeDefined()
  expect((await band.find({ key: 'ship-post' }))?.text).toContain('Reply')
  await band.unmount()
  const short = await call($, 'devnull_draft', { text: 'hi' })
  expect(short.result).toContain('3 to 4000')
})

test('the Remotes draft tool waits for Push, then sends', async ($, on) => {
  const seen = stub(on, 'me', url => (url.includes('/remotes/') ? { data: { id: 1, user_id: 'u1', body: 'see you', reactions: [] } } : { data: { id: 'u1' } }))
  on('ui.toast', async () => ({ value: undefined }))
  const out = await call($, 'devnull_remote_draft', { username: 'ada', text: 'see you' })
  expect(out.result).toContain('Nothing is sent until the user presses Push')
  expect(seen.some(f => f.method === 'POST')).toBe(false)
  const band = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...BAND })
  expect(await band.find({ type: 'Text', text: /Push to @ada\?/ })).toBeDefined()
  await band.press({ key: 'ship-post' })
  expect(seen.some(f => f.method === 'POST' && f.url.endsWith('/api/v1/remotes/@ada/messages'))).toBe(true)
  await band.unmount()
  expect((await call($, 'devnull_remote_draft', { username: '../me', text: 'x' })).result).toBe('Give a valid username.')
})

test('what the read tools return is marked as untrusted, and a bad username is refused before any request', async ($, on) => {
  const seen = stub(on, 'me', () => FOLLOWING)
  const out = await call($, 'devnull_feed', { log: 'following' })
  expect(out.result).toContain('<untrusted source="dev-null.sh">')
  expect(out.result?.trimEnd().endsWith('</untrusted>')).toBe(true)
  const before = seen.length
  expect((await call($, 'devnull_profile', { username: '../../me' })).result).toContain('Give a valid username.')
  expect(seen.length).toBe(before)
})

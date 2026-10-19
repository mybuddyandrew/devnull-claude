import { expect, mock, test } from 'claude-code/testing'

import { FOLLOWING } from './fixture'

const SIG = '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n'
const UUID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

type Fetched = { url: string; method?: string }

function stub(on: Parameters<typeof mock.store>[0], username: string | undefined, answers: (url: string) => unknown, seen: Fetched[] = []) {
  mock.store(on, username ? { username } : {})
  mock.env(on, { HOME: '/tmp/devnull-test' })
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

test('the draft tool only fills the composer and never posts', async ($, on) => {
  const seen = stub(on, 'me', () => FOLLOWING)
  const out = await call($, 'devnull_draft', { text: 'hello world', reply_to: UUID })
  expect(out.result).toContain('The user must press Enter')
  expect(seen.some(f => f.method === 'POST')).toBe(false)
  const short = await call($, 'devnull_draft', { text: 'hi' })
  expect(short.result).toContain('3 to 4000')
})

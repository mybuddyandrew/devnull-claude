import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const ID = '5f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b'
const LINK = `https://dev-null.sh/@ada/commits/${ID}`

const commit = {
  id: ID,
  short_hash: '5f0c1a2',
  body: 'shipped the made-up thing',
  author: { username: 'ada', name: 'Ada Example', lane: 2, avatar_url: null },
  created_at: '2026-10-19T18:30:00Z',
  html_url: LINK,
  stars_count: 3,
  replies_count: 1,
}

function stub(on: On) {
  mock.store(on, { username: 'me' })
  mock.env(on, { HOME: '/tmp/devnull-test' })
  mock.clock(on, { now: Date.parse('2026-10-19T19:00:00Z') })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', async () => ({ value: true }))
  on('http.fetch', async (_$, e) => {
    const url = (e as unknown as { url: string }).url
    const json = url.endsWith('/replies')
      ? { data: [{ id: 'r1', body: 'nice one', author: { username: 'linus' }, stars_count: 0 }] }
      : { data: commit, ancestors: [] }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(json) } }
  })
}

const OUTPUT = (text: string) =>
  ({ command: 'devnull', args: `show ${LINK}`, text, isErrored: false }) as const

test('show returns markdown with the body and link', async ($, on) => {
  stub(on)
  const out = await $.command.run({ command: 'devnull', args: `show ${LINK}` } as unknown as Parameters<typeof $.command.run>[0])
  expect(out.text).toContain('shipped the made-up thing')
  expect(out.text).toContain('@ada')
  expect(out.text).toContain('nice one')
  expect(out.text).toContain('★ 3')
})

test('show with a short hash asks for a link', async ($, on) => {
  stub(on)
  const out = await $.command.run({ command: 'devnull', args: 'show 5f0c1a2' } as unknown as Parameters<typeof $.command.run>[0])
  expect(out.text).toContain('full dev-null.sh link')
})

test('the commit card mounts on desktop and terminal with the link', async ($, on) => {
  stub(on)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'devnull', surface, component: 'CommandOutput', props: OUTPUT('x') })
    expect(await ui.find({ type: 'Link', text: /Open on dev-null.sh/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Ada Example/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a pasted link adds the thread as context, plain text passes through', async ($, on) => {
  stub(on)
  let seen: readonly string[] | undefined
  on('prompt.submit', async (_$, e) => {
    seen = e.context
    return { text: e.text }
  })
  await $.prompt.submit({ text: `look at ${LINK} please`, wait: false, origin: { kind: 'composer' } })
  expect(seen?.[0]).toContain('shipped the made-up thing')
  seen = undefined
  await $.prompt.submit({ text: 'nothing to see', wait: false, origin: { kind: 'composer' } })
  expect(seen).toBeUndefined()
})

test('@ completion filters people', async ($, on) => {
  on('state.get', async (_$, e) => ({ value: { value: (e as { key: string }).key === 'people' ? ['Ada', 'adam', 'linus'] : undefined, version: 1 } }))
  on('prompt.autocomplete', async () => ({ suggestions: [] }))
  const out = await ($ as unknown as { prompt: { autocomplete: (i: unknown) => Promise<{ suggestions: { text: string }[] }> } }).prompt.autocomplete({ text: '@a', cursor: 2, token: '@a', start: 0 })
  expect(out.suggestions.map(s => s.text)).toEqual(['@Ada', '@adam'])
})

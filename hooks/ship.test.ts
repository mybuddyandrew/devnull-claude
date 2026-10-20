import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type Calls = { fetches: { url: string; method?: string; body?: string }[]; forks: number; completes: number; plays: number; prompts: string[]; clock: ReturnType<typeof mock.clock> }

// The work is a chain of awaits on stand-ins: yielding to the microtask queue lets it run to its end.
async function settle(): Promise<void> {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

function stand(on: On, opts: { username?: string; fork?: 'ok' | 'fail'; below?: string; git?: 'none' } = {}): Calls {
  const calls: Calls = { fetches: [], forks: 0, completes: 0, plays: 0, prompts: [], clock: undefined as never }
  mock.store(on, opts.username === undefined ? { username: 'me' } : {})
  mock.env(on, { HOME: '/tmp/devnull-test' })
  calls.clock = mock.clock(on, { now: Date.parse('2026-10-19T19:00:00Z') })
  on('process.run', async (_$: unknown, e: { argv?: readonly string[] }) => {
    const isGit = e.argv?.[0] === '/usr/bin/git'
    if (isGit && opts.git === 'none') return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
    const stdout = isGit ? 'Add thing\n\n hooks/ship.tsx | 12 ++++++------\n' : '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.cwd', async () => ({ value: '/tmp/devnull-test/repo' }) as never)
  on('fs.exists', async () => ({ value: true }))
  on('ui.toast', async () => ({ value: undefined }))
  // What draws in the band beneath this mod: nothing, or another mod's line.
  on('ui.render', { component: 'AbovePrompt' }, async () =>
    (opts.below ? { type: 'Text', props: {}, children: [opts.below] } : { type: 'Box', props: {}, children: [] }) as never,
  )
  on('audio.play', async () => {
    calls.plays++
    return { value: undefined }
  })
  on('model.fork', async (_$: unknown, e: { prompt: string }) => {
    calls.forks++
    calls.prompts.push(e.prompt)
    return opts.fork === 'fail'
      ? { value: { isAnswered: false, reason: 'api-error', status: null, error: 'unknown', usage: USAGE } as never }
      : { value: { isAnswered: true, text: '"Shipped the thing, finally."', usage: USAGE } }
  })
  on('model.complete', async (_$: unknown, e: { prompt: string }) => {
    calls.completes++
    if (calls.forks === 0) calls.prompts.push(e.prompt)
    return { value: { isAnswered: true, text: 'fallback post', usage: USAGE } }
  })
  on('http.fetch', async (_h: unknown, e: { url: string; init?: { method?: string; body?: string } }) => {
    calls.fetches.push({ url: e.url, method: e.init?.method, body: e.init?.body })
    return { value: { status: 201, ok: true, headers: {}, text: JSON.stringify({ data: { id: '01abcdef99', body: 'x', author: { username: 'me', lane: 0 } } }) } }
  })
  return calls
}

const bash = (command: string) => ({ tool: 'Bash', command }) as never

test('/devnull ship drafts with Haiku from the latest commit, never the whole session, and posting needs the press', async ($, on) => {
  const calls = stand(on)
  const out = await $.command.run({ command: 'devnull', args: 'ship' } as never)
  expect(out.text).toContain('Drafting with Haiku from the latest commit')
  await settle()
  expect(calls.forks).toBe(0)
  expect(calls.completes).toBe(1)
  expect(calls.prompts[0]).toContain('Add thing')
  const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /fallback post/ })).toBeDefined()
  expect(calls.fetches.some(f => f.method === 'POST')).toBe(false)
  await ui.press({ key: 'ship-post' })
  await settle()
  expect(calls.fetches.filter(f => f.method === 'POST' && /commits/.test(f.url)).length).toBe(1)
  await ui.unmount()
})

test('/devnull ship --full asks the session itself, and falls back to Haiku when that fails', async ($, on) => {
  const calls = stand(on, { fork: 'fail' })
  const out = await $.command.run({ command: 'devnull', args: 'ship --full the why' } as never)
  expect(out.text).toContain('whole session')
  await settle()
  expect(calls.forks).toBe(1)
  expect(calls.completes).toBe(1)
  expect(calls.prompts[0]).toContain('Focus on: the why')
  expect(calls.prompts[0]).not.toContain('--full')
})

test('a commit no longer drafts anything by itself', async ($, on) => {
  on('tool.call', async () => ({ result: { stdout: '[main abc] Add thing', stderr: '' }, text: '[main abc] Add thing' }))
  const calls = stand(on)
  await $.tool.call(bash('git commit -m "Add thing"'))
  await settle()
  expect(calls.forks + calls.completes).toBe(0)
})

test('signed out, or with no commit and nothing said, nothing is drafted', async ($, on) => {
  const calls = stand(on, { username: '', git: 'none' })
  expect((await $.command.run({ command: 'devnull', args: 'ship' } as never)).text).toContain('Not signed in')
  expect(calls.forks + calls.completes).toBe(0)
})

test('with no commit here, ship says so and draft asks what it is about', async ($, on) => {
  const calls = stand(on, { git: 'none' })
  expect((await $.command.run({ command: 'devnull', args: 'ship' } as never)).text).toContain('No commit found')
  expect((await $.command.run({ command: 'devnull', args: 'draft' } as never)).text).toContain('Say what the post is about')
  await settle()
  expect(calls.forks + calls.completes).toBe(0)
})

test('the posted note clearing itself never clears a newer draft', async ($, on) => {
  const { clock } = stand(on)
  await $.command.run({ command: 'devnull', args: 'post first post' } as never)
  const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...BAND })
  await ui.press({ key: 'ship-post' })
  await settle()
  await clock.advance(3_000)
  await $.command.run({ command: 'devnull', args: 'post second thoughts' } as never)
  await clock.advance(10_000)
  expect(await ui.find({ type: 'Text', text: /second thoughts/ })).toBeDefined()
  await ui.unmount()
})

test('pressing Post twice posts once', async ($, on) => {
  const calls = stand(on)
  await $.command.run({ command: 'devnull', args: 'post only once please' } as never)
  const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...BAND })
  await Promise.all([ui.press({ key: 'ship-post' }), ui.press({ key: 'ship-post' })])
  await settle()
  expect(calls.fetches.filter(f => f.method === 'POST' && /commits/.test(f.url)).length).toBe(1)
  await ui.unmount()
})

test('the band keeps what other mods draw there, and gives way to a survey', async ($, on) => {
  stand(on, { below: 'another mod' })
  await $.command.run({ command: 'devnull', args: 'post shared space' } as never)
  const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /another mod/ })).toBeDefined()
  expect(await ui.find({ key: 'ship-post' })).toBeDefined()
  await ui.unmount()
  const survey = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await survey.find({ key: 'ship-post' })).toBeUndefined()
  await survey.unmount()
})

test('after a post the band says so, then clears by itself', async ($, on) => {
  const { clock } = stand(on)
  await $.command.run({ command: 'devnull', args: 'post a thing' } as never)
  const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...BAND })
  await ui.press({ key: 'ship-post' })
  await settle()
  expect(await ui.find({ type: 'Text', text: /Posted to \/dev\/null/ })).toBeDefined()
  await clock.advance(10_000)
  expect(await ui.find({ type: 'Text', text: /Posted to \/dev\/null/ })).toBeUndefined()
  await ui.unmount()
})

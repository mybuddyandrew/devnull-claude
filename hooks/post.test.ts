import { expect, mock, test } from 'claude-code/testing'

const run = (args: string) => ({ command: 'devnull', args }) as never

// Lets work the command started without awaiting (the model call) finish.
async function settle(): Promise<void> {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const

test('/devnull post waits in the band and only the Post press sends it, line breaks kept', async ($, on) => {
  mock.store(on, { username: 'me' })
  mock.env(on, { HOME: '/tmp/devnull-test' })
  mock.clock(on, { now: Date.parse('2026-10-19T19:00:00Z') })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', async () => ({ value: true }))
  on('ui.toast', async () => ({ value: undefined }))
  on('audio.play', async () => ({ value: undefined }))
  const posted: string[] = []
  on('http.fetch', async (_$, e) => {
    if (e.init?.method === 'POST') posted.push(e.init.body ?? '')
    const data = { id: '00000000-0000-4000-8000-000000000001', body: 'x', author: { username: 'me' }, html_url: 'https://dev-null.sh/commits/1' }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(e.init?.method === 'POST' ? { data } : { data: [], meta: {} }) } }
  })
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'startup' })

  const out = await $.command.run(run('post first line\n\nsecond line'))
  expect(out.text).toContain('press Post')
  expect(posted).toHaveLength(0)

  const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /first line/ })).toBeDefined()
  await ui.press({ key: 'ship-post' })
  expect(posted).toHaveLength(1)
  expect(JSON.parse(posted[0]!)).toEqual({ body: 'first line\n\nsecond line' })
  await ui.unmount()

  const short = await $.command.run(run('post hi'))
  expect(short.text).toContain('at least 3 characters')
  expect(posted).toHaveLength(1)
})

test('/devnull draft sums up the session into the band, focus passed to the model', async ($, on) => {
  mock.store(on, { username: 'me' })
  mock.env(on, { HOME: '/tmp/devnull-test' })
  mock.clock(on, { now: Date.parse('2026-10-19T19:00:00Z') })
  const asked: string[] = []
  on('model.fork', async (_$, e) => {
    asked.push(e.prompt)
    return { value: { isAnswered: true, text: 'Taught my Claude Code pane to scroll forever.', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'startup' })

  const out = await $.command.run(run('draft the scrolling fix'))
  expect(out.text).toContain('Drafting a post about this session')
  await settle()
  expect(asked[0]).toContain('Focus on: the scrolling fix')

  const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /scroll forever/ })).toBeDefined()
  expect(await ui.find({ key: 'ship-post' })).toBeDefined()
  await ui.unmount()
})

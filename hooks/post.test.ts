import { expect, mock, test } from 'claude-code/testing'

const run = (args: string) => ({ command: 'devnull', args }) as never

test('/devnull post sends what was typed, line breaks kept', async ($, on) => {
  mock.store(on, { username: 'me' })
  mock.env(on, { HOME: '/tmp/devnull-test' })
  mock.clock(on, { now: Date.parse('2026-10-19T19:00:00Z') })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', async () => ({ value: true }))
  on('ui.toast', async () => ({ value: undefined }))
  const posted: string[] = []
  on('http.fetch', async (_$, e) => {
    if (e.init?.method === 'POST') posted.push(e.init.body ?? '')
    const data = { id: '00000000-0000-4000-8000-000000000001', body: 'x', author: { username: 'me' }, html_url: 'https://dev-null.sh/commits/1' }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(e.init?.method === 'POST' ? { data } : { data: [], meta: {} }) } }
  })
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'startup' })

  const out = await $.command.run(run('post first line\n\nsecond line'))
  expect(posted).toHaveLength(1)
  expect(JSON.parse(posted[0]!)).toEqual({ body: 'first line\n\nsecond line' })
  expect(out.text).toContain('Committed on /dev/null')

  const short = await $.command.run(run('post hi'))
  expect(short.text).toContain('at least 3 characters')
  expect(posted).toHaveLength(1)
})

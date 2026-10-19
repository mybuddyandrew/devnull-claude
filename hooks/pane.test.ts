import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'devnull',
  props: { title: '/dev/null', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

// Made-up commits, every other one with a reply, about the size of real ones.
const commit = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  short_hash: `abc${i}`,
  body: 'x'.repeat(150),
  created_at: '2026-10-19T18:30:00Z',
  html_url: `https://dev-null.sh/commits/${i}`,
  stars_count: 1,
  replies_count: 1,
  starred: false,
  is_saved: false,
  images: [],
  author: { username: `user${i}`, name: `User ${i}`, lane: i % 6, avatar_url: null },
  reply_preview: { data: [] },
  ...extra,
})

test('however many commits are loaded, the pane draws a bounded window', async ($, on) => {
  mock.store(on, { username: 'me' })
  mock.env(on, { HOME: '/tmp/devnull-test' })
  mock.clock(on, { now: Date.parse('2026-10-19T19:00:00Z') })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', async () => ({ value: true }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.toast', async () => ({ value: undefined }))
  const data = Array.from({ length: 60 }, (_, i) => commit(i, i % 2 ? { reply_preview: { data: [commit(i + 100)] } } : {}))
  on('http.fetch', async () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ data, meta: {} }) } }))
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'startup' })
  await $.command.run({ command: 'devnull', args: '' } as unknown as Parameters<typeof $.command.run>[0])

  const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...PANE })
  const tree = JSON.stringify(await ui.drawn())
  expect(tree.length).toBeLessThan(150_000)
  expect(await ui.find({ key: `star-0-${data[0]!.id}` })).toBeDefined()
  expect(await ui.find({ key: `star-0-${data[14]!.id}` })).toBeDefined()
  expect(await ui.find({ key: `star-0-${data[15]!.id}` })).toBeUndefined()
  expect(await ui.find({ key: 'more' })).toBeDefined()
  expect(await ui.find({ key: 'newer' })).toBeUndefined()

  // Load more slides the window down; the newer button appears to slide back.
  await ui.press({ key: 'more' })
  expect(await ui.find({ key: `star-0-${data[0]!.id}` })).toBeUndefined()
  expect(await ui.find({ key: `star-0-${data[20]!.id}` })).toBeDefined()
  expect(await ui.find({ key: 'newer' })).toBeDefined()
  await ui.press({ key: 'newer' })
  expect(await ui.find({ key: `star-0-${data[0]!.id}` })).toBeDefined()
  await ui.unmount()
})

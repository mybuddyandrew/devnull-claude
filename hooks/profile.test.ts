import { expect, mock, test } from 'claude-code/testing'

import { handleFromHref, linkMentions, MENTION_HREF, mentionsIn } from './text'
import { toProfileView } from './profile'

const NOW = Date.parse('2026-10-19T19:00:00Z')

const PANE = {
  component: 'Pane',
  requestId: 'devnull',
  props: { title: '/dev/null', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const

test('mentions are found and linked outside code only', async () => {
  const text = 'hi @ada and @grace-h, not `@code` or me@example.com\n```\n@fenced\n```\nbye @ada'
  expect(mentionsIn(text)).toEqual(['ada', 'grace-h'])
  const linked = linkMentions(text)
  expect(linked).toContain(`[@ada](${MENTION_HREF}ada)`)
  expect(linked).toContain(`[@grace-h](${MENTION_HREF}grace-h)`)
  expect(linked).toContain('`@code`')
  expect(linked).toContain('me@example.com')
  expect(linked).toContain('\n@fenced\n')
  expect(handleFromHref(`${MENTION_HREF}ada`)).toBe('ada')
  expect(handleFromHref('https://example.com/@ada')).toBeUndefined()
})

test('a profile reads its counts, follow state and earned badges only', async () => {
  const json = {
    data: { username: 'ada', name: 'Ada Example', bio: 'builds things', lane: 2, commits_count: 12, followers_count: 3, following_count: 4 },
    is_following: true,
    follows_you: false,
    streaks: { current: 2, longest: 9 },
    achievements: { rank: 'operator', level: 3, xp: 300, badges: [{ id: 'init', name: 'init', unlocked: true }, { id: 'luddite', name: 'luddite', unlocked: false }] },
    activity: { scale: 'week', buckets: [{ date: '2026-10-19', count: 1 }] },
  }
  const v = toProfileView('ada', json, 'me', NOW)
  expect(v).toMatchObject({ username: 'ada', name: 'Ada Example', commits: 12, followers: 3, following: 4, isFollowing: true, followsYou: false, isMe: false, badges: ['init'] })
  expect(v.stats).toMatchObject({ streak: 2, longest: 9, rank: 'operator' })
  expect(toProfileView('ada', json, 'Ada', NOW).isMe).toBe(true)
})

test('a handle opens the profile in the pane, Follow follows, Back returns', async ($, on) => {
  mock.store(on, { username: 'me' })
  mock.env(on, { HOME: '/tmp/devnull-test' })
  // Beneath this mod the band draws nothing of its own.
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Box', props: {}, children: [] }) as never)
  mock.clock(on, { now: NOW })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', async () => ({ value: true }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.toast', async () => ({ value: undefined }))
  const calls: string[] = []
  const log = { data: [{ id: '00000000-0000-4000-8000-000000000001', short_hash: 'abc', body: 'hello @grace', author: { username: 'ada', name: 'Ada Example', lane: 1 }, reply_preview: { data: [] } }], meta: {} }
  const ada = { data: { username: 'ada', name: 'Ada Example', followers_count: 3 }, is_following: false, streaks: { current: 1, longest: 1 }, achievements: {}, activity: { scale: 'week', buckets: [] } }
  on('http.fetch', async (_$, e) => {
    const method = e.init?.method ?? 'GET'
    const path = new URL(e.url).pathname
    calls.push(`${method} ${path}`)
    const body = path === '/api/v1/users/ada' ? ada : path.endsWith('/follow') ? {} : log
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'startup' })
  await $.command.run({ command: 'devnull', args: '' } as never)

  const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...PANE })
  await ui.press({ key: 'who-0-00000000-0000-4000-8000-000000000001' })
  expect(await ui.find({ type: 'Text', text: /Ada Example/ })).toBeDefined()
  expect(await ui.find({ key: 'profile-follow' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /3 followers/ })).toBeDefined()

  await ui.press({ key: 'profile-follow' })
  expect(calls).toContain('POST /api/v1/users/ada/follow')
  expect(await ui.find({ type: 'Text', text: /4 followers/ })).toBeDefined()

  await ui.press({ key: 'profile-back' })
  expect(await ui.find({ key: 'tab-following' })).toBeDefined()
  await ui.unmount()
})

test('the post band names who a post tags', async ($, on) => {
  mock.store(on, { username: 'me' })
  mock.env(on, { HOME: '/tmp/devnull-test' })
  // Beneath this mod the band draws nothing of its own.
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'startup' })
  await $.command.run({ command: 'devnull', args: 'post thanks @ada and @grace for the help' } as never)
  const ui = await $.ui.mount({ plugin: 'devnull', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /Tagging @ada, @grace/ })).toBeDefined()
  await ui.unmount()
})

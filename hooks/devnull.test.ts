import { expect, mock, test } from 'claude-code/testing'

import { FOLLOWING } from './fixture'

import { RAIL, preview, authorizeUrl, avatarSvg, laneColor, parseCallback, patchCommit, query, signingMessage, target, toCommitRow, toNoteRow, unarmor } from './devnull'

const PANE = {
  component: 'Pane',
  requestId: 'devnull',
  props: { title: '/dev/null', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('builds targets and the signed message as the PHP client does', async () => {
  expect(target('log/latest', { cursor: null })).toBe('/api/v1/log/latest')
  expect(target('notifications', { type: null, cursor: 'a b!' })).toBe('/api/v1/notifications?cursor=a%20b%21')
  expect(signingMessage('1700000000', 'ab', 'get', '/api/v1/me', '')).toBe('1700000000\nab\nGET\n/api/v1/me\n')
  expect(query({ redirect_uri: 'devnull://auth/callback' })).toBe('redirect_uri=devnull%3A%2F%2Fauth%2Fcallback')
  expect(authorizeUrl({ fingerprint: 'SHA256:x', deviceName: 'Claude Code', challenge: 'c', state: 's' })).toContain(
    '/mobile/authorize?fingerprint=SHA256%3Ax&device_name=Claude%20Code&code_challenge=c&code_challenge_method=S256&state=s',
  )
})

test('cuts long bodies without leaving a code fence open', async () => {
  expect(preview('short').isCut).toBe(false)
  const long = preview(['intro', '```zig', ...Array.from({ length: 20 }, (_, i) => `line ${i}`), '```'].join('\n'))
  expect(long.isCut).toBe(true)
  expect((long.text.match(/```/g) ?? []).length % 2).toBe(0)
})

test('reads ssh-keygen output and the callback link', async () => {
  expect(unarmor('-----BEGIN SSH SIGNATURE-----\nU1NI\nU0lH\n-----END SSH SIGNATURE-----\n')).toBe('U1NIU0lH')
  expect(parseCallback('devnull://auth/callback?code=abc&state=x%2Fy')).toEqual({ code: 'abc', state: 'x/y', error: undefined })
  expect(parseCallback('devnull://auth/callback?error=access_denied&state=s').error).toBe('access_denied')
})

test('maps API commits and notifications to rows', async () => {
  const row = toCommitRow({ id: '01abcdef99', body: 'hello', stars_count: 2, author: { username: 'kim', lane: '#ff00aa' } })
  expect(row).toMatchObject({ hash: '01abcde', username: 'kim', lane: '#ff00aa', stars: 2, replies: 0 })
  expect(toCommitRow({ id: '1', author: { lane: 'blue' } }).lane).toBe(RAIL)
  expect(laneColor(3)).toBe('#3bc9db')
  expect(laneColor('#C70A0A')).toBe('#c70a0a')
  const thread = toCommitRow({ id: 'p', author: { lane: 0 }, reply_preview: { data: [{ id: 'r', starred: false, stars_count: 0, author: { username: 'sam' } }] } })
  expect(thread.replyPreview[0]?.username).toBe('sam')
  const starred = patchCommit([thread], 'r', r => ({ ...r, isStarred: true, stars: 1 }))
  expect(starred[0]?.replyPreview[0]).toMatchObject({ isStarred: true, stars: 1 })
  expect(avatarSvg('#51cf66', 36, undefined, '<x>')).toContain('&lt;')
  const note = toNoteRow({ id: 'n1', type: 'star', actors: [{ username: 'a' }, { username: 'b' }], unread_count: 1, commit: { body: 'x' } })
  expect(note).toMatchObject({ actor: 'a', others: 1, isUnread: true, excerpt: 'x' })
})

test('signed out, the pane offers sign-in on every surface', async $ => {
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'devnull', surface, ...PANE })
    expect(await ui.find({ key: 'sign-in' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /social network for devs/ })).toBeDefined()
    await ui.unmount()
  }
})

test('signed in, the feed draws on the desktop', async ($, on) => {
  mock.store(on, { username: 'me' })
  mock.env(on, { HOME: '/tmp/devnull-test' })
  mock.clock(on, { now: Date.parse('2026-10-19T19:00:00Z') })
  on('process.run', async () => ({ value: { exitCode: 0, stdout: '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.exists', async () => ({ value: true }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.toast', async () => ({ value: undefined }))
  on('http.fetch', async () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(FOLLOWING) } }))
  on('classic.SessionStart', async () => ({}))
  await $.classic.SessionStart({ source: 'startup' })
  await $.command.run({ command: 'devnull', args: '' } as unknown as Parameters<typeof $.command.run>[0])
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'devnull', surface, ...PANE })
    expect(await ui.find({ key: 'tab-following' })).toBeDefined()
    expect(await ui.find({ key: `star-0-${FOLLOWING.data[0]!.id}` })).toBeDefined()
    expect(await ui.find({ key: 'reply-1-reply-1' })).toBeDefined()
    await ui.unmount()
  }
})

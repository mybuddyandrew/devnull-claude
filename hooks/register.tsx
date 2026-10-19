import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, Timer } from 'claude-code'

import type { CommitRow, Compose, Feed, Login, Tab } from '../types'
import {
  BASE_URL,
  NAMESPACE,
  NOTE_KINDS,
  ago,
  avatarSvg,
  preview,
  tailSvg,
  underlineSvg,
  TAIL_HEIGHT,
  patchCommit,
  authorizeUrl,
  base64Url,
  challenge,
  dataList,
  fingerprintOf,
  hex,
  parseCallback,
  randomBytes,
  signingMessage,
  target,
  toCommitRow,
  toNoteRow,
  unarmor,
} from './devnull'

const PANE = 'devnull'
const TABS: Tab[] = ['following', 'latest', 'trending', 'notifications']
const LABELS: Record<Tab, string> = { following: 'Following', latest: 'Latest', trending: 'Trending', notifications: 'Notifications' }
// The web app's dark tokens.
const PRIMARY = '#7aa2f7'
const MUTED = '#a1a1a6'
const HAIRLINE = '#2a2a2d'
const STAR = '#fcc419'
const DANGER = '#ff6b6b'
// Avatar photos are embedded in the tree: one may be at most 8 KB, and one draw carries 50 KB of them.
const AVATAR_MAX_CHARS = 8_000
const AVATAR_BUDGET_CHARS = 50_000
const LOGIN_WINDOW_MS = 5 * 60 * 1000
const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

const tab = atom({ plugin: 'devnull', key: 'tab' } as const, 'following' as Tab)
const feed = atom({ plugin: 'devnull', key: 'feed' } as const, { isLoading: false, commits: [], notifications: [] } as Feed)
const login = atom({ plugin: 'devnull', key: 'login' } as const, { status: 'signed-out' } as Login)
const avatars = atom({ plugin: 'devnull', key: 'avatars' } as const, {} as Record<string, string>)
const compose = atom({ plugin: 'devnull', key: 'compose' } as const, { mode: 'new', isSending: false, round: 0 } as Compose)
const expanded = atom({ plugin: 'devnull', key: 'expanded' } as const, [] as string[])

type Pending = { verifier: string; state: string; startedAt: number }
type Paths = { dir: string; key: string; callback: string; app: string }

let poller: Timer | undefined

const paths = async ($: EngineInterface): Promise<Paths> => {
  const dir = `${(await $.env.get('HOME')) ?? ''}/.devnull-claude`
  return { dir, key: `${dir}/id_ed25519`, callback: `${dir}/callback`, app: `${dir}/Devnull Callback.app` }
}

const run = async ($: EngineInterface, argv: string[], stdin?: string): Promise<string> => {
  const out = await $.process.run(argv, { stdin })
  if (out.exitCode !== 0) throw new Error(`${argv[0]}: ${out.stderr.trim() || `exit ${out.exitCode}`}`)
  return out.stdout
}

// This device's key: made once, kept in ~/.devnull-claude, never leaves the machine.
const ensureKey = async ($: EngineInterface, p: Paths): Promise<void> => {
  if (await $.fs.exists(p.key)) return
  await run($, ['mkdir', '-p', '-m', '700', p.dir])
  await run($, ['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'devnull-claude-code', '-f', p.key])
}

// dev-null.sh only sends its code back to devnull://, so a tiny local applet
// claims that scheme and drops the URL in a file this mod polls.
const ensureHandler = async ($: EngineInterface, p: Paths): Promise<void> => {
  if (await $.fs.exists(p.app)) return
  const script = `${p.dir}/callback.applescript`
  await $.fs.write(
    script,
    [
      'on open location theURL',
      `\tdo shell script "umask 077; printf '%s' " & quoted form of theURL & " > " & quoted form of "${p.callback}"`,
      'end open location',
      '',
    ].join('\n'),
  )
  const plist = `${p.app}/Contents/Info.plist`
  await run($, ['osacompile', '-o', p.app, script])
  await run($, ['plutil', '-insert', 'CFBundleURLTypes', '-json', '[{"CFBundleURLName":"sh.dev-null.claude-callback","CFBundleURLSchemes":["devnull"]}]', plist])
  await run($, ['plutil', '-replace', 'CFBundleIdentifier', '-string', 'sh.dev-null.claude-callback', plist])
  await run($, ['plutil', '-insert', 'LSBackgroundOnly', '-bool', 'YES', plist])
  await run($, ['codesign', '--force', '--deep', '--sign', '-', p.app])
  await run($, [LSREGISTER, '-f', p.app])
}

const signedHeaders = async ($: EngineInterface, p: Paths, method: string, tgt: string, body: string) => {
  const timestamp = String(Math.floor((await $.clock.now()) / 1000))
  const nonce = hex(randomBytes(16))
  const armored = await run($, ['ssh-keygen', '-Y', 'sign', '-n', NAMESPACE, '-f', p.key], signingMessage(timestamp, nonce, method, tgt, body))
  return { 'X-Devnull-Timestamp': timestamp, 'X-Devnull-Nonce': nonce, 'X-SSH-Signature': unarmor(armored) }
}

const api = async (
  $: EngineInterface,
  method: string,
  path: string,
  params: Record<string, string | null | undefined> = {},
  payload?: Record<string, string>,
): Promise<unknown> => {
  const p = await paths($)
  const tgt = target(path, params)
  const body = payload ? JSON.stringify(payload) : ''
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== '') headers['Content-Type'] = 'application/json'
  // Every request is signed: dev-null.sh serves no logs to guests.
  Object.assign(headers, await signedHeaders($, p, method, tgt, body))

  const res = await $.http.fetch(BASE_URL + tgt, { method, headers, body: body || undefined })
  let json: unknown = {}
  try {
    json = JSON.parse(res.text)
  } catch {}
  if (!res.ok) {
    const message = (json as { message?: unknown }).message
    throw new Error(`${res.status} ${typeof message === 'string' ? message : ''}`.trim())
  }
  return json
}

const nextCursorOf = (json: unknown): string | undefined => {
  const cursor = (json as { meta?: { next_cursor?: unknown } }).meta?.next_cursor
  return typeof cursor === 'string' && cursor !== '' ? cursor : undefined
}

const refresh = async ($: EngineInterface, more = false): Promise<void> => {
  const showing = await read($, tab)
  if (!(await $.store.get('username'))) return
  const cursor = more ? (await read($, feed)).nextCursor : undefined
  await update($, feed, f => ({ ...f, isLoading: true, error: undefined }))
  try {
    if (showing === 'notifications') {
      // Listing notifications marks them read on dev-null.sh, as the web does.
      const json = await api($, 'GET', 'notifications', { cursor })
      const rows = dataList(json).map(toNoteRow)
      await update($, feed, f => ({ ...f, isLoading: false, notifications: more ? [...f.notifications, ...rows] : rows, nextCursor: nextCursorOf(json), fetchedAt: Date.now() }))
      void loadAvatars($, rows.map(r => [r.actor, r.avatarUrl]))
    } else {
      const json = await api($, 'GET', `log/${showing}`, { cursor })
      const rows = dataList(json).map(toCommitRow)
      await update($, feed, f => ({ ...f, isLoading: false, commits: more ? [...f.commits, ...rows] : rows, nextCursor: nextCursorOf(json), fetchedAt: Date.now() }))
      const people = rows.flatMap(r => [r, ...r.replyPreview, ...(r.quoted ? [r.quoted] : [])])
      void loadAvatars($, people.map(r => [r.username, r.avatarUrl]))
    }
  } catch (error) {
    await update($, feed, f => ({ ...f, isLoading: false, error: String((error as Error).message ?? error) }))
  }
}

// Avatars arrive as data: URIs so the SVG ring can draw them with no network of its own.
const loadAvatars = async ($: EngineInterface, people: [string, string | undefined][]): Promise<void> => {
  const have = await read($, avatars)
  const wanted = new Map(people.filter((p): p is [string, string] => !!p[1] && !((have[p[0]]?.length ?? Infinity) <= AVATAR_MAX_CHARS)))
  const queue = [...wanted]
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await fetchAvatar(next)
  }
  await Promise.all([worker(), worker(), worker(), worker()])

  async function fetchAvatar([username, url]: [string, string]): Promise<void> {
    {
      try {
        const sized = url + (url.includes('?') ? '&' : '?') + 's=64'
        // Every avatar rides inside the drawn tree, which the desktop drops past a few hundred KB:
        // sips shrinks each to a small JPEG (about 2.5 KB of base64).
        const script = 't=$(mktemp); curl -sfL --max-time 10 "$1" -o "$t" && sips -s format jpeg -s formatOptions 55 -Z 64 "$t" --out "$t.jpg" >/dev/null 2>&1 && base64 < "$t.jpg"; rm -f "$t" "$t.jpg"'
        const out = await $.process.run(['/bin/sh', '-c', script, 'sh', sized])
        const b64 = out.stdout.replace(/\s+/g, '')
        if (out.exitCode !== 0 || b64 === '' || b64.length > AVATAR_MAX_CHARS) return
        await update($, avatars, a => ({ ...a, [username]: `data:image/jpeg;base64,${b64}` }))
      } catch {}
    }
  }
}

const show = async ($: EngineInterface, next: Tab): Promise<void> => {
  await update($, tab, () => next)
  await update($, feed, f => ({ ...f, commits: [], notifications: [], nextCursor: undefined }))
  await refresh($)
}

const commitPath = (id: string, rest: string) => `commits/${encodeURIComponent(id)}/${rest}`

// Star, unstar, save and unsave answer with the commit; its counts replace every copy shown.
const react = async ($: EngineInterface, row: CommitRow, kind: 'star' | 'save'): Promise<void> => {
  const on = kind === 'star' ? !row.isStarred : !row.isSaved
  const method = kind === 'star' ? (on ? 'POST' : 'DELETE') : on ? 'PUT' : 'DELETE'
  const optimistic = (r: CommitRow): CommitRow =>
    kind === 'star' ? { ...r, isStarred: on, stars: Math.max(0, r.stars + (on ? 1 : -1)) } : { ...r, isSaved: on }
  await update($, feed, f => ({ ...f, commits: patchCommit(f.commits, row.id, optimistic) }))
  try {
    const json = (await api($, method, commitPath(row.id, kind === 'star' ? 'star' : 'bookmark'))) as { data?: Record<string, unknown> }
    if (json.data) {
      const fresh = toCommitRow(json.data)
      await update($, feed, f => ({
        ...f,
        commits: patchCommit(f.commits, row.id, r => ({ ...r, stars: fresh.stars, isStarred: fresh.isStarred, isSaved: kind === 'save' ? on : r.isSaved })),
      }))
    }
  } catch (error) {
    await update($, feed, f => ({ ...f, commits: patchCommit(f.commits, row.id, () => row) }))
    $.ui.toast(`/dev/null: ${(error as Error).message}`)
  }
}

const aim = async ($: EngineInterface, mode: Compose['mode'], row?: CommitRow): Promise<void> => {
  await update($, compose, c => ({ ...c, mode, targetId: row?.id, targetHandle: row?.username, error: undefined }))
}

// Commits the composer's text as a new commit, a reply or a quote.
const send = async ($: EngineInterface, text: string): Promise<void> => {
  const body = text.trim()
  const c = await read($, compose)
  if (body === '' || c.isSending) return
  await update($, compose, x => ({ ...x, isSending: true, error: undefined }))
  const payload: Record<string, string> = { body }
  if (c.mode === 'reply' && c.targetId) payload.parent_id = c.targetId
  if (c.mode === 'quote' && c.targetId) payload.quoted_commit_id = c.targetId
  try {
    await api($, 'POST', 'commits', {}, payload)
    await update($, compose, (x): Compose => ({ mode: 'new', isSending: false, round: x.round + 1 }))
    $.ui.toast(c.mode === 'reply' ? '/dev/null: replied' : c.mode === 'quote' ? '/dev/null: quoted' : '/dev/null: committed')
    if (c.mode === 'reply' && c.targetId) {
      const id = c.targetId
      await update($, feed, f => ({ ...f, commits: patchCommit(f.commits, id, r => ({ ...r, replies: r.replies + 1 })) }))
    }
    await refresh($)
  } catch (error) {
    await update($, compose, x => ({ ...x, isSending: false, error: (error as Error).message }))
  }
}

const stopPolling = () => {
  poller?.cancel()
  poller = undefined
}

const finish = async ($: EngineInterface, url: string): Promise<string> => {
  stopPolling()
  const pending = (await $.store.get('pending')) as Pending | undefined
  const answer = parseCallback(url)
  const fail = async (message: string) => {
    await $.store.delete('pending')
    await update($, login, (): Login => ({ status: 'failed', message }))
    return message
  }
  if (!pending) return fail('No sign-in under way. Run /devnull login first.')
  if (answer.state !== pending.state) return fail('That link is for another sign-in. Run /devnull login again.')
  if (answer.error || !answer.code) return fail(`dev-null.sh said: ${answer.error ?? 'no code'}`)

  try {
    const json = (await api($, 'POST', 'devices', {}, { code: answer.code, code_verifier: pending.verifier })) as { data?: { username?: string } }
    const username = json.data?.username ?? '?'
    await $.store.delete('pending')
    await $.store.set('username', username)
    await update($, login, (): Login => ({ status: 'signed-in', username }))
    $.ui.toast(`/dev/null: signed in as @${username}`)
    await show($, 'following')
    return `Signed in to dev-null.sh as @${username}.`
  } catch (error) {
    return fail(`Sign-in failed: ${(error as Error).message}`)
  }
}

const poll = ($: EngineInterface, pending: Pending) => {
  stopPolling()
  poller = $.clock.every(1500, () => {
    void (async () => {
      const p = await paths($)
      if (await $.fs.exists(p.callback)) {
        const url = await $.fs.read(p.callback)
        await run($, ['rm', '-f', p.callback])
        await finish($, url)
      } else if (Date.now() - pending.startedAt > LOGIN_WINDOW_MS) {
        stopPolling()
        await $.store.delete('pending')
        await update($, login, (): Login => ({ status: 'failed', message: 'Sign-in timed out. Run /devnull login again.' }))
      }
    })()
  })
}

const startLogin = async ($: EngineInterface): Promise<string> => {
  const p = await paths($)
  await ensureKey($, p)
  await ensureHandler($, p)
  await run($, ['rm', '-f', p.callback])

  const verifier = base64Url(randomBytes(32))
  const pending: Pending = { verifier, state: base64Url(randomBytes(16)), startedAt: Date.now() }
  await $.store.set('pending', pending)
  const fingerprint = fingerprintOf(await run($, ['ssh-keygen', '-lf', `${p.key}.pub`]))
  const url = authorizeUrl({ fingerprint, deviceName: 'Claude Code', challenge: await challenge(verifier), state: pending.state })

  await update($, login, (): Login => ({ status: 'waiting' }))
  await run($, ['open', url])
  poll($, pending)

  return [
    'Opened dev-null.sh in your browser. Approve this device there and the pane signs in by itself.',
    'If nothing happens after Approve, paste the devnull://auth/callback… link: /devnull login <link>',
  ].join('\n')
}

const logout = async ($: EngineInterface): Promise<string> => {
  stopPolling()
  await $.store.delete('username')
  await $.store.delete('pending')
  await update($, login, (): Login => ({ status: 'signed-out' }))
  await show($, 'following')
  return 'Signed out here. The device key stays in ~/.devnull-claude; remove the device on dev-null.sh to revoke it.'
}

// The store holds who this device is signed in as; the pane's state follows it.
const syncLogin = async ($: EngineInterface): Promise<void> => {
  const username = (await $.store.get('username')) as string | undefined
  await update($, login, (l): Login => (l.status === 'waiting' ? l : username ? { status: 'signed-in', username } : { status: 'signed-out' }))
}

const openPane = async ($: EngineInterface) => {
  await syncLogin($)
  await $.ui.open({ id: PANE, title: '/dev/null' })
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'devnull',
      description: 'Open the /dev/null pane (log + notifications)',
      argumentHint: '[login [callback-url] | logout | refresh]',
    })
    await syncLogin($)
    const pending = (await $.store.get('pending')) as Pending | undefined
    if (pending && Date.now() - pending.startedAt < LOGIN_WINDOW_MS) poll($, pending)
    return next(e)
  })

  on('command.run', { command: 'devnull' }, async ($, e) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    if (sub === 'login') {
      await $.ui.open({ id: PANE, title: '/dev/null' })
      return { text: rest[0] ? await finish($, rest.join('')) : await startLogin($) }
    }
    if (sub === 'logout') return { text: await logout($) }
    await openPane($)
    return { text: '/dev/null pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawPane($, e))
}

const drawPane = async ($: EngineInterface, e: RenderInput) => {
    try {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link, Markdown } = els
    // The terminal draws no SVG and the phone no text field: they get a dot and no composer.
    const Svg = 'Svg' in els ? els.Svg : undefined
    const Input = 'Input' in els ? els.Input : undefined
    const showing = await read($, tab)
    const f = await read($, feed)
    const who = await read($, login)
    const faces = await read($, avatars)
    const draft = await read($, compose)
    const open = await read($, expanded)
    const now = Date.now()

    // Photos past the budget fall back to initials, so one draw stays well under what the desktop takes.
    let photoBudget = AVATAR_BUDGET_CHARS
    const ring = (lane: string, username: string, size: number) => {
      if (!Svg) return <Text color={lane}>●</Text>
      const face = faces[username]
      const photo = face && face.length <= AVATAR_MAX_CHARS && face.length <= photoBudget ? face : undefined
      if (photo) photoBudget -= photo.length
      return <Svg source={avatarSvg(lane, size, photo, username)} alt={`@${username}`} width={size} height={size} />
    }

    const tabs = (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingBottom={1}>
        <Box flexDirection="row" columnGap={3}>
          {TABS.map(t => (
            <Box key={`tabbox-${t}`} flexDirection="column" alignItems="center" rowGap={0}>
              <Button key={`tab-${t}`} plain label={LABELS[t]} {...(t === showing ? {} : { dimColor: true as const })} onPress={() => show($, t)} />
              {t === showing && Svg && <Svg source={underlineSvg(LABELS[t].length * 8)} alt="Selected tab" width={LABELS[t].length * 8} height={3} />}
            </Box>
          ))}
        </Box>
        <Button key="refresh" plain dimColor label={f.isLoading ? 'Loading…' : '↻ Refresh'} onPress={() => refresh($)} />
      </Box>
    )

    if (who.status !== 'signed-in') {
      return (
        <Box flexDirection="column" paddingY={2} rowGap={1}>
          <Text size="title" weight="bold">
            /dev/null
          </Text>
          <Text color={MUTED}>a social network for devs</Text>
          {who.status === 'waiting' ? (
            <Text color={MUTED}>Approve this device in your browser, then come back here.</Text>
          ) : (
            <Box flexDirection="row">
              <Button key="sign-in" variant="primary" label="Sign in with GitHub" onPress={() => void startLogin($)} />
            </Box>
          )}
          {who.message && <Text color={DANGER}>{who.message}</Text>}
        </Box>
      )
    }

    const targetLabel = draft.mode === 'reply' ? `Replying to @${draft.targetHandle}` : draft.mode === 'quote' ? `Quoting @${draft.targetHandle}` : undefined
    const composer = (
      <Box flexDirection="column" borderStyle="round" borderColor={draft.mode === 'new' ? HAIRLINE : PRIMARY} paddingX={1} marginBottom={1}>
        {targetLabel && (
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={PRIMARY}>{targetLabel}</Text>
            <Button key="compose-cancel" plain dimColor label="Cancel" onPress={() => aim($, 'new')} />
          </Box>
        )}
        {Input && <Input
          key={`compose-${draft.round}`}
          placeholder={draft.mode === 'reply' ? 'Write your reply' : draft.mode === 'quote' ? 'Add your take' : "What's on your mind?"}
          submitLabel={draft.isSending ? 'Committing…' : draft.mode === 'reply' ? 'Reply' : draft.mode === 'quote' ? 'Quote' : 'Commit'}
          onSubmit={(value: string) => void send($, value)}
        />}
        {draft.error && <Text color={DANGER}>Not sent: {draft.error}</Text>}
      </Box>
    )

    const commit = (c: CommitRow, depth: number): ReturnType<typeof Box> => {
      const size = depth === 0 ? 36 : 28
      const isOpen = open.includes(c.id)
      const body = preview(c.body)
      return (
      <Box key={`c-${depth}-${c.id}`} flexDirection="row" alignItems="stretch" columnGap={1} paddingTop={1} paddingBottom={depth === 0 ? 1 : 0}>
        <Box flexDirection="column" alignItems="center">
          {ring(c.lane, c.username, size)}
          {Svg && <Svg source={tailSvg(c.lane, size)} alt="Lane" width={size} height={TAIL_HEIGHT} />}
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
            <Text wrap="truncate-end">
              <Text bold>{c.name ?? c.username}</Text> <Text mono color={MUTED}>@{c.username}</Text>
              <Text color={MUTED}> · {ago(c.createdAt, now)}</Text>
            </Text>
            {c.url ? <Link href={c.url} label={c.hash} /> : <Text mono color={MUTED}>{c.hash}</Text>}
          </Box>
          <Markdown key={`b-${depth}-${c.id}`} text={isOpen || !body.isCut ? c.body : body.text} />
          {body.isCut && (
            <Box flexDirection="row">
              <Button
                key={`more-${depth}-${c.id}`}
                plain
                label={isOpen ? 'Show less' : 'Show more'}
                onPress={() => update($, expanded, ids => (isOpen ? ids.filter(id => id !== c.id) : [...ids, c.id]))}
              />
            </Box>
          )}
          {c.quoted && (
            <Box flexDirection="column" borderStyle="round" borderColor={HAIRLINE} paddingX={1} marginTop={1}>
              <Text wrap="truncate-end">
                <Text color={c.quoted.lane}>● </Text>
                <Text bold>{c.quoted.name ?? c.quoted.username}</Text> <Text mono color={MUTED}>@{c.quoted.username}</Text>
              </Text>
              <Text color={MUTED} wrap="wrap">
                {c.quoted.body.length > 280 ? c.quoted.body.slice(0, 280) + '…' : c.quoted.body}
              </Text>
            </Box>
          )}
          {c.images > 0 && c.url && <Link href={c.url} label={c.images === 1 ? 'View image' : `View ${c.images} images`} />}
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box flexDirection="row" columnGap={3}>
              <Button
                key={`star-${depth}-${c.id}`}
                plain
                {...(c.isStarred ? {} : { dimColor: true as const })}
                label={`${c.isStarred ? '★' : '☆'}${c.stars > 0 ? ` ${c.stars}` : ''}`}
                onPress={() => react($, c, 'star')}
              />
              {depth === 0 && <Button key={`quote-${c.id}`} plain dimColor label="❝ Quote" onPress={() => aim($, 'quote', c)} />}
              <Button key={`reply-${depth}-${c.id}`} plain dimColor label={`↩ Reply${c.replies > 0 ? ` ${c.replies}` : ''}`} onPress={() => aim($, 'reply', c)} />
            </Box>
            <Button
              key={`save-${depth}-${c.id}`}
              plain
              {...(c.isSaved ? {} : { dimColor: true as const })}
              label={c.isSaved ? '■ Saved' : '□ Save'}
              onPress={() => react($, c, 'save')}
            />
          </Box>
          {c.replyPreview.map(r => commit(r, depth + 1))}
        </Box>
      </Box>
      )
    }

    const note = (n: (typeof f.notifications)[number]) => {
      const kind = NOTE_KINDS[n.type]
      return (
        <Box key={`n-${n.id}`} flexDirection="row" columnGap={1} paddingTop={1}>
          {ring(n.lane, n.actor, 28)}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text wrap="wrap">
              {n.isUnread && <Text color={PRIMARY}>● </Text>}
              <Text color={n.type === 'star' ? STAR : n.lane}>{kind?.glyph ?? '•'} </Text>
              <Text bold>@{n.actor}</Text>
              {n.others > 0 ? ` and ${n.others} ${n.others === 1 ? 'other' : 'others'}` : ''} {kind?.verb ?? n.type}
              <Text color={MUTED}> · {ago(n.createdAt, now)}</Text>
            </Text>
            {n.excerpt && (
              <Text color={MUTED} wrap="truncate-end">
                {n.excerpt}
              </Text>
            )}
          </Box>
        </Box>
      )
    }

    const isEmpty = showing === 'notifications' ? f.notifications.length === 0 : f.commits.length === 0
    return (
      <Box flexDirection="column">
        {tabs}
        {showing !== 'notifications' && composer}
        {f.error && <Text color={DANGER}>Couldn't load: {f.error}</Text>}
        {isEmpty && !f.isLoading && !f.error && (
          <Text color={MUTED}>
            {showing === 'notifications' ? 'No notifications yet.' : showing === 'following' ? 'Nobody you follow has committed yet. Try Latest.' : 'Nothing here yet.'}
          </Text>
        )}
        {showing === 'notifications' ? f.notifications.map(note) : f.commits.map(c => commit(c, 0))}
        {f.nextCursor && !isEmpty && (
          <Box flexDirection="row" justifyContent="center" paddingY={1}>
            <Button key="more" label={f.isLoading ? 'Loading…' : 'Load more'} onPress={() => refresh($, true)} />
          </Box>
        )}
      </Box>
    )
    } catch (error) {
      // Drawn as text so a failure shows its reason instead of an empty pane.
      const { Text } = $.ui.resolve(e)
      return <Text color={DANGER}>/dev/null couldn't draw this: {String((error as Error)?.message ?? error)}</Text>
    }
}

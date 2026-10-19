// /dev/null in the transcript: commit cards from /devnull show, link context, and @ completion.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { CommitRow } from '../types'
import { api, loadAvatars, nextCursorOf } from './core'
import { ago, avatarSvg, dataList, toCommitRow } from './devnull'
import { AVATAR_MAX_CHARS, HAIRLINE, INITIAL_AVATARS, INITIAL_FEED, INITIAL_PEOPLE, MUTED, STAR } from './state'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const avatars = atom({ plugin: 'devnull', key: 'avatars' } as const, INITIAL_AVATARS)
const feed = atom({ plugin: 'devnull', key: 'feed' } as const, INITIAL_FEED)
const people = atom({ plugin: 'devnull', key: 'people' } as const, INITIAL_PEOPLE)

type Thread = { commit: CommitRow; ancestors: CommitRow[]; replies: CommitRow[] }

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const LINK = /https?:\/\/(?:www\.)?dev-null\.sh\/[^\s)<>\]]*/gi
const MAX_LINKS = 3
const PEOPLE_CAP = 500
const FOLLOWING_PAGES = 5
const LINK_TIMEOUT_MS = 4000

// Filled by showCommit; the card re-fetches when a hot reload emptied it.
const cache = new Map<string, Thread>()

const allRows = (rows: CommitRow[]): CommitRow[] => rows.flatMap(r => [r, ...allRows(r.replyPreview), ...(r.quoted ? allRows([r.quoted]) : [])])

// A full link or id names the commit; a short hash is found only among the commits the pane already holds.
async function resolveId($: EngineInterface, arg: string): Promise<string | undefined> {
  const uuid = arg.match(UUID)?.[0]
  if (uuid) return uuid.toLowerCase()
  const hash = arg.trim().replace(/^#/, '').toLowerCase()
  if (!/^[0-9a-f]{4,}$/.test(hash)) return undefined
  const rows = allRows((await read($, feed)).commits)
  return rows.find(r => r.hash.toLowerCase().startsWith(hash) || r.id.toLowerCase().startsWith(hash))?.id
}

async function fetchThread($: EngineInterface, id: string): Promise<Thread> {
  const [one, replies] = await Promise.all([
    api($, 'GET', `commits/${encodeURIComponent(id)}`),
    api($, 'GET', `commits/${encodeURIComponent(id)}/replies`).catch(() => ({})),
  ])
  const body = one as { data?: Record<string, unknown>; ancestors?: unknown }
  if (!body.data) throw new Error('commit not found')
  const ancestors = Array.isArray(body.ancestors) ? body.ancestors.filter(a => a !== null && typeof a === 'object') : []
  const thread: Thread = {
    commit: toCommitRow(body.data),
    ancestors: ancestors.map(a => toCommitRow(a as Record<string, unknown>)),
    replies: dataList(replies).map(toCommitRow),
  }
  cache.set(id, thread)
  return thread
}

const oneLine = (c: CommitRow, now: number): string =>
  `**${c.name ?? c.username}** @${c.username}${c.createdAt ? ` · ${ago(c.createdAt, now)}` : ''} · \`${c.hash}\``

const counts = (c: CommitRow): string => `★ ${c.stars} · ↩ ${c.replies}`

function threadMarkdown(t: Thread, now: number): string {
  const c = t.commit
  const quote = (r: CommitRow) => `${oneLine(r, now)}\n${r.body.split('\n').map(l => `> ${l}`).join('\n')}`
  return [
    ...t.ancestors.map(a => `In reply to:\n${quote(a)}`),
    `${oneLine(c, now)}\n\n${c.body}\n\n${counts(c)}${c.url ? `\n${c.url}` : ''}`,
    ...(t.replies.length > 0 ? [`Replies:\n${t.replies.slice(0, 5).map(quote).join('\n\n')}`] : []),
  ].join('\n\n')
}

const NEED_LINK =
  'Give the full dev-null.sh link or the commit id (a short hash alone cannot be looked up). Open /devnull to find the commit and copy its link.'

export async function showCommit($: EngineInterface, arg: string): Promise<{ text: string; context?: string[] }> {
  if (arg.trim() === '') return { text: `Usage: /devnull show <link|id>. ${NEED_LINK}` }
  const id = await resolveId($, arg)
  if (!id) return { text: `Could not find a commit for "${arg.trim()}". ${NEED_LINK}` }
  try {
    const t = await fetchThread($, id)
    await loadAvatars($, [[t.commit.username, t.commit.avatarUrl]]).catch(() => {})
    return { text: threadMarkdown(t, await $.clock.now()) }
  } catch (err) {
    return { text: `Could not load that commit: ${err instanceof Error ? err.message : String(err)}` }
  }
}

// Compact plain text of a thread for the model.
function threadContext(t: Thread, now: number): string {
  const line = (r: CommitRow) => `@${r.username}${r.createdAt ? ` (${ago(r.createdAt, now)} ago)` : ''}: ${r.body}`
  return [
    `dev-null.sh commit${t.commit.url ? ` ${t.commit.url}` : ''}`,
    ...t.ancestors.map(a => `  parent ${line(a)}`),
    line(t.commit),
    `${t.commit.stars} stars, ${t.commit.replies} replies`,
    ...t.replies.slice(0, 5).map(r => `  reply ${line(r)}`),
  ].join('\n')
}

const timeout = <T,>($: EngineInterface, p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([p, $.clock.sleep(ms).then(() => undefined)])

export async function rememberPeople($: EngineInterface, usernames: string[]): Promise<void> {
  const fresh = usernames.filter(u => u !== '' && u !== '?')
  if (fresh.length === 0) return
  await update($, people, (cur): string[] => [...new Set([...fresh, ...cur])].slice(0, PEOPLE_CAP))
}

export async function loadFollowing($: EngineInterface): Promise<void> {
  const me = await $.store.get('username')
  if (!me || typeof me !== 'string') return
  const found: string[] = []
  let cursor: string | undefined
  for (let page = 0; page < FOLLOWING_PAGES; page++) {
    const json = await api($, 'GET', `users/${encodeURIComponent(me)}/following`, { cursor })
    for (const u of dataList(json)) if (typeof u.username === 'string') found.push(u.username)
    cursor = nextCursorOf(json)
    if (!cursor) break
  }
  await rememberPeople($, found)
}

export function registerTranscript(on: On): void {
  on('ui.render', { component: 'CommandOutput', props: { command: 'devnull' } }, async ($, e, next) => {
    try {
      if (!/^show\b/.test(e.props.args.trim()) || e.props.isErrored) return next(e)
      const els = $.ui.resolve(e)
      const { Box, Text, Link, Markdown } = els
      const Svg = 'Svg' in els ? els.Svg : undefined
      const id = await resolveId($, e.props.args.trim().replace(/^show\s*/, ''))
      if (!id) return next(e)
      const t = cache.get(id) ?? (await fetchThread($, id))
      const c = t.commit
      const face = (await read($, avatars))[c.username]
      const photo = face && face.length <= AVATAR_MAX_CHARS ? face : undefined
      const now = await $.clock.now()
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={HAIRLINE} paddingX={1} rowGap={1}>
          <Box flexDirection="row" alignItems="center" columnGap={1}>
            {Svg && <Svg source={avatarSvg(c.lane, 32, photo, c.username)} alt={`@${c.username}`} width={32} height={32} />}
            <Text wrap="truncate-end">
              <Text bold>{c.name ?? c.username}</Text> <Text mono color={MUTED}>@{c.username}</Text>
              {c.createdAt && <Text color={MUTED}> · {ago(c.createdAt, now)}</Text>}
              <Text mono color={MUTED}> · {c.hash}</Text>
            </Text>
          </Box>
          <Markdown key={`b-${c.id}`} text={c.body} />
          <Text color={MUTED}>
            <Text color={STAR}>★</Text> {c.stars} · ↩ {c.replies}
          </Text>
          {c.url && <Link href={c.url} label="Open on dev-null.sh" />}
        </Box>
      )
    } catch {
      return next(e)
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || !(await $.store.get('username'))) return next(e)
    const ids = [...new Set((e.text.match(LINK) ?? []).map(l => l.match(UUID)?.[0]?.toLowerCase()).filter((i): i is string => !!i))].slice(0, MAX_LINKS)
    if (ids.length === 0) return next(e)
    const now = await $.clock.now()
    const found = await Promise.all(ids.map(id => timeout($, fetchThread($, id), LINK_TIMEOUT_MS).catch(() => undefined)))
    const blocks = found.flatMap(t => (t ? [threadContext(t, now)] : []))
    return next(blocks.length > 0 ? { ...e, context: [...(e.context ?? []), ...blocks] } : e)
  }).catch(($, e, next) => next(e))

  on('prompt.autocomplete', { token: /^@/ }, async ($, e, next) => {
    const prev = await next(e)
    const prefix = e.token.slice(1).toLowerCase()
    const ours = (await read($, people))
      .filter(u => u.toLowerCase().startsWith(prefix))
      .slice(0, 8)
      .map(u => ({ text: '@' + u, label: '@' + u, description: 'on /dev/null' }))
    return { suggestions: [...prev.suggestions, ...ours] }
  })
}

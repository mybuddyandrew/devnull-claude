// Tools the model can call to read /dev/null and draft (never post) commits.
import type { EngineInterface, On } from 'claude-code'

import { api, commitPath, nextCursorOf } from './core'
import { NOTE_KINDS, ago, dataList, toCommitRow, toNoteRow } from './devnull'
import type { CommitRow } from '../types'
import { draftInComposer } from './feed'
import { openPane } from './pane'

const MAX_CHARS = 8000
const LINE_BODY = 280
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const NOT_SIGNED_IN = 'Not signed in to /dev/null. The user can run /devnull login.'
const LOGS = ['following', 'latest', 'trending']
const NOTE_TYPES = ['all', 'replies', 'quotes', 'stars', 'mentions', 'follows']

const TOOLS = [
  {
    name: 'devnull_feed',
    description:
      'Read a page of the /dev/null (dev-null.sh, a social network for developers) log. Returns up to 20 commits, one per line: [short_hash id=<uuid>] @user (name) · age · stars · replies: body. Use `log` following (people the user follows), latest, or trending; pass the returned next cursor to page on. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        log: { type: 'string', enum: LOGS, description: 'Which log to read' },
        cursor: { type: 'string', description: 'Cursor from a previous result to get the next page' },
      },
      required: ['log'],
    },
  },
  {
    name: 'devnull_thread',
    description:
      'Read one /dev/null commit with its ancestors (what it replies to) and its replies, oldest first. `commit` is the full commit id (uuid) or a dev-null.sh commit link; a short hash alone cannot be looked up. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { commit: { type: 'string', description: 'Commit id (uuid) or dev-null.sh commit URL' } },
      required: ['commit'],
    },
  },
  {
    name: 'devnull_profile',
    description:
      "Read a /dev/null user's profile: name, bio, follow state, current and longest streak, rank, level and XP, counts, and their recent commits. Defaults to the signed-in user. There is no search; the username must be known. Read-only.",
    inputSchema: {
      type: 'object',
      properties: { username: { type: 'string', description: 'Username without the @; omit for the signed-in user' } },
    },
  },
  {
    name: 'devnull_notifications',
    description:
      "List the signed-in user's /dev/null notifications (replies, quotes, stars, mentions, follows). WARNING: dev-null.sh marks ALL notifications read as soon as they are listed, so only call this when the user wants their notifications.",
    inputSchema: {
      type: 'object',
      properties: { type: { type: 'string', enum: NOTE_TYPES, description: 'Filter; default all' } },
    },
  },
  {
    name: 'devnull_draft',
    description:
      'Draft a /dev/null commit for the user. This NEVER posts: it only puts the text in the prompt box as `/devnull post <text>` (and opens the pane) for the user to edit and send themselves. Optionally make it a reply (reply_to) or a quote (quote) by commit id. 3 to 4000 characters.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The draft text, 3 to 4000 characters' },
        reply_to: { type: 'string', description: 'Commit id (uuid) to reply to' },
        quote: { type: 'string', description: 'Commit id (uuid) to quote' },
      },
      required: ['text'],
    },
  },
]

// Registration rejects until the session binds; session.start is the right moment, and a failure only costs the tools.
export async function startTools($: EngineInterface): Promise<void> {
  for (const tool of TOOLS) {
    try {
      await $.tool.register({ ...tool, isDeferred: false })
    } catch {}
  }
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

const cap = (s: string): string => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS - 40)}\n… (cut at ${MAX_CHARS} characters)` : s)

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s)

const commitLine = (r: CommitRow, nowMs: number): string => {
  const who = `@${r.username}${r.name ? ` (${r.name})` : ''}`
  const stats = [ago(r.createdAt, nowMs), `★${r.stars} ↩${r.replies}`].filter(Boolean).join(' · ')
  const quote = r.quoted ? ` [quotes @${r.quoted.username}: ${cut(oneLine(r.quoted.body), 120)}]` : ''
  return `[${r.hash} id=${r.id}] ${who} · ${stats}: ${cut(oneLine(r.body), LINE_BODY)}${quote}`
}

// A full id, or a dev-null.sh link carrying one (its last path segment is the id when it is not a uuid).
const commitIdOf = (input: unknown): string => {
  const s = text(input)
  const uuid = s.match(UUID)?.[0]
  if (uuid) return uuid
  const last = s.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? ''
  return /^[A-Za-z0-9_-]+$/.test(last) ? last : ''
}

async function feed($: EngineInterface, e: Record<string, unknown>): Promise<string> {
  const log = LOGS.includes(e.log as string) ? (e.log as string) : 'following'
  const json = await api($, 'GET', `log/${log}`, { cursor: text(e.cursor) || undefined })
  const now = await $.clock.now()
  const rows = dataList(json).map(toCommitRow)
  const next = nextCursorOf(json)
  const lines = rows.map(r => commitLine(r, now))
  return cap([`/dev/null ${log} log, ${rows.length} commits:`, ...lines, next ? `next cursor: ${next}` : 'end of log'].join('\n'))
}

async function thread($: EngineInterface, e: Record<string, unknown>): Promise<string> {
  const id = commitIdOf(e.commit)
  if (!id) return 'dev-null.sh error: give a full commit id (uuid) or a dev-null.sh commit link.'
  const json = (await api($, 'GET', `commits/${encodeURIComponent(id)}`)) as { data?: Record<string, unknown>; ancestors?: unknown }
  const replies = await api($, 'GET', commitPath(id, 'replies'))
  const now = await $.clock.now()
  const ancestors = dataList({ data: json.ancestors }).map(toCommitRow)
  const row = toCommitRow(json.data ?? {})
  const answers = dataList(replies).map(toCommitRow)
  const more = nextCursorOf(replies)
  const lines: string[] = []
  if (ancestors.length) lines.push('Ancestors (oldest first):', ...ancestors.map(r => commitLine(r, now)), '')
  lines.push('Commit:', `[${row.hash} id=${row.id}] @${row.username}${row.name ? ` (${row.name})` : ''} · ${ago(row.createdAt, now)} · ★${row.stars} ↩${row.replies}`, row.body)
  if (row.quoted) lines.push(`Quotes @${row.quoted.username}: ${cut(oneLine(row.quoted.body), 400)}`)
  lines.push('', answers.length ? `Replies (oldest first, ${answers.length}${more ? '+' : ''}):` : 'No replies.', ...answers.map(r => commitLine(r, now)))
  return cap(lines.join('\n'))
}

async function profile($: EngineInterface, e: Record<string, unknown>): Promise<string> {
  const name = text(e.username).replace(/^@/, '') || ((await $.store.get('username')) as string)
  const json = (await api($, 'GET', `users/${encodeURIComponent(name)}`)) as Record<string, any>
  const u = (json.data ?? {}) as Record<string, any>
  const a = (json.achievements ?? {}) as Record<string, any>
  const s = (json.streaks ?? {}) as Record<string, any>
  const now = await $.clock.now()
  const lines = [`@${u.username ?? name}${u.name ? ` (${u.name})` : ''}`]
  if (u.bio) lines.push(`Bio: ${cut(oneLine(String(u.bio)), 500)}`)
  const follow = [json.is_following ? 'you follow them' : '', json.follows_you ? 'they follow you' : ''].filter(Boolean)
  if (follow.length) lines.push(follow.join(', '))
  lines.push(`Streak: current ${s.current ?? 0}, longest ${s.longest ?? 0}`)
  lines.push(`Rank ${a.rank ?? '?'}, level ${a.level ?? '?'}, ${a.xp ?? 0} XP${a.next_level_xp ? ` (next level at ${a.next_level_xp})` : ''}`)
  const counts = ['commits_count', 'followers_count', 'following_count', 'stars_count']
    .filter(k => typeof u[k] === 'number')
    .map(k => `${u[k]} ${k.replace('_count', '')}`)
  if (counts.length) lines.push(`Counts: ${counts.join(', ')}`)
  // dev-null.sh lists every badge with `unlocked`; only the earned ones belong on the profile.
  if (Array.isArray(a.badges)) {
    const earned = a.badges.filter((b: any) => typeof b === 'string' || b?.unlocked === true)
    const names = earned.map((b: any) => (typeof b === 'string' ? b : (b?.name ?? b?.id ?? ''))).filter(Boolean)
    lines.push(`Badges: ${names.length ? names.join(', ') : 'none yet'} (${names.length} of ${a.badges.length})`)
  }
  const posts = dataList(await api($, 'GET', `users/${encodeURIComponent(name)}/commits`, { replies: '1' })).map(toCommitRow)
  if (posts.length) lines.push('', 'Recent commits:', ...posts.slice(0, 10).map(r => commitLine(r, now)))
  return cap(lines.join('\n'))
}

async function notifications($: EngineInterface, e: Record<string, unknown>): Promise<string> {
  const type = NOTE_TYPES.includes(e.type as string) ? (e.type as string) : 'all'
  const json = await api($, 'GET', 'notifications', { type })
  const now = await $.clock.now()
  const items = dataList(json)
  const lines = items.map(n => {
    const row = toNoteRow(n)
    const kind = NOTE_KINDS[row.type] ?? { verb: row.type, glyph: '·' }
    const who = `@${row.actor}${row.others > 0 ? ` and ${row.others} other${row.others > 1 ? 's' : ''}` : ''}`
    const commit = (n.commit ?? {}) as Record<string, unknown>
    const ref = commit.id ? ` [${String(commit.short_hash ?? String(commit.id).slice(0, 7))} id=${String(commit.id)}]` : ''
    return `${kind.glyph} ${who} ${kind.verb} · ${ago(row.createdAt, now)}${row.isUnread ? ' · unread' : ''}${ref}${row.excerpt ? `: ${cut(oneLine(row.excerpt), 200)}` : ''}`
  })
  return cap([`${items.length} notifications (${type}); they are now all marked read on dev-null.sh:`, ...lines].join('\n'))
}

async function draft($: EngineInterface, e: Record<string, unknown>): Promise<string> {
  const body = typeof e.text === 'string' ? e.text.trim() : ''
  if (body.length < 3 || body.length > 4000) return 'dev-null.sh error: draft text must be 3 to 4000 characters.'
  const reply = commitIdOf(e.reply_to)
  const quote = commitIdOf(e.quote)
  const to = reply ? { mode: 'reply' as const, targetId: reply } : quote ? { mode: 'quote' as const, targetId: quote } : { mode: 'new' as const }
  await draftInComposer($, body, to)
  await openPane($)
  return "Draft placed in the user's prompt box as /devnull post. The user must press Enter to post it."
}

// Every handler answers with text and never throws: the model reads the failure.
async function answer($: EngineInterface, e: unknown, run: (a: Record<string, unknown>) => Promise<string>): Promise<{ result: string }> {
  try {
    if (!(await $.store.get('username'))) return { result: NOT_SIGNED_IN }
    return { result: await run(e as Record<string, unknown>) }
  } catch (err) {
    return { result: `dev-null.sh error: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export function registerTools(on: On): void {
  on('tool.call', { tool: 'mcp__devnull__devnull_feed' }, async ($, e) => answer($, e, a => feed($, a)))
  on('tool.call', { tool: 'mcp__devnull__devnull_thread' }, async ($, e) => answer($, e, a => thread($, a)))
  on('tool.call', { tool: 'mcp__devnull__devnull_profile' }, async ($, e) => answer($, e, a => profile($, a)))
  on('tool.call', { tool: 'mcp__devnull__devnull_notifications' }, async ($, e) => answer($, e, a => notifications($, a)))
  on('tool.call', { tool: 'mcp__devnull__devnull_draft' }, async ($, e) => answer($, e, a => draft($, a)))
}

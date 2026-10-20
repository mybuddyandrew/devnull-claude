// Streaks and stats: the profile header, the status line, live counts and the end-of-day nudge.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Live, Stats } from '../types'
import { num, obj } from './json'
import { api } from './api'
import { loadInbox, remotesOf } from './remotes'
import { INITIAL_FEED, INITIAL_LIVE, INITIAL_STATS, INITIAL_TAB } from './state'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const feed = atom({ plugin: 'devnull', key: 'feed' } as const, INITIAL_FEED)
const live = atom({ plugin: 'devnull', key: 'live' } as const, INITIAL_LIVE)
const stats = atom({ plugin: 'devnull', key: 'stats' } as const, INITIAL_STATS)
const tab = atom({ plugin: 'devnull', key: 'tab' } as const, INITIAL_TAB)

// How often the background poll runs, and how stale the profile may get before it is fetched again.
const TICK_MS = 60_000
const STATS_MAX_AGE_MS = 10 * 60_000


// GET users/{me} signed: the profile with its streaks, achievements and activity buckets.
export const toStats = (username: string, json: unknown, nowMs: number): Stats => {
  const root = obj(json)
  const streaks = obj(root.streaks)
  const achievements = obj(root.achievements)
  const activity = obj(root.activity)
  const scale = activity.scale
  const level = num(achievements.level)
  const xp = num(achievements.xp)
  const nextLevelXp = num(achievements.next_level_xp)
  return {
    username,
    streak: num(streaks.current) ?? 0,
    longest: num(streaks.longest) ?? 0,
    ...(typeof achievements.rank === 'string' ? { rank: achievements.rank } : {}),
    ...(level !== undefined ? { level } : {}),
    ...(xp !== undefined ? { xp } : {}),
    ...(nextLevelXp !== undefined ? { nextLevelXp } : {}),
    scale: scale === 'day' || scale === 'week' || scale === 'month' || scale === 'year' ? scale : 'year',
    buckets: (Array.isArray(activity.buckets) ? activity.buckets : [])
      .map(obj)
      .map(b => ({ date: String(b.date ?? ''), count: num(b.count) ?? 0 })),
    fetchedAt: nowMs,
  }
}

// Whether the person has committed today (UTC, as dev-null.sh counts days).
export const hasCommittedToday = (s: Stats, nowMs: number): boolean => {
  const today = new Date(nowMs).toISOString().slice(0, 10)
  return s.buckets.some(b => b.date.slice(0, 10) === today && b.count > 0)
}

// The heatmap as one compact SVG: one path per intensity level, so hundreds of days stay a few KB.
// Year scale lays out Sunday-first week columns like GitHub's; shorter scales are one row.
export const heatmapSvg = (s: Stats, lane: string, cell = 7, gap = 2): { source: string; width: number; height: number } => {
  const max = Math.max(1, ...s.buckets.map(b => b.count))
  const level = (count: number) => (count === 0 ? 0 : Math.max(1, Math.ceil((count / max) * 4)))
  const opacity = [0.12, 0.32, 0.56, 0.8, 1]
  const step = cell + gap
  const paths: string[][] = [[], [], [], [], []]
  let cols = 0
  let rows = 1
  if (s.scale === 'year') {
    rows = 7
    const first = new Date(`${s.buckets[0]?.date.slice(0, 10) ?? '1970-01-01'}T00:00:00Z`).getUTCDay()
    s.buckets.forEach((b, i) => {
      const slot = i + first
      const x = Math.floor(slot / 7) * step
      const y = (slot % 7) * step
      cols = Math.max(cols, Math.floor(slot / 7) + 1)
      paths[level(b.count)]!.push(`M${x} ${y}h${cell}v${cell}h-${cell}z`)
    })
  } else {
    s.buckets.forEach((b, i) => {
      paths[level(b.count)]!.push(`M${i * step} 0h${cell}v${cell}h-${cell}z`)
      cols = i + 1
    })
  }
  const width = Math.max(step, cols * step - gap)
  const height = rows * step - gap
  const body = paths
    .map((d, i) => (d.length === 0 ? '' : `<path d="${d.join('')}" fill="${i === 0 ? '#8a8a8e' : lane}" fill-opacity="${opacity[i]}"/>`))
    .join('')
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`, width, height }
}

export const statusLine = (s: Stats, l: Live): string => {
  const parts = [s.streak > 0 ? `🔥 ${s.streak}-day streak` : 'No streak yet']
  if (s.rank) parts.push(s.rank)
  if (l.unread > 0) parts.push(`${l.unread} unread`)
  if (l.newCount > 0) parts.push(`${l.newCount} new`)
  if (l.remotesOn && (l.remotesUnread ?? 0) > 0) parts.push(`${l.remotesUnread} in Remotes`)
  return `/dev/null: ${parts.join(' · ')}`
}

export async function loadStats($: EngineInterface): Promise<void> {
  const username = (await $.store.get('username')) as string | undefined
  if (!username) return
  try {
    const json = await api($, 'GET', `users/${encodeURIComponent(username)}`)
    const next = toStats(username, json, await $.clock.now())
    await update($, stats, (): Stats | null => next)
  } catch {}
}

// One poll: unread notifications from GET me, new commits on the shown log since its newest commit.
async function tick($: EngineInterface): Promise<void> {
  if (!(await $.store.get('username'))) return
  try {
    const me = (await api($, 'GET', 'me')) as { unread_notifications_count?: unknown; data?: { id?: unknown } }
    const unread = num(me.unread_notifications_count) ?? 0
    if (me.data?.id !== undefined && me.data.id !== null) await $.store.set('userId', String(me.data.id))
    // Remotes appear once dev-null.sh's API has them and you have them switched on.
    const remotes = remotesOf(me)
    const showing = await read($, tab)
    const newest = (await read($, feed)).commits[0]?.id
    let newCount = 0
    if (showing !== 'notifications' && showing !== 'trending' && showing !== 'remotes' && newest) {
      const json = (await api($, 'GET', `log/${showing}`, { since: newest })) as { new_commits_count?: unknown }
      newCount = num(json.new_commits_count) ?? 0
    }
    // Written only when a count changed: every write redraws the pane, and a redraw under a click drops it.
    const next: Live = { newCount, unread, remotesOn: remotes.on, remotesUnread: remotes.unread }
    const before = await read($, live)
    if (JSON.stringify({ ...before, ...next }) !== JSON.stringify(before)) await update($, live, (l): Live => ({ ...l, ...next }))
    // The open inbox keeps itself current, as the phone app's does, quietly.
    if (remotes.on && showing === 'remotes') await loadInbox($, undefined, false, true)
  } catch {}
  const s = await read($, stats)
  const now = await $.clock.now()
  if (!s || now - s.fetchedAt > STATS_MAX_AGE_MS) await loadStats($)
  const fresh = await read($, stats)
  if (fresh) $.ui.status(statusLine(fresh, await read($, live)))
}

// Runs in session.start: fetch once now, then poll in the background for the life of the module.
export async function startStreaks($: EngineInterface): Promise<void> {
  void tick($)
  $.clock.every(TICK_MS, () => void tick($))
}

export function registerStreaks(on: On): void {
  // One nudge a day, after a main-loop answer, while a streak is alive and nothing is posted yet today.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return done
    const s = await read($, stats)
    const now = await $.clock.now()
    if (!s || s.streak === 0 || hasCommittedToday(s, now)) return done
    const today = new Date(now).toISOString().slice(0, 10)
    if ((await $.store.get('nudgedOn')) === today) return done
    await $.store.set('nudgedOn', today)
    $.ui.toast(`/dev/null: nothing committed today. Your ${s.streak}-day streak ends at midnight UTC. Run /devnull to post.`, { timeoutMs: 10_000 })
    return done
  })
}

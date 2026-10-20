// GET me: who you are, your unread count and whether Remotes is on. The one reader of it, and the one writer of
// `live`, the counts the pane and status line show.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Live } from '../types'
import { api } from './api'
import { count, num, obj } from './json'
import { INITIAL_LIVE } from './state'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const live = atom({ plugin: 'devnull', key: 'live' } as const, INITIAL_LIVE)

export type Me = { id?: string; unread: number; remotes: { on: boolean; unread: number } }

// What GET me says about Remotes: absent on a server without the API, null while you have them off.
export const remotesOf = (me: unknown): { on: boolean; unread: number } => {
  const root = obj(me)
  const r = 'remotes' in root ? root.remotes : obj(root.data).remotes
  if (r === undefined || r === null) return { on: false, unread: 0 }
  return { on: true, unread: count(obj(r).unread_count) }
}

// Reads GET me and keeps your account id, which says which Remotes messages are yours.
export async function readMe($: EngineInterface): Promise<Me> {
  const me = await api($, 'GET', 'me')
  const id = obj(obj(me).data).id
  const hasId = id !== undefined && id !== null
  if (hasId) await $.store.set('userId', String(id))
  return { ...(hasId ? { id: String(id) } : {}), unread: num(obj(me).unread_notifications_count) ?? 0, remotes: remotesOf(me) }
}

// Your account's id, kept once read.
export async function myUserId($: EngineInterface): Promise<string | undefined> {
  const kept = (await $.store.get('userId')) as string | undefined
  if (kept) return kept
  try {
    return (await readMe($)).id
  } catch {
    return undefined
  }
}

// Written only when a count changed: every write redraws the pane, and a redraw under a click drops it.
export async function setLive($: EngineInterface, patch: Partial<Live>): Promise<void> {
  const before = await read($, live)
  if (JSON.stringify({ ...before, ...patch }) !== JSON.stringify(before)) await update($, live, (l): Live => ({ ...l, ...patch }))
}

// Signed out: the account's id and counts go with it, so the next account reads its own.
export async function forgetMe($: EngineInterface): Promise<void> {
  await $.store.delete('userId')
  await update($, live, (): Live => INITIAL_LIVE)
}

// Checks GET me for Remotes now, so the tab is there as soon as the pane opens (the background tick
// rechecks every minute).
export async function checkRemotes($: EngineInterface): Promise<void> {
  if (!(await $.store.get('username'))) return
  try {
    const me = await readMe($)
    await setLive($, { remotesOn: me.remotes.on, remotesUnread: me.remotes.unread })
  } catch {}
}

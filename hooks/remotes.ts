// Remotes, dev-null.sh's direct messages: the inbox, a thread, sending, reactions and requests.
// The signed API for it is in open pull requests on dev-null.sh, so everything here stays hidden
// (live.remotesOn) until the server answers for it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import type { ConversationRow, Inbox, InboxSection, MessageRow, Thread } from '../types'
import { count, list, obj } from './json'
import { api, threadPath } from './api'
import { loadAvatars } from './images'
import { toConversationRow, toMessageRow } from './rows'
import { emojify } from './emoji'
import { myUserId, setLive } from './me'
import { hex, randomBytes } from './sign'
import { INITIAL_INBOX, INITIAL_THREAD, MESSAGE_MAX, THREAD_POLL_MS } from './state'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const inbox = atom({ plugin: 'devnull', key: 'inbox' } as const, INITIAL_INBOX)
const thread = atom({ plugin: 'devnull', key: 'thread' } as const, INITIAL_THREAD)


// The open thread's poll; a hot reload drops it, and resumeThread (session start, the pane opening) starts it again.
let poller: Timer | undefined
// Bumped by each load of a section: a section answered after you moved to another is dropped.
let inboxSeq = 0

const isNotFound = (error: unknown) => /^404\b/.test(String((error as Error)?.message ?? ''))
const reason = (error: unknown) => String((error as Error)?.message ?? error).replace(/^\d{3}\s*/, '')

// quiet: a background recheck (the minute tick), which shows no loader and writes only when something changed,
// since every write redraws the pane and a redraw under a click drops the click.
export async function loadInbox($: EngineInterface, section?: InboxSection, more = false, quiet = false): Promise<void> {
  const now = await read($, inbox)
  const tab = section ?? now.section
  const before = more ? now.rows[now.rows.length - 1]?.id : undefined
  const seq = more || quiet ? inboxSeq : ++inboxSeq
  if (!quiet) await update($, inbox, (i): Inbox => ({ ...i, section: tab, isLoading: true, error: undefined, ...(more ? {} : tab !== i.section ? { rows: [] } : {}) }))
  try {
    const me = await myUserId($)
    const json = obj(await api($, 'GET', 'remotes', { tab, before }))
    const found = list(json.data).map(c => toConversationRow(c, me))
    const current = await read($, inbox)
    if (seq !== inboxSeq || current.section !== tab) return
    const ids = new Set(found.map(r => r.id))
    // A quiet recheck refreshes the first page and keeps the pages you loaded under it.
    const isDeeper = quiet && current.rows.length > found.length
    const kept = isDeeper ? current.rows.filter(r => !ids.has(r.id)) : []
    const next: Inbox = {
      ...current,
      section: tab,
      isLoading: false,
      rows: more ? [...current.rows, ...found.filter(r => !current.rows.some(c => c.id === r.id))] : [...found, ...kept],
      hasMore: isDeeper ? current.hasMore : json.has_more === true,
      unread: count(json.unread_count),
      requests: count(json.requests_count),
    }
    if (JSON.stringify(next) !== JSON.stringify(current)) await update($, inbox, (): Inbox => next)
    await setLive($, { remotesOn: true, remotesUnread: count(json.unread_count) })
    void loadAvatars($, found.map((r): [string, string | undefined] => [r.avatarUser ?? r.title, r.avatarUrl]))
  } catch (error) {
    if (isNotFound(error)) await setLive($, { remotesOn: false })
    if (seq !== inboxSeq) return
    await update($, inbox, (i): Inbox => ({ ...i, isLoading: false, error: isNotFound(error) ? "Remotes isn't available on dev-null.sh for you yet." : reason(error) }))
  }
}

// Reads a thread's GET .../messages answer into the thread's fields.
async function threadFields($: EngineInterface, json: unknown): Promise<Partial<Thread> & { messages: MessageRow[] }> {
  const me = await myUserId($)
  const t = obj(obj(json).data)
  const partner = obj(t.partner)
  const typing = Array.isArray(t.typing) ? (t.typing as unknown[]).map(String) : t.partner_typing === true && typeof partner.username === 'string' ? [partner.username] : []
  const access = t.access
  return {
    messages: list(t.messages).map(m => toMessageRow(m, me)),
    hasOlder: t.has_older === true,
    // Left out when the answer doesn't say (a poll's delta), so the thread keeps what it had.
    ...(access === 'open' || access === 'request' || access === 'waiting' || access === 'restricted' || access === 'closed' ? { access } : {}),
    typing,
    readThrough: count(t.read_through_id),
    partnerReadThrough: count(t.partner_read_through_id),
    reactionsVersion: count(t.reactions_version),
    isArchived: t.is_archived === true,
  }
}

export async function openThread($: EngineInterface, row: Pick<ConversationRow, 'isOrg' | 'target' | 'title' | 'lane' | 'avatarUrl' | 'avatarUser'>): Promise<void> {
  await update($, thread, (): Thread | null => ({
    isOrg: row.isOrg,
    target: row.target,
    title: row.title,
    lane: row.lane,
    ...(row.avatarUrl ? { avatarUrl: row.avatarUrl, avatarUser: row.avatarUser } : {}),
    status: 'loading',
    messages: [],
    hasOlder: false,
    access: 'open',
    typing: [],
    readThrough: 0,
    partnerReadThrough: 0,
    reactionsVersion: 0,
    isArchived: false,
  }))
  try {
    const fields = await threadFields($, await api($, 'GET', `${threadPath(row.isOrg, row.target)}/messages`))
    if (!(await isStillOpen())) return
    await update($, thread, (t): Thread | null => (t ? { ...t, ...fields, access: fields.access ?? 'open', status: 'ready' } : t))
    await markRead($)
    startPolling($)
  } catch (error) {
    // Only this thread's failure, if it is still the one open.
    if (await isStillOpen()) await update($, thread, (t): Thread | null => (t ? { ...t, status: 'failed', error: reason(error) } : t))
  }

  async function isStillOpen(): Promise<boolean> {
    const t = await read($, thread)
    return t?.target === row.target && t.isOrg === row.isOrg
  }
}

export async function closeThread($: EngineInterface): Promise<void> {
  stopPolling()
  await update($, thread, (): Thread | null => null)
  await loadInbox($)
}

export function stopPolling(): void {
  poller?.cancel()
  poller = undefined
}

// Signed out: the poll stops and the inbox and thread are emptied.
export async function forgetRemotes($: EngineInterface): Promise<void> {
  stopPolling()
  await update($, thread, (): Thread | null => null)
  await update($, inbox, (): Inbox => INITIAL_INBOX)
}

// Polls the open thread for new messages, reaction changes, typing and read receipts, as the phone app does.
export function startPolling($: EngineInterface): void {
  stopPolling()
  poller = $.clock.every(THREAD_POLL_MS, () => void pollThread($))
}

export async function pollThread($: EngineInterface): Promise<void> {
  const t = await read($, thread)
  if (!t || t.status !== 'ready') return stopPolling()
  const last = [...t.messages].reverse().find(m => m.id > 0)?.id ?? 0
  try {
    const json = await api($, 'GET', `${threadPath(t.isOrg, t.target)}/messages`, { after: String(last), reactions_after: String(t.reactionsVersion) })
    const fields = await threadFields($, json)
    const changes = list(obj(obj(json).data).reaction_changes)
    // Worked out first and written only when something changed: this runs every few seconds.
    const merge = (now: Thread | null): Thread | null => {
      if (!now || now.target !== t.target) return now
      const known = new Set(now.messages.map(m => m.id))
      const fresh = fields.messages.filter(m => !known.has(m.id))
      // A message this poll fetched before its own send returned takes its staged copy's place.
      const sentIds = new Set(fresh.map(m => m.clientId).filter(Boolean))
      let messages = [...now.messages.filter(m => !(m.id === 0 && m.clientId && sentIds.has(m.clientId))), ...fresh]
      for (const change of changes) {
        const id = count(change.id)
        const reactions = list(change.reactions).map(r => ({ userId: String(r.user_id ?? ''), emoji: String(r.emoji ?? '') }))
        messages = messages.map(m => (m.id === id ? { ...m, reactions } : m))
      }
      return {
        ...now,
        messages,
        typing: fields.typing ?? now.typing,
        access: fields.access ?? now.access,
        partnerReadThrough: Math.max(now.partnerReadThrough, fields.partnerReadThrough ?? 0),
        reactionsVersion: Math.max(now.reactionsVersion, fields.reactionsVersion ?? 0),
      }
    }
    const current = await read($, thread)
    const next = merge(current)
    if (JSON.stringify(next) !== JSON.stringify(current)) await update($, thread, (now): Thread | null => merge(now))
    await markRead($)
  } catch {}
}

// Moves your read marker to the latest message; dev-null.sh only ever moves it forward.
async function markRead($: EngineInterface): Promise<void> {
  const t = await read($, thread)
  if (!t) return
  const latest = [...t.messages].reverse().find(m => m.id > 0 && !m.isMine)?.id ?? 0
  if (latest <= t.readThrough) return
  try {
    await api($, 'PUT', `${threadPath(t.isOrg, t.target)}/read`, {}, { through: latest })
    await update($, thread, (now): Thread | null => (now && now.target === t.target ? { ...now, readThrough: latest } : now))
  } catch {}
}

// Sends a message to a person (or org); while their thread is open it shows at once and turns pushed or rejected.
export async function sendMessage($: EngineInterface, isOrg: boolean, target: string, text: string): Promise<string> {
  // :rocket: → 🚀, as GitHub writes shortcodes.
  const body = emojify(text.trim())
  if (!body) return 'Nothing to send.'
  if (body.length > MESSAGE_MAX) return `Not sent: Remotes take up to ${MESSAGE_MAX} characters and this is ${body.length}.`
  const cid = clientId()
  const open = await read($, thread)
  const isShown = open?.target === target && open.isOrg === isOrg
  const me = await myUserId($)
  if (isShown) {
    const staged: MessageRow = { id: 0, userId: me ?? '', isMine: true, body, reactions: [], images: 0, status: 'staged', clientId: cid }
    await update($, thread, (t): Thread | null => (t ? { ...t, messages: [...t.messages, staged] } : t))
  }
  try {
    const json = await api($, 'POST', `${threadPath(isOrg, target)}/messages`, {}, { body, client_id: cid })
    const sent = toMessageRow(obj(obj(json).data), me)
    if (isShown) await update($, thread, (t): Thread | null => (t ? { ...t, messages: t.messages.map(m => (m.clientId === cid ? sent : m)) } : t))
    return isOrg ? 'Pushed to the org.' : `Pushed to @${target}.`
  } catch (error) {
    if (isShown) await update($, thread, (t): Thread | null => (t ? { ...t, messages: t.messages.map(m => (m.clientId === cid ? { ...m, status: 'rejected' } : m)) } : t))
    return `Not sent: ${isNotFound(error) ? `you can't push to ${isOrg ? 'that org' : `@${target}`}.` : reason(error)}`
  }
}

// Sends a rejected message again, under its same client id so dev-null.sh never takes it twice.
export async function retryMessage($: EngineInterface, cid: string): Promise<void> {
  const t = await read($, thread)
  const m = t?.messages.find(x => x.clientId === cid)
  if (!t || !m) return
  await update($, thread, (now): Thread | null => (now ? { ...now, messages: now.messages.map(x => (x.clientId === cid ? { ...x, status: 'staged' } : x)) } : now))
  try {
    const me = await myUserId($)
    const json = await api($, 'POST', `${threadPath(t.isOrg, t.target)}/messages`, {}, { body: m.body, client_id: cid })
    const sent = toMessageRow(obj(obj(json).data), me)
    await update($, thread, (now): Thread | null => (now ? { ...now, messages: now.messages.map(x => (x.clientId === cid ? sent : x)) } : now))
  } catch {
    await update($, thread, (now): Thread | null => (now ? { ...now, messages: now.messages.map(x => (x.clientId === cid ? { ...x, status: 'rejected' } : x)) } : now))
  }
}

// Adds or removes your reaction; it shows at once, then dev-null.sh's list replaces it.
export async function toggleReaction($: EngineInterface, messageId: number, emoji: string): Promise<void> {
  const me = await myUserId($)
  const t = await read($, thread)
  const m = t?.messages.find(x => x.id === messageId)
  if (!t || !m || !me) return
  const isOn = m.reactions.some(r => r.userId === me && r.emoji === emoji)
  const optimistic = isOn ? m.reactions.filter(r => !(r.userId === me && r.emoji === emoji)) : [...m.reactions, { userId: me, emoji }]
  const set = (reactions: MessageRow['reactions']) =>
    update($, thread, (now): Thread | null => (now ? { ...now, messages: now.messages.map(x => (x.id === messageId ? { ...x, reactions } : x)) } : now))
  await set(optimistic)
  try {
    const json = obj(await api($, isOn ? 'DELETE' : 'POST', `remotes/messages/${messageId}/reactions`, {}, { emoji }))
    await set(list(json.reactions).map(r => ({ userId: String(r.user_id ?? ''), emoji: String(r.emoji ?? '') })))
  } catch (error) {
    await set(m.reactions)
    $.ui.toast(`/dev/null: ${reason(error)}`)
  }
}

// A request someone sent you: merge lets them in, drop declines it (they aren't told).
export async function answerRequest($: EngineInterface, answer: 'merge' | 'drop'): Promise<void> {
  const t = await read($, thread)
  if (!t || t.isOrg) return
  try {
    await api($, 'POST', `${threadPath(false, t.target)}/${answer}`)
    if (answer === 'drop') return closeThread($)
    await update($, thread, (now): Thread | null => (now ? { ...now, access: 'open' } : now))
  } catch {
    $.ui.toast('/dev/null: could not update the request. Try again.')
  }
}

// Stash files a conversation away from your inbox until someone writes; pop brings it back.
export async function setStashed($: EngineInterface, stash: boolean): Promise<void> {
  const t = await read($, thread)
  if (!t) return
  try {
    await api($, stash ? 'POST' : 'DELETE', `${threadPath(t.isOrg, t.target)}/archive`)
    if (stash) return closeThread($)
    await update($, thread, (now): Thread | null => (now ? { ...now, isArchived: false } : now))
  } catch (error) {
    $.ui.toast(`/dev/null: ${reason(error)}`)
  }
}

// Lets the other side see you typing; dev-null.sh keeps it for 5 seconds.
export async function pingTyping($: EngineInterface): Promise<void> {
  const t = await read($, thread)
  if (!t || t.access !== 'open') return
  await api($, 'PUT', `${threadPath(t.isOrg, t.target)}/typing`).catch(() => {})
}

// After a reload: an open thread starts polling again.
export async function resumeThread($: EngineInterface): Promise<void> {
  const t = await read($, thread)
  if (t?.status === 'ready') startPolling($)
}

// /devnull remote @user <message> or /devnull remote org:<id> <message>: sends straight away, as a chat does.
export async function sendFromPrompt($: EngineInterface, args: string): Promise<string> {
  if (!(await $.store.get('username'))) return 'Not signed in to /dev/null. Run /devnull login first.'
  const m = /^\s*(?:@([A-Za-z0-9][A-Za-z0-9_-]{0,38})|org:([0-9a-f-]{36}))\s+([\s\S]+)$/i.exec(args)
  if (!m) return 'Write it as /devnull remote @username your message.'
  const isOrg = m[2] !== undefined
  return sendMessage($, isOrg, (isOrg ? m[2] : m[1])!, m[3]!)
}

// A fresh client id for a message, so a retry is never sent twice.
function clientId(): string {
  const b = randomBytes(16)
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = hex(b)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

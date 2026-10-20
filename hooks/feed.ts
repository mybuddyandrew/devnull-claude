// The pane's data: loading a log or notifications, and the writes made from it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CommitRow, Compose, Tab } from '../types'
import { api, commitPath, loadAvatars, loadPictures, nextCursorOf } from './core'
import { rememberPeople } from './transcript'
import { offerPost } from './ship'
import { loadInbox } from './remotes'
import { dataList, patchCommit, toCommitRow, toNoteRow } from './devnull'
import {
  INITIAL_COMPOSE,
  INITIAL_FEED,
  INITIAL_TAB,
  INITIAL_TAB_CACHE,
  INITIAL_WINDOW_START,
  MAX_LOADED,
} from './state'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const compose = atom({ plugin: 'devnull', key: 'compose' } as const, INITIAL_COMPOSE)
const feed = atom({ plugin: 'devnull', key: 'feed' } as const, INITIAL_FEED)
const tab = atom({ plugin: 'devnull', key: 'tab' } as const, INITIAL_TAB)
const windowStart = atom({ plugin: 'devnull', key: 'windowStart' } as const, INITIAL_WINDOW_START)
const tabCache = atom({ plugin: 'devnull', key: 'tabCache' } as const, INITIAL_TAB_CACHE)

export async function refresh($: EngineInterface, more = false): Promise<void> {
  const showing = await read($, tab)
  if (!(await $.store.get('username'))) return
  // Remotes has its own inbox and paging.
  if (showing === 'remotes') return loadInbox($, undefined, more)
  const cursor = more ? (await read($, feed)).nextCursor : undefined
  // A fresh load starts drawing from the top again.
  if (!more) await update($, windowStart, () => 0)
  await update($, feed, f => ({ ...f, isLoading: true, isLoadingMore: more, error: undefined }))
  try {
    if (showing === 'notifications') {
      // Listing notifications marks them read on dev-null.sh, as the web does.
      const json = await api($, 'GET', 'notifications', { cursor })
      const rows = dataList(json).map(toNoteRow)
      await update($, feed, f => ({ ...f, isLoading: false, isLoadingMore: false, notifications: more ? [...f.notifications, ...rows].slice(0, MAX_LOADED) : rows, nextCursor: nextCursorOf(json), fetchedAt: Date.now() }))
      void loadAvatars($, rows.map(r => [r.actor, r.avatarUrl]))
    } else {
      const json = await api($, 'GET', `log/${showing}`, { cursor })
      const rows = dataList(json).map(toCommitRow)
      await update($, feed, f => ({ ...f, isLoading: false, isLoadingMore: false, commits: more ? [...f.commits, ...rows].slice(0, MAX_LOADED) : rows, nextCursor: nextCursorOf(json), fetchedAt: Date.now() }))
      const people = rows.flatMap(r => [r, ...r.replyPreview, ...(r.quoted ? [r.quoted] : [])])
      void loadAvatars($, people.map(r => [r.username, r.avatarUrl]))
      // The first image of each commit, small, for drawing inline.
      void loadPictures($, rows.flatMap(r => [...(r.pictures[0] ? [r.pictures[0].url] : []), ...(r.preview?.imageUrl ? [r.preview.imageUrl] : [])])).catch(() => {})
      // Everyone seen in a log becomes an @ completion.
      void rememberPeople($, people.map(r => r.username)).catch(() => {})
    }
  } catch (error) {
    await update($, feed, f => ({ ...f, isLoading: false, isLoadingMore: false, error: String((error as Error).message ?? error) }))
  }
}

// Switches tab: the list you're leaving is kept, and the one you're going to shows at once from what was
// kept (if anything) while it refreshes, so a switch never flashes an empty pane.
export async function show($: EngineInterface, next: Tab): Promise<void> {
  const leaving = await read($, tab)
  const now = await read($, feed)
  if (leaving !== 'remotes') {
    await update($, tabCache, c => ({ ...c, [leaving]: { commits: now.commits.slice(0, 60), notifications: now.notifications.slice(0, 60), ...(now.nextCursor ? { nextCursor: now.nextCursor } : {}) } }))
  }
  const kept = (await read($, tabCache))[next]
  await update($, tab, () => next)
  await update($, feed, f => ({ ...f, error: undefined, commits: kept?.commits ?? [], notifications: kept?.notifications ?? [], nextCursor: kept?.nextCursor }))
  await refresh($)
}

// Star, unstar, save and unsave answer with the commit; its counts replace every copy shown.
export async function react($: EngineInterface, row: CommitRow, kind: 'star' | 'save'): Promise<void> {
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

// Aims the next post (a reply to or quote of a commit, or a new one) and, for a reply or quote, starts it in
// Claude's prompt box, where there's room to write.
export async function aim($: EngineInterface, mode: Compose['mode'], row?: CommitRow): Promise<void> {
  await update($, compose, c => ({ ...c, mode, targetId: row?.id, targetHandle: row?.username, error: undefined }))
  if (mode !== 'new') await startInPrompt($)
}

// Puts `/devnull post ` (and any draft) in Claude's prompt box: full width and multi-line, unlike a pane field.
export async function startInPrompt($: EngineInterface, draft = ''): Promise<void> {
  await $.prompt.fill({ text: `/devnull post ${draft}` }).catch(() => {})
}

// Commits the composer's text as a new commit, a reply or a quote.
export async function send($: EngineInterface, text: string): Promise<void> {
  const body = text.trim()
  const c = await read($, compose)
  if (body === '' || c.isSending) return
  await update($, compose, x => ({ ...x, isSending: true, error: undefined }))
  try {
    await postCommit($, body, {
      parentId: c.mode === 'reply' ? c.targetId : undefined,
      quotedId: c.mode === 'quote' ? c.targetId : undefined,
    })
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

// Posts a commit, a reply (parentId) or a quote (quotedId); dev-null.sh takes 3 to 4000 characters, 10 a minute.
export async function postCommit($: EngineInterface, body: string, to: { parentId?: string; quotedId?: string } = {}): Promise<CommitRow> {
  const payload: Record<string, string> = { body }
  if (to.parentId) payload.parent_id = to.parentId
  if (to.quotedId) payload.quoted_commit_id = to.quotedId
  const json = (await api($, 'POST', 'commits', {}, payload)) as { data?: Record<string, unknown> }
  return toCommitRow(json.data ?? {})
}

// Puts text in the pane's composer for the person to edit and send.
export async function draftInComposer($: EngineInterface, text: string, to: { mode?: Compose['mode']; targetId?: string; targetHandle?: string } = {}): Promise<void> {
  await update($, compose, (x): Compose => ({ mode: to.mode ?? 'new', targetId: to.targetId, targetHandle: to.targetHandle, isSending: false, round: x.round + 1 }))
  await startInPrompt($, text)
}

// /devnull post <text>: offers what was typed in the main prompt box in the band above the prompt, aimed at
// whatever the composer is aimed at (a reply or a quote when one is set). Nothing is posted until Post is pressed.
export async function offerFromPrompt($: EngineInterface, text: string): Promise<string> {
  if (!(await $.store.get('username'))) return 'Not signed in to /dev/null. Run /devnull login first.'
  const body = text.trim()
  if (body.length < 3) return 'Nothing to post: write at least 3 characters after /devnull post.'
  if (body.length > 4000) return `Not posted: /dev/null takes up to 4000 characters and this is ${body.length}.`
  const c = await read($, compose)
  const to = c.mode !== 'new' && c.targetId ? { mode: c.mode, id: c.targetId, ...(c.targetHandle ? { handle: c.targetHandle } : {}) } : undefined
  await offerPost($, body, to)
  return 'Ready above the prompt: press Post (or p) to send it, Edit to change it, or Dismiss.'
}

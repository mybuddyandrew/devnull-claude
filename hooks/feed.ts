// The pane's data: loading a log or notifications, and the writes made from it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CommitRow, Compose, NoteRow, Tab } from '../types'
import { api, commitPath, nextCursorOf } from './api'
import { loadAvatars, loadPictures } from './images'
import { dataList } from './json'
import { patchCommit, toCommitRow, toNoteRow } from './rows'
import { rememberPeople } from './transcript'
import { reloadReplies } from './replies'
import { loadInbox } from './remotes'
import {
  INITIAL_COMPOSE,
  INITIAL_FEED,
  INITIAL_TAB,
  INITIAL_OPEN_REPLIES,
  INITIAL_WINDOW_START,
  MAX_LOADED,
} from './state'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const compose = atom({ plugin: 'devnull', key: 'compose' } as const, INITIAL_COMPOSE)
const feed = atom({ plugin: 'devnull', key: 'feed' } as const, INITIAL_FEED)
const tab = atom({ plugin: 'devnull', key: 'tab' } as const, INITIAL_TAB)
const windowStart = atom({ plugin: 'devnull', key: 'windowStart' } as const, INITIAL_WINDOW_START)
const openReplies = atom({ plugin: 'devnull', key: 'openReplies' } as const, INITIAL_OPEN_REPLIES)

// Each log tab's last-loaded list, shown at once when you switch back to it while it refreshes. A hot reload
// empties it, which only costs one flash of a loader.
const tabCache = new Map<Tab, { commits: CommitRow[]; notifications: NoteRow[]; nextCursor?: string }>()

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
      await update($, feed, f => ({ ...f, isLoading: false, isLoadingMore: false, notifications: more ? [...f.notifications, ...rows].slice(0, MAX_LOADED) : rows, nextCursor: nextCursorOf(json) }))
      void loadAvatars($, rows.map(r => [r.actor, r.avatarUrl]))
    } else {
      const json = await api($, 'GET', `log/${showing}`, { cursor })
      const rows = dataList(json).map(toCommitRow)
      await update($, feed, f => ({ ...f, isLoading: false, isLoadingMore: false, commits: more ? [...f.commits, ...rows].slice(0, MAX_LOADED) : rows, nextCursor: nextCursorOf(json) }))
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
    tabCache.set(leaving, { commits: now.commits.slice(0, 60), notifications: now.notifications.slice(0, 60), ...(now.nextCursor ? { nextCursor: now.nextCursor } : {}) })
  }
  const kept = tabCache.get(next)
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
  await patchOpenReplies($, row.id, optimistic)
  try {
    const json = (await api($, method, commitPath(row.id, kind === 'star' ? 'star' : 'bookmark'))) as { data?: Record<string, unknown> }
    if (json.data) {
      const fresh = toCommitRow(json.data)
      await update($, feed, f => ({
        ...f,
        commits: patchCommit(f.commits, row.id, r => ({ ...r, stars: fresh.stars, isStarred: fresh.isStarred, isSaved: kind === 'save' ? on : r.isSaved })),
      }))
      await patchOpenReplies($, row.id, r => ({ ...r, stars: fresh.stars, isStarred: fresh.isStarred, isSaved: kind === 'save' ? on : r.isSaved }))
    }
  } catch (error) {
    await update($, feed, f => ({ ...f, commits: patchCommit(f.commits, row.id, () => row) }))
    await patchOpenReplies($, row.id, () => row)
    $.ui.toast(`/dev/null: ${(error as Error).message}`)
  }
}

// Aims the next post (a reply to or quote of a commit, or a new one) and, for a reply or quote, starts it in
// Claude's prompt box, where there's room to write.
export async function aim($: EngineInterface, mode: Compose['mode'], row?: CommitRow): Promise<void> {
  await update($, compose, c => ({ ...c, mode, targetId: row?.id, targetHandle: row?.username }))
  if (mode !== 'new') await startInPrompt($)
}

// Puts `/devnull post ` (and any draft) in Claude's prompt box: full width and multi-line, unlike a pane field.
export async function startInPrompt($: EngineInterface, draft = ''): Promise<void> {
  await $.prompt.fill({ text: `/devnull post ${draft}` }).catch(() => {})
}

// Puts text in the pane's composer for the person to edit and send.
export async function draftInComposer($: EngineInterface, text: string, to: { mode?: Compose['mode']; targetId?: string; targetHandle?: string } = {}): Promise<void> {
  await update($, compose, (x): Compose => ({ mode: to.mode ?? 'new', targetId: to.targetId, targetHandle: to.targetHandle, round: x.round + 1 }))
  await startInPrompt($, text)
}

// A commit shown in an open reply thread changes there too (a star, a save).
async function patchOpenReplies($: EngineInterface, id: string, patch: (row: CommitRow) => CommitRow): Promise<void> {
  await update($, openReplies, o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v, replies: patchCommit(v.replies, id, patch) }])))
}

// After a reply is posted: its parent counts one more reply, and an open thread under it reloads to show it.
export async function noteReply($: EngineInterface, parentId: string): Promise<void> {
  await update($, feed, f => ({ ...f, commits: patchCommit(f.commits, parentId, r => ({ ...r, replies: r.replies + 1 })) }))
  await reloadReplies($, parentId)
}

// Starts a post in Claude's prompt box from a press in the pane. No mods API can focus the prompt box, and
// closing the pane doesn't hand it focus on the desktop either, so the person clicks it to type.
export async function composeInPrompt($: EngineInterface, mode: Compose['mode'] = 'new', row?: CommitRow): Promise<void> {
  if (mode === 'new') await startInPrompt($)
  else await aim($, mode, row)
}

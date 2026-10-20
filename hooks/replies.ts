// Reply threads inline in the feed: a post's replies open right under it, and fold away again.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CommitRow } from '../types'

import { api, loadAvatars } from './core'
import { dataList, toCommitRow } from './devnull'
import { INITIAL_OPEN_REPLIES } from './state'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
type Open = Record<string, { status: 'loading' | 'ready' | 'failed'; replies: CommitRow[]; error?: string }>

const openReplies = atom({ plugin: 'devnull', key: 'openReplies' } as const, INITIAL_OPEN_REPLIES)

// Opens a post's replies under it (GET commits/{id}/replies, oldest first), or folds them away if open.
export async function toggleReplies($: EngineInterface, commitId: string): Promise<void> {
  if ((await read($, openReplies))[commitId]) {
    await update($, openReplies, (o): Open => Object.fromEntries(Object.entries(o).filter(([id]) => id !== commitId)))
    return
  }
  await update($, openReplies, (o): Open => ({ ...o, [commitId]: { status: 'loading', replies: [] } }))
  try {
    const rows = dataList(await api($, 'GET', `commits/${encodeURIComponent(commitId)}/replies`)).map(toCommitRow)
    await update($, openReplies, (o): Open => (o[commitId] ? { ...o, [commitId]: { status: 'ready', replies: rows } } : o))
    void loadAvatars($, rows.map((r): [string, string | undefined] => [r.username, r.avatarUrl]))
  } catch (error) {
    await update($, openReplies, (o): Open => (o[commitId] ? { ...o, [commitId]: { status: 'failed', replies: [], error: (error as Error).message } } : o))
  }
}

// After you reply, an open thread shows your reply too.
export async function reloadReplies($: EngineInterface, commitId: string): Promise<void> {
  if (!(await read($, openReplies))[commitId]) return
  try {
    const rows = dataList(await api($, 'GET', `commits/${encodeURIComponent(commitId)}/replies`)).map(toCommitRow)
    await update($, openReplies, (o): Open => (o[commitId] ? { ...o, [commitId]: { status: 'ready', replies: rows } } : o))
  } catch {}
}

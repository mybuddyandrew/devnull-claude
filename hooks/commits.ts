// Commits read and written outside the log: a post, and one commit with its thread.
import type { EngineInterface } from 'claude-code'

import type { CommitRow } from '../types'
import { api, commitPath, nextCursorOf } from './api'
import { dataList, list, obj } from './json'
import { toCommitRow } from './rows'

export type CommitThread = { commit: CommitRow; ancestors: CommitRow[]; replies: CommitRow[]; hasMoreReplies: boolean }

// Posts a commit, a reply (parentId) or a quote (quotedId); dev-null.sh takes 3 to 4000 characters, 10 a minute.
export async function postCommit($: EngineInterface, body: string, to: { parentId?: string; quotedId?: string } = {}): Promise<CommitRow> {
  const payload: Record<string, string> = { body }
  if (to.parentId) payload.parent_id = to.parentId
  if (to.quotedId) payload.quoted_commit_id = to.quotedId
  const json = (await api($, 'POST', 'commits', {}, payload)) as { data?: Record<string, unknown> }
  return toCommitRow(json.data ?? {})
}

// One commit with what it replies to (oldest first) and the first page of its replies.
export async function fetchThread($: EngineInterface, id: string): Promise<CommitThread> {
  const [one, replies] = await Promise.all([
    api($, 'GET', `commits/${encodeURIComponent(id)}`),
    api($, 'GET', commitPath(id, 'replies')).catch(() => ({})),
  ])
  const data = obj(obj(one).data)
  if (Object.keys(data).length === 0) throw new Error('commit not found')
  return {
    commit: toCommitRow(data),
    ancestors: list(obj(one).ancestors).map(toCommitRow),
    replies: dataList(replies).map(toCommitRow),
    hasMoreReplies: nextCursorOf(replies) !== undefined,
  }
}

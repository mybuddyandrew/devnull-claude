// dev-null.sh's JSON turned into the rows the pane draws.

import type { CommitRow, ConversationRow, MessageRow, NoteRow } from '../types'
import type { Json } from './json'
import { count, dataList, list, obj, str } from './json'
import { safeImageUrl } from './text'

// The web's dark lane lifts; a custom lane is its own #rrggbb.
export const LANES = ['#ff8a4c', '#51cf66', '#da77f2', '#3bc9db', '#f06595', '#fcc419']

export const RAIL = '#36363a'

export const laneColor = (lane: unknown): string => {
  if (typeof lane === 'string' && /^#[0-9a-f]{6}$/i.test(lane)) return lane.toLowerCase()
  const n = typeof lane === 'number' ? lane : typeof lane === 'string' && /^\d$/.test(lane) ? Number(lane) : -1
  return LANES[n] ?? RAIL
}

export const toCommitRow = (c: Json): CommitRow => {
  const author = obj(c.author)
  const id = String(c.id ?? '')
  const isDeleted = str(c.deleted_at) !== undefined
  const quoted = obj(c.quoted_commit)
  return {
    id,
    hash: str(c.short_hash) ?? id.slice(0, 7),
    username: str(author.username) ?? '?',
    name: str(author.name),
    avatarUrl: str(author.avatar_url),
    lane: isDeleted ? RAIL : laneColor(author.lane),
    body: isDeleted ? '*This commit was deleted.*' : (str(c.body) ?? ''),
    createdAt: str(c.created_at),
    stars: count(c.stars_count),
    replies: count(c.replies_count),
    images: list(c.images).length,
    ...linkPreviewOf(c.link_preview),
    pictures: list(c.images)
      .map(i => ({ url: str(i.url) ?? '', width: count(i.width), height: count(i.height), ...(str(i.description) ? { alt: str(i.description) } : {}) }))
      .filter(p => safeImageUrl(p.url)),
    isStarred: c.starred === true,
    isSaved: c.is_saved === true,
    // The desktop draws a Link only when its href has no raw '@'; only dev-null.sh's own links are kept.
    url: str(c.html_url)?.startsWith('https://dev-null.sh/') ? str(c.html_url)!.replace(/@/g, '%40') : undefined,
    quoted: str(quoted.id) ? toCommitRow(quoted) : undefined,
    replyPreview: dataList(c.reply_preview).slice(0, 2).map(toCommitRow),
  }
}

export const toNoteRow = (n: Json): NoteRow => {
  const actors = list(n.actors)
  const first = str(obj(n.actor).username) ? obj(n.actor) : (actors[0] ?? {})
  const total = Math.max(1, actors.length, count(n.actors_count))
  const unread = typeof n.unread_count === 'number' ? n.unread_count > 0 : 'read_at' in n && n.read_at === null
  return {
    id: String(n.id ?? ''),
    type: str(n.type) ?? '',
    actor: str(first.username) ?? '?',
    avatarUrl: str(first.avatar_url),
    lane: laneColor(first.lane),
    others: total - 1,
    excerpt: str(obj(n.commit).body),
    createdAt: str(n.created_at),
    isUnread: unread,
  }
}

// Every row in a list, nested replies and quotes included, with `id` patched.
export const patchCommit = (rows: CommitRow[], id: string, patch: (row: CommitRow) => CommitRow): CommitRow[] =>
  rows.map(row => {
    const next = row.id === id ? patch(row) : row
    return {
      ...next,
      quoted: next.quoted ? patchCommit([next.quoted], id, patch)[0] : undefined,
      replyPreview: patchCommit(next.replyPreview, id, patch),
    }
  })

// How a notification reads after the actor's name, and the glyph beside it.
export const NOTE_KINDS: Record<string, { verb: string; glyph: string }> = {
  replied: { verb: 'replied to your commit', glyph: '↩' },
  quoted: { verb: 'quoted your commit', glyph: '❝' },
  starred: { verb: 'starred your commit', glyph: '★' },
  mentioned: { verb: 'mentioned you', glyph: '@' },
  followed: { verb: 'followed you', glyph: '+' },
  approved: { verb: 'approved your commit', glyph: '✓' },
  rejected: { verb: 'held back your commit', glyph: '!' },
}

// A commit's link preview, once dev-null.sh has fetched it: the card's text and image, the link made safe for
// the desktop's links (no raw @). A playable embed (a video, a song) is drawn as its card.
export const linkPreviewOf = (raw: unknown): { preview?: CommitRow['preview'] } => {
  const p = obj(raw)
  const url = str(p.url)
  if (!url || !/^https?:\/\//.test(url) || p.is_pending === true) return {}
  const embed = obj(p.embed)
  const image = str(p.image_url) ?? str(embed.poster)
  const site = str(p.site_name) ?? str(embed.provider) ?? hostOf(url)
  return {
    preview: {
      url: url.replace(/@/g, '%40'),
      ...(str(p.title) ? { title: str(p.title) } : {}),
      ...(str(p.description) ? { description: str(p.description) } : {}),
      ...(site ? { site } : {}),
      ...(image && safeImageUrl(image) ? { imageUrl: image } : {}),
    },
  }
}

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

// Remotes (direct messages). A message is yours when its user_id is your account's id.
export const toMessageRow = (m: Json, myId: string | undefined): MessageRow => {
  const user = obj(m.user)
  const replyTo = obj(m.reply_to)
  const userId = String(m.user_id ?? '')
  return {
    id: typeof m.id === 'number' ? m.id : Number(m.id ?? 0) || 0,
    userId,
    ...(str(user.username) ? { username: str(user.username) } : {}),
    isMine: myId !== undefined && userId !== '' && userId === myId,
    body: str(m.body) ?? '',
    ...(typeof replyTo.id === 'number' ? { replyTo: { id: replyTo.id, body: str(replyTo.body) ?? (count(replyTo.images_count) ? '(image)' : '') } } : {}),
    ...(str(m.event) ? { event: str(m.event) } : {}),
    reactions: list(m.reactions).map(r => ({ userId: String(r.user_id ?? ''), emoji: str(r.emoji) ?? '' })).filter(r => r.emoji),
    images: list(m.images).length,
    ...(str(m.created_at) ? { createdAt: str(m.created_at) } : {}),
    ...(str(m.client_id) ? { clientId: str(m.client_id) } : {}),
  }
}

export const toConversationRow = (c: Json, myId: string | undefined): ConversationRow => {
  const isOrg = c.kind === 'org'
  const partner = obj(c.partner)
  const members = list(c.members).map(m => obj(m.user))
  const others = members.filter(u => String(u.id ?? '') !== myId)
  const face = isOrg ? (others[0] ?? {}) : partner
  const last = obj(c.last_message)
  const lastBody = str(last.body) ?? (list(last.images).length ? 'sent an image' : str(last.event) ? `${str(last.event)}` : undefined)
  const title = isOrg
    ? (str(c.name) ?? (others.map(u => str(u.username)).filter(Boolean).slice(0, 3).join(', ') || 'org'))
    : (str(partner.name) ?? str(partner.username) ?? '?')
  return {
    id: String(c.id ?? ''),
    isOrg,
    target: isOrg ? String(c.id ?? '') : (str(partner.username) ?? ''),
    title,
    lane: laneColor(face.lane),
    ...(str(face.avatar_url) ? { avatarUrl: str(face.avatar_url), avatarUser: str(face.username) } : {}),
    ...(lastBody ? { lastText: lastBody } : {}),
    lastIsMine: myId !== undefined && String(last.user_id ?? '') === myId,
    ...(str(c.last_message_at) ? { lastAt: str(c.last_message_at) } : {}),
    ahead: count(c.ahead),
    isArchived: c.is_archived === true,
  }
}

// The pieces of the devnull API that need no engine: request targets, the
// signed message, PKCE, and turning API JSON into the rows the pane draws.
// Mirrors App\Devnull\Client and RequestSigner in nativephp/dev-null-app.

import type { CommitRow, ConversationRow, MessageRow, NoteRow } from '../types'

export const BASE_URL = 'https://dev-null.sh'
export const NAMESPACE = 'devnull-api'
export const REDIRECT_URI = 'devnull://auth/callback'

type Json = Record<string, unknown>

// PHP's http_build_query with PHP_QUERY_RFC3986: encodeURIComponent plus !'()*.
export const rfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())

export const query = (params: Record<string, string | null | undefined>): string =>
  Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== undefined && entry[1] !== '')
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join('&')

// The request target as the server sees it: path plus query, exactly as sent.
export const target = (path: string, params: Record<string, string | null | undefined> = {}): string => {
  const qs = query(params)
  return '/api/v1/' + path + (qs === '' ? '' : '?' + qs)
}

export const signingMessage = (timestamp: string, nonce: string, method: string, tgt: string, body: string): string =>
  [timestamp, nonce, method.toUpperCase(), tgt, body].join('\n')

// ssh-keygen -Y sign writes an armored SSHSIG; devnull wants the base64 on one line.
export const unarmor = (armored: string): string =>
  armored
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('-----'))
    .join('')

export const hex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

export const base64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n))

export const challenge = async (verifier: string): Promise<string> =>
  base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))

export const authorizeUrl = (p: { fingerprint: string; deviceName: string; challenge: string; state: string }): string =>
  `${BASE_URL}/mobile/authorize?` +
  query({
    fingerprint: p.fingerprint,
    device_name: p.deviceName,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
    redirect_uri: REDIRECT_URI,
  })

// devnull://auth/callback?code=...&state=... (or ?error=access_denied&state=...)
export const parseCallback = (url: string): { code?: string; state?: string; error?: string } => {
  const qs = url.trim().split('?')[1] ?? ''
  const out: Record<string, string> = {}
  for (const pair of qs.split('&')) {
    const [k, v = ''] = pair.split('=')
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '))
  }
  return { code: out.code, state: out.state, error: out.error }
}

// `256 SHA256:abc... comment (ED25519)` → `SHA256:abc...`
export const fingerprintOf = (keygenLine: string): string => keygenLine.trim().split(/\s+/)[1] ?? ''

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const num = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0)
const obj = (v: unknown): Json => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(x => x !== null && typeof x === 'object').map(obj) : [])

export const dataList = (json: unknown): Json[] => list(obj(json).data)

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
    stars: num(c.stars_count),
    replies: num(c.replies_count),
    images: list(c.images).length,
    ...linkPreviewOf(c.link_preview),
    pictures: list(c.images)
      .map(i => ({ url: str(i.url) ?? '', width: num(i.width), height: num(i.height), ...(str(i.description) ? { alt: str(i.description) } : {}) }))
      .filter(p => p.url.startsWith('https://')),
    isStarred: c.starred === true,
    isSaved: c.is_saved === true,
    // The desktop draws a Link only when its href has no raw '@'.
    url: str(c.html_url)?.replace(/@/g, '%40'),
    quoted: str(quoted.id) ? toCommitRow(quoted) : undefined,
    replyPreview: dataList(c.reply_preview).slice(0, 2).map(toCommitRow),
  }
}

export const toNoteRow = (n: Json): NoteRow => {
  const actors = list(n.actors)
  const first = str(obj(n.actor).username) ? obj(n.actor) : (actors[0] ?? {})
  const count = Math.max(1, actors.length, num(n.actors_count))
  const unread = typeof n.unread_count === 'number' ? n.unread_count > 0 : 'read_at' in n && n.read_at === null
  return {
    id: String(n.id ?? ''),
    type: str(n.type) ?? '',
    actor: str(first.username) ?? '?',
    avatarUrl: str(first.avatar_url),
    lane: laneColor(first.lane),
    others: count - 1,
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

// A ringed avatar, the image clipped to a circle; the initial until the image arrives.
export const avatarSvg = (lane: string, size: number, dataUri?: string, initial = '?'): string => {
  const c = size / 2
  const inner = c - 4
  const face = dataUri
    ? `<clipPath id="a"><circle cx="${c}" cy="${c}" r="${inner}"/></clipPath><image href="${dataUri}" x="4" y="4" width="${size - 8}" height="${size - 8}" clip-path="url(#a)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="${c}" cy="${c}" r="${inner}" fill="#232326"/><text x="${c}" y="${c}" dy="0.35em" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="${Math.round(size * 0.36)}" fill="#ececec">${escapeXml(initial.slice(0, 1).toUpperCase())}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${face}<circle cx="${c}" cy="${c}" r="${c - 1.5}" fill="none" stroke="${lane}" stroke-width="2.5"/></svg>`
}

// The lane's tail under an avatar, fading out: the graph's colour without a row-tall rail.
export const TAIL_HEIGHT = 44
export const tailSvg = (lane: string, width: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${TAIL_HEIGHT}" viewBox="0 0 ${width} ${TAIL_HEIGHT}"><defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lane}"/><stop offset="1" stop-color="${lane}" stop-opacity="0"/></linearGradient></defs><rect x="${width / 2 - 1}" y="0" width="2" height="${TAIL_HEIGHT}" fill="url(#t)"/></svg>`

// The active tab's underline.
export const underlineSvg = (width: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="3" viewBox="0 0 ${width} 3"><rect width="${width}" height="3" rx="1.5" fill="#7aa2f7"/></svg>`

// A long body cut to its first lines, with any code fence the cut left open closed again.
export const BODY_LINES = 10
export const BODY_CHARS = 600
export const preview = (body: string): { text: string; isCut: boolean } => {
  const lines = body.split('\n')
  if (lines.length <= BODY_LINES && body.length <= BODY_CHARS) return { text: body, isCut: false }
  let text = lines.slice(0, BODY_LINES).join('\n').slice(0, BODY_CHARS).trimEnd()
  if ((text.match(/^```/gm) ?? []).length % 2 === 1) text += '\n```'
  return { text: text + '\n\n…', isCut: true }
}

const escapeXml = (s: string): string => s.replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch] ?? ch)

export const ago = (iso: string | undefined, nowMs: number): string => {
  if (!iso) return ''
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

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

// @mentions: a handle is a letter or digit then up to 38 of letters, digits, _ or -, as GitHub usernames are.
// Its link is the person's dev-null.sh profile, the @ written %40 as the desktop's links need.
export const MENTION_HREF = 'https://dev-null.sh/%40'
const MENTION = /(^|[^\w/@.])@([A-Za-z0-9][A-Za-z0-9_-]{0,38})(?![\w-])/g

// The handles a text mentions, outside code, each once, in order.
export const mentionsIn = (text: string): string[] => {
  const seen = new Set<string>()
  for (const part of proseParts(text)) for (const m of part.matchAll(MENTION)) seen.add(m[2]!)
  return [...seen]
}

// Markdown with each @mention outside code made a link to that person's profile.
export const linkMentions = (markdown: string): string => {
  let inFence = false
  return markdown
    .split('\n')
    .map(line => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      // Odd-numbered pieces between backticks are inline code: left as written.
      return line
        .split('`')
        .map((piece, i) => (i % 2 === 1 ? piece : piece.replace(MENTION, (_, before: string, handle: string) => `${before}[@${handle}](${MENTION_HREF}${handle})`)))
        .join('`')
    })
    .join('\n')
}

// The handle a mention link points at, or undefined for any other link.
export const handleFromHref = (href: string): string | undefined =>
  href.startsWith(MENTION_HREF) ? decodeURIComponent(href.slice(MENTION_HREF.length)).replace(/^@/, '') || undefined : undefined

// The text outside fenced and inline code, where a mention can be.
const proseParts = (text: string): string[] => {
  let inFence = false
  return text.split('\n').flatMap(line => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      return []
    }
    return inFence ? [] : line.split('`').filter((_, i) => i % 2 === 0)
  })
}

// A commit image drawn inline: its small JPEG in a rounded frame at the image's own shape, at most `max` px wide.
export const pictureSvg = (dataUri: string, width: number, height: number, max = 260): { source: string; width: number; height: number } => {
  const w = Math.max(1, Math.min(max, width || max))
  const h = Math.max(1, Math.round(width && height ? (w * height) / width : w * 0.75))
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><clipPath id="p"><rect width="${w}" height="${h}" rx="8"/></clipPath><image href="${dataUri}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#p)"/><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8" fill="none" stroke="#2a2a2d"/></svg>`,
    width: w,
    height: h,
  }
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
      ...(image && image.startsWith('https://') ? { imageUrl: image } : {}),
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
    ...(typeof replyTo.id === 'number' ? { replyTo: { id: replyTo.id, body: str(replyTo.body) ?? (num(replyTo.images_count) ? '(image)' : '') } } : {}),
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
    ahead: num(c.ahead),
    isArchived: c.is_archived === true,
  }
}

// Where a conversation's API lives: a person by username, an org by id.
export const threadPath = (isOrg: boolean, target: string): string =>
  isOrg ? `remotes/orgs/${encodeURIComponent(target)}` : `remotes/@${encodeURIComponent(target)}`

// A fresh client id for a message, so a retry is never sent twice.
export const clientId = (): string => {
  const b = randomBytes(16)
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = hex(b)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// Loaders, drawn as small animated SVGs (SMIL, which the desktop runs when the Svg is interactive).
// The pulse and sweep are slow and quiet, like the web's own skeletons.
const PULSE = '<animate attributeName="opacity" values="0.35;0.75;0.35" dur="1.4s" repeatCount="indefinite"/>'

// A placeholder for one row while its list loads: an avatar and three lines of text.
export const skeletonSvg = (width = 480, avatar = 40): { source: string; width: number; height: number } => {
  const x = avatar + 16
  const w = Math.max(80, width - x)
  const bar = (y: number, frac: number, h = 10) => `<rect x="${x}" y="${y}" width="${Math.round(w * frac)}" height="${h}" rx="${h / 2}" fill="#3a3a3e"/>`
  const height = Math.max(avatar, 62)
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g>${PULSE}<circle cx="${avatar / 2}" cy="${avatar / 2}" r="${avatar / 2}" fill="#3a3a3e"/>${bar(4, 0.35, 12)}${bar(26, 0.9)}${bar(44, 0.6)}</g></svg>`,
    width,
    height,
  }
}

// A thin bar sweeping across the top while a list refreshes over what's already shown.
export const progressSvg = (width: number, color: string): { source: string; width: number; height: number } => {
  const seg = Math.round(width * 0.3)
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="2" viewBox="0 0 ${width} 2"><rect width="${width}" height="2" fill="${color}" fill-opacity="0.15"/><rect x="${-seg}" width="${seg}" height="2" rx="1" fill="${color}"><animate attributeName="x" from="${-seg}" to="${width}" dur="1.1s" repeatCount="indefinite"/></rect></svg>`,
    width,
    height: 2,
  }
}

// A small spinning arc beside a button's label.
export const spinnerSvg = (size: number, color: string): string => {
  const c = size / 2
  const r = c - 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-opacity="0.2" stroke-width="2"/><path d="M${c} ${c - r} A${r} ${r} 0 0 1 ${c + r} ${c}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 ${c} ${c}" to="360 ${c} ${c}" dur="0.8s" repeatCount="indefinite"/></path></svg>`
}

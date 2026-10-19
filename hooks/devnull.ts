// The pieces of the devnull API that need no engine: request targets, the
// signed message, PKCE, and turning API JSON into the rows the pane draws.
// Mirrors App\Devnull\Client and RequestSigner in nativephp/dev-null-app.

import type { CommitRow, NoteRow } from '../types'

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
export const TAIL_HEIGHT = 28
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
  reply: { verb: 'replied to your commit', glyph: '↩' },
  quote: { verb: 'quoted your commit', glyph: '❝' },
  star: { verb: 'starred your commit', glyph: '★' },
  mention: { verb: 'mentioned you', glyph: '@' },
  follow: { verb: 'followed you', glyph: '+' },
}

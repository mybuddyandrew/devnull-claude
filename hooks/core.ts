// Talking to dev-null.sh: the device key, signed requests, local commands and avatars.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { BASE_URL, NAMESPACE, hex, randomBytes, signingMessage, target, unarmor } from './devnull'
import {
  AVATAR_MAX_CHARS,
  INITIAL_AVATARS,
  INITIAL_PICTURES,
  LSREGISTER,
  PICTURE_MAX_CHARS,
} from './state'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const avatars = atom({ plugin: 'devnull', key: 'avatars' } as const, INITIAL_AVATARS)
const pictures = atom({ plugin: 'devnull', key: 'pictures' } as const, INITIAL_PICTURES)

export type Paths = { dir: string; key: string; callback: string; app: string }

export async function paths($: EngineInterface): Promise<Paths> {
  const dir = `${(await $.env.get('HOME')) ?? ''}/.devnull-claude`
  return { dir, key: `${dir}/id_ed25519`, callback: `${dir}/callback`, app: `${dir}/Devnull Callback.app` }
}

export async function run($: EngineInterface, argv: string[], stdin?: string): Promise<string> {
  const out = await $.process.run(argv, { stdin })
  if (out.exitCode !== 0) throw new Error(`${argv[0]}: ${out.stderr.trim() || `exit ${out.exitCode}`}`)
  return out.stdout
}

// This device's key: made once, kept in ~/.devnull-claude, never leaves the machine.
export async function ensureKey($: EngineInterface, p: Paths): Promise<void> {
  if (await $.fs.exists(p.key)) return
  await run($, ['mkdir', '-p', '-m', '700', p.dir])
  await run($, ['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'devnull-claude-code', '-f', p.key])
}

// dev-null.sh only sends its code back to devnull://, so a tiny local applet
// claims that scheme and drops the URL in a file this mod polls.
export async function ensureHandler($: EngineInterface, p: Paths): Promise<void> {
  if (await $.fs.exists(p.app)) return
  const script = `${p.dir}/callback.applescript`
  await $.fs.write(
    script,
    [
      'on open location theURL',
      `\tdo shell script "umask 077; printf '%s' " & quoted form of theURL & " > " & quoted form of "${p.callback}"`,
      'end open location',
      '',
    ].join('\n'),
  )
  const plist = `${p.app}/Contents/Info.plist`
  await run($, ['osacompile', '-o', p.app, script])
  await run($, ['plutil', '-insert', 'CFBundleURLTypes', '-json', '[{"CFBundleURLName":"sh.dev-null.claude-callback","CFBundleURLSchemes":["devnull"]}]', plist])
  await run($, ['plutil', '-replace', 'CFBundleIdentifier', '-string', 'sh.dev-null.claude-callback', plist])
  await run($, ['plutil', '-insert', 'LSBackgroundOnly', '-bool', 'YES', plist])
  await run($, ['codesign', '--force', '--deep', '--sign', '-', p.app])
  await run($, [LSREGISTER, '-f', p.app])
}

export async function signedHeaders($: EngineInterface, p: Paths, method: string, tgt: string, body: string) {
  const timestamp = String(Math.floor((await $.clock.now()) / 1000))
  const nonce = hex(randomBytes(16))
  const armored = await run($, ['ssh-keygen', '-Y', 'sign', '-n', NAMESPACE, '-f', p.key], signingMessage(timestamp, nonce, method, tgt, body))
  return { 'X-Devnull-Timestamp': timestamp, 'X-Devnull-Nonce': nonce, 'X-SSH-Signature': unarmor(armored) }
}

export async function api(
  $: EngineInterface,
  method: string,
  path: string,
  params: Record<string, string | null | undefined> = {},
  payload?: Record<string, unknown>,
): Promise<unknown> {
  const p = await paths($)
  const tgt = target(path, params)
  const body = payload ? JSON.stringify(payload) : ''
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== '') headers['Content-Type'] = 'application/json'
  // Every request is signed: dev-null.sh serves no logs to guests.
  Object.assign(headers, await signedHeaders($, p, method, tgt, body))

  const res = await $.http.fetch(BASE_URL + tgt, { method, headers, body: body || undefined })
  let json: unknown = {}
  try {
    json = JSON.parse(res.text)
  } catch {}
  if (!res.ok) {
    const message = (json as { message?: unknown }).message
    throw new Error(`${res.status} ${typeof message === 'string' ? message : ''}`.trim())
  }
  return json
}

export const nextCursorOf = (json: unknown): string | undefined => {
  const cursor = (json as { meta?: { next_cursor?: unknown } }).meta?.next_cursor
  return typeof cursor === 'string' && cursor !== '' ? cursor : undefined
}

// Avatars arrive as data: URIs so the SVG ring can draw them with no network of its own.
export async function loadAvatars($: EngineInterface, people: [string, string | undefined][]): Promise<void> {
  const have = await read($, avatars)
  const wanted = new Map(people.filter((p): p is [string, string] => !!p[1] && !((have[p[0]]?.length ?? Infinity) <= AVATAR_MAX_CHARS)))
  const queue = [...wanted]
  // Collected, then written once: every write redraws the pane, and a redraw under a click drops the click.
  const got: Record<string, string> = {}
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await fetchAvatar(next)
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  if (Object.keys(got).length > 0) await update($, avatars, a => ({ ...a, ...got }))

  async function fetchAvatar([username, url]: [string, string]): Promise<void> {
    {
      try {
        const sized = url + (url.includes('?') ? '&' : '?') + 's=64'
        // Every avatar rides inside the drawn tree, which the desktop drops past a few hundred KB:
        // sips shrinks each to a small JPEG (about 2.5 KB of base64).
        const script = 't=$(mktemp); curl -sfL --max-time 10 "$1" -o "$t" && sips -s format jpeg -s formatOptions 55 -Z 64 "$t" --out "$t.jpg" >/dev/null 2>&1 && base64 < "$t.jpg"; rm -f "$t" "$t.jpg"'
        const out = await $.process.run(['/bin/sh', '-c', script, 'sh', sized])
        const b64 = out.stdout.replace(/\s+/g, '')
        if (out.exitCode !== 0 || b64 === '' || b64.length > AVATAR_MAX_CHARS) return
        got[username] = `data:image/jpeg;base64,${b64}`
      } catch {}
    }
  }
}

export const commitPath = (id: string, rest: string) => `commits/${encodeURIComponent(id)}/${rest}`

// Commit images arrive as small JPEG data: URIs (the desktop draws SVG as an image, with no network of its
// own), at most 260px and 16 KB each, a few at a time; any that fail or run larger are left as links.
export async function loadPictures($: EngineInterface, urls: readonly string[]): Promise<void> {
  const have = await read($, pictures)
  const queue = [...new Set(urls)].filter(u => u.startsWith('https://') && have[u] === undefined)
  // Collected, then written once, as avatars are.
  const got: Record<string, string> = {}
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) await fetchPicture(url)
  }
  await Promise.all([worker(), worker(), worker()])
  if (Object.keys(got).length > 0) await update($, pictures, p => ({ ...p, ...got }))

  async function fetchPicture(url: string): Promise<void> {
    try {
      const script = 't=$(mktemp); curl -sfL --max-time 15 "$1" -o "$t" && sips -s format jpeg -s formatOptions 45 -Z 260 "$t" --out "$t.jpg" >/dev/null 2>&1 && base64 < "$t.jpg"; rm -f "$t" "$t.jpg"'
      const out = await $.process.run(['/bin/sh', '-c', script, 'sh', url], { timeoutMs: 30_000 })
      const b64 = out.stdout.replace(/\s+/g, '')
      // An empty string marks one that failed or ran too large, so it isn't fetched again this session.
      const value = out.exitCode === 0 && b64 !== '' && b64.length <= PICTURE_MAX_CHARS ? `data:image/jpeg;base64,${b64}` : ''
      got[url] = value
    } catch {}
  }
}

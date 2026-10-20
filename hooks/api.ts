// Talking to dev-null.sh: the device key, the sign-in handler, signed requests and local commands.
import type { EngineInterface } from 'claude-code'

import { BASE_URL, NAMESPACE, hex, randomBytes, signingMessage, target, unarmor } from './sign'
import { BIN, HANDLER_VERSION, LSREGISTER } from './state'

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

// This device's key: made once, kept in ~/.devnull-claude, never leaves the machine. The folder and key are
// set to owner-only each time, so one created or loosened elsewhere is tightened.
export async function ensureKey($: EngineInterface, p: Paths): Promise<void> {
  await run($, [BIN.mkdir, '-p', '-m', '700', p.dir])
  await run($, [BIN.chmod, '700', p.dir])
  if (!(await $.fs.exists(p.key))) await run($, [BIN.sshKeygen, '-q', '-t', 'ed25519', '-N', '', '-C', 'devnull-claude-code', '-f', p.key])
  await run($, [BIN.chmod, '600', p.key])
}

// dev-null.sh only sends its code back to devnull://, so a tiny local applet
// claims that scheme and drops the URL in a file this mod polls.
// It writes only the login callback (devnull://auth/callback…, at most 4 KB) and ignores any other devnull://
// link a page or app might open. Rebuilt when HANDLER_VERSION changes.
export async function ensureHandler($: EngineInterface, p: Paths): Promise<void> {
  const marker = `${p.dir}/handler-version`
  const built = (await $.fs.exists(marker)) ? (await $.fs.read(marker)).trim() : ''
  if (built === HANDLER_VERSION && (await $.fs.exists(p.app))) return
  const script = `${p.dir}/callback.applescript`
  await $.fs.write(
    script,
    [
      'on open location theURL',
      '\tif theURL starts with "devnull://auth/callback" and (length of theURL) < 4096 then',
      `\t\tdo shell script "umask 077; printf '%s' " & quoted form of theURL & " > " & quoted form of ${appleString(p.callback)}`,
      '\tend if',
      'end open location',
      '',
    ].join('\n'),
  )
  const plist = `${p.app}/Contents/Info.plist`
  await run($, [BIN.rm, '-rf', p.app])
  await run($, [BIN.osacompile, '-o', p.app, script])
  await run($, [BIN.plutil, '-insert', 'CFBundleURLTypes', '-json', '[{"CFBundleURLName":"sh.dev-null.claude-callback","CFBundleURLSchemes":["devnull"]}]', plist])
  await run($, [BIN.plutil, '-replace', 'CFBundleIdentifier', '-string', 'sh.dev-null.claude-callback', plist])
  await run($, [BIN.plutil, '-insert', 'LSBackgroundOnly', '-bool', 'YES', plist])
  await run($, [BIN.codesign, '--force', '--deep', '--sign', '-', p.app])
  await run($, [LSREGISTER, '-f', p.app])
  await $.fs.write(marker, HANDLER_VERSION)
}

// An AppleScript string literal: quotes and backslashes escaped.
const appleString = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export async function signedHeaders($: EngineInterface, p: Paths, method: string, tgt: string, body: string) {
  const timestamp = String(Math.floor((await $.clock.now()) / 1000))
  const nonce = hex(randomBytes(16))
  const armored = await run($, [BIN.sshKeygen, '-Y', 'sign', '-n', NAMESPACE, '-f', p.key], signingMessage(timestamp, nonce, method, tgt, body))
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

export const commitPath = (id: string, rest: string) => `commits/${encodeURIComponent(id)}/${rest}`

// Where a conversation's API lives: a person by username, an org by id.
export const threadPath = (isOrg: boolean, target: string): string =>
  isOrg ? `remotes/orgs/${encodeURIComponent(target)}` : `remotes/@${encodeURIComponent(target)}`

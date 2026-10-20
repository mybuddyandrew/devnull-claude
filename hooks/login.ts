// Signing this device in: the browser approval, the devnull:// callback, and signing out.
import { atom, update } from 'claude-code'
import type { EngineInterface, Timer } from 'claude-code'

import type { Login } from '../types'
import { api, ensureHandler, ensureKey, paths, run } from './api'
import { authorizeUrl, base64Url, challenge, fingerprintOf, parseCallback, randomBytes } from './sign'
import { show } from './feed'
import {
  BIN,
  INITIAL_LOGIN,
  LOGIN_WINDOW_MS,
} from './state'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const login = atom({ plugin: 'devnull', key: 'login' } as const, INITIAL_LOGIN)

export type Pending = { verifier: string; state: string; startedAt: number }

let poller: Timer | undefined

export const stopPolling = () => {
  poller?.cancel()
  poller = undefined
}

export async function finish($: EngineInterface, url: string): Promise<string> {
  stopPolling()
  const pending = (await $.store.get('pending')) as Pending | undefined
  const answer = parseCallback(url)
  const fail = async (message: string) => {
    await $.store.delete('pending')
    await update($, login, (): Login => ({ status: 'failed', message }))
    return message
  }
  if (!pending) return fail('No sign-in under way. Run /devnull login first.')
  if (answer.state !== pending.state) return fail('That link is for another sign-in. Run /devnull login again.')
  if (answer.error || !answer.code) return fail(`dev-null.sh said: ${answer.error ?? 'no code'}`)

  try {
    const json = (await api($, 'POST', 'devices', {}, { code: answer.code, code_verifier: pending.verifier })) as { data?: { username?: string } }
    const username = json.data?.username ?? '?'
    await $.store.delete('pending')
    await $.store.set('username', username)
    await update($, login, (): Login => ({ status: 'signed-in', username }))
    $.ui.toast(`/dev/null: signed in as @${username}`)
    await show($, 'following')
    return `Signed in to dev-null.sh as @${username}.`
  } catch (error) {
    return fail(`Sign-in failed: ${(error as Error).message}`)
  }
}

export function poll($: EngineInterface, pending: Pending) {
  stopPolling()
  poller = $.clock.every(1500, () => {
    void (async () => {
      const p = await paths($)
      if (await $.fs.exists(p.callback)) {
        const url = await $.fs.read(p.callback)
        await run($, [BIN.rm, '-f', p.callback])
        // A callback for some other sign-in (an old tab, or a link a page opened) is dropped, and this one waits on.
        if (parseCallback(url).state !== pending.state) return
        await finish($, url)
      } else if (Date.now() - pending.startedAt > LOGIN_WINDOW_MS) {
        stopPolling()
        await $.store.delete('pending')
        await update($, login, (): Login => ({ status: 'failed', message: 'Sign-in timed out. Run /devnull login again.' }))
      }
    })()
  })
}

export async function startLogin($: EngineInterface): Promise<string> {
  const p = await paths($)
  await ensureKey($, p)
  await ensureHandler($, p)
  await run($, [BIN.rm, '-f', p.callback])

  const verifier = base64Url(randomBytes(32))
  const pending: Pending = { verifier, state: base64Url(randomBytes(16)), startedAt: Date.now() }
  await $.store.set('pending', pending)
  const fingerprint = fingerprintOf(await run($, [BIN.sshKeygen, '-lf', `${p.key}.pub`]))
  const url = authorizeUrl({ fingerprint, deviceName: 'Claude Code', challenge: await challenge(verifier), state: pending.state })

  await update($, login, (): Login => ({ status: 'waiting' }))
  await run($, [BIN.open, url])
  poll($, pending)

  return [
    'Opened dev-null.sh in your browser. Approve this device there and the pane signs in by itself.',
    'If nothing happens after Approve, paste the devnull://auth/callback… link: /devnull login <link>',
  ].join('\n')
}

export async function logout($: EngineInterface): Promise<string> {
  stopPolling()
  await $.store.delete('username')
  await $.store.delete('pending')
  await update($, login, (): Login => ({ status: 'signed-out' }))
  await show($, 'following')
  return 'Signed out here. The device key stays in ~/.devnull-claude; remove the device on dev-null.sh to revoke it.'
}

// The store holds who this device is signed in as; the pane's state follows it.
export async function syncLogin($: EngineInterface): Promise<void> {
  const username = (await $.store.get('username')) as string | undefined
  await update($, login, (l): Login => (l.status === 'waiting' ? l : username ? { status: 'signed-in', username } : { status: 'signed-out' }))
}


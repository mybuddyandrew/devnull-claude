// The post band above the prompt: every post waits here for a Post press. Drafts come from work shipped in
// this session (git commit, gh pr create), from /devnull draft (a summary of the session), or from
// /devnull post (text you typed).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Ship } from '../types'
import { mentionsIn } from './devnull'
import { aim, draftInComposer, postCommit, refresh } from './feed'
import { DANGER, INITIAL_SHIP, MUTED } from './state'

const ship = atom({ plugin: 'devnull', key: 'ship' } as const, INITIAL_SHIP)

const POSTED_MS = 8000
const MAX_CHARS = 4000

const STYLE = 'Plain text, under 280 characters, first person, casual dev voice, no hashtags, no emojis unless natural, no quotes around it. Reply with the post text only.'
const SHIPPED_ASK = `Write ONE post for /dev/null, a small social network for developers, about what I just shipped and why, based on this session. ${STYLE}`
const SESSION_ASK = `Write ONE post for /dev/null, a small social network for developers, summing up what I've been working on in this session: what it is and what's interesting about it. ${STYLE}`

// What the post link points at, for the "Posted" line; cosmetic, so a hot reload may drop it.
let postedUrl: string | undefined
let postedTimer: { cancel: () => void } | undefined

function clean(text: string): string {
  let t = text.trim()
  const pairs: [string, string][] = [['"', '"'], ["'", "'"], ['`', '`'], ['“', '”']]
  for (const [a, b] of pairs) if (t.length > 1 && t.startsWith(a) && t.endsWith(b)) t = t.slice(1, -1).trim()
  return t.slice(0, MAX_CHARS)
}

// Pulls the shipped thing out of a finished Bash call, or undefined when it shipped nothing.
async function sourceOf($: EngineInterface, command: string, ran: { text?: string; result?: unknown }): Promise<string | undefined> {
  const result = (ran.result ?? {}) as { backgroundTaskId?: unknown }
  if (result.backgroundTaskId !== undefined) return undefined
  if (/(^|[;&|(\s])git\s+(?:-[^\s]+\s+)*commit\b/.test(command) && !/--dry-run/.test(command)) {
    const r = await $.process.run(['git', 'log', '-1', '--pretty=%s'])
    const subject = r.stdout.trim()
    return r.exitCode === 0 && subject ? subject : undefined
  }
  if (/(^|[;&|(\s])gh\s+pr\s+create\b/.test(command)) return /https:\/\/\S+\/pull\/\d+/.exec(ran.text ?? '')?.[0]
  return undefined
}

// Asks the model for a draft: a question over this session's conversation, or a small model on the prompt alone.
async function draft($: EngineInterface, kind: 'ship' | 'session', source: string, prompt: string): Promise<void> {
  const now = await read($, ship)
  if (now.status === 'drafting' || now.status === 'posting' || (now.status === 'ready' && now.source === source && now.kind === kind)) return
  await update($, ship, (s): Ship => ({ status: 'drafting', kind, source, round: s.round }))
  let text: string | undefined
  let reason = 'no reply'
  try {
    const r = await $.model.fork({ prompt })
    if (r.isAnswered && r.text.trim()) text = clean(r.text)
    else if (!r.isAnswered) reason = r.reason
  } catch (error) {
    reason = (error as Error).message
  }
  if (!text) {
    try {
      const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 200, timeoutMs: 20000 })
      if (r.isAnswered && r.text.trim()) text = clean(r.text)
      else if (!r.isAnswered) reason = `${reason}; ${r.reason}`
    } catch (error) {
      reason = `${reason}; ${(error as Error).message}`
    }
  }
  // A dismissal or a newer draft while the model worked wins.
  const after = await read($, ship)
  if (after.status !== 'drafting' || after.source !== source) return
  if (!text) await update($, ship, (s): Ship => ({ status: 'failed', kind, source, error: `Could not draft a post (${reason})`, round: s.round }))
  else await update($, ship, (s): Ship => ({ status: 'ready', kind, source, draft: text, round: s.round }))
}

// /devnull draft [hint]: Claude sums up this session as a post, for you to confirm in the band.
export async function draftFromSession($: EngineInterface, hint: string): Promise<void> {
  const focus = hint.trim()
  await draft($, 'session', focus ? `this session: ${focus}` : 'this session', focus ? `${SESSION_ASK}\n\nFocus on: ${focus}` : SESSION_ASK)
}

// /devnull post <text>: text you typed, offered in the band; nothing is posted until you press Post.
export async function offerPost($: EngineInterface, text: string, to?: Ship['to']): Promise<void> {
  const source = to ? `${to.mode === 'reply' ? 'Reply to' : 'Quote of'} @${to.handle ?? 'commit'}` : 'Your post'
  await update($, ship, (s): Ship => ({ status: 'ready', kind: 'typed', source, draft: text.slice(0, MAX_CHARS), round: s.round + 1, ...(to ? { to } : {}) }))
}

async function dismiss($: EngineInterface): Promise<void> {
  postedTimer?.cancel()
  postedTimer = undefined
  postedUrl = undefined
  await update($, ship, (s): Ship => ({ status: 'idle', round: s.round + 1 }))
}

async function post($: EngineInterface): Promise<void> {
  const now = await read($, ship)
  if (now.status !== 'ready' || !now.draft) return
  const body = now.draft
  const to = now.to
  await update($, ship, (s): Ship => ({ ...s, status: 'posting', error: undefined }))
  try {
    const row = await postCommit($, body, {
      parentId: to?.mode === 'reply' ? to.id : undefined,
      quotedId: to?.mode === 'quote' ? to.id : undefined,
    })
    postedUrl = row.url
    await update($, ship, (s): Ship => ({ status: 'posted', kind: s.kind, source: s.source, round: s.round + 1 }))
    // The reply or quote is done: the composer goes back to a new commit.
    if (to) await aim($, 'new')
    $.ui.toast(to?.mode === 'reply' ? '/dev/null: replied' : to?.mode === 'quote' ? '/dev/null: quoted' : '/dev/null: posted')
    $.audio.play({ asset: 'assets/shipped.wav' }).catch(() => {})
    postedTimer?.cancel()
    postedTimer = $.clock.after(POSTED_MS, () => void dismiss($))
    void refresh($).catch(() => {})
  } catch (error) {
    await update($, ship, (s): Ship => ({ ...s, status: 'failed', draft: body, error: (error as Error).message }))
  }
}

// Sends the draft back to the prompt box as /devnull post <draft>, aimed where it was, to change and send again.
async function edit($: EngineInterface): Promise<void> {
  const now = await read($, ship)
  if (!now.draft) return
  const to = now.to
  await draftInComposer($, now.draft, to ? { mode: to.mode, targetId: to.id, targetHandle: to.handle } : {})
  await dismiss($)
}

export function registerShip(on: On, options: Readonly<Record<string, unknown>>): void {
  const isEnabled = options.autoShip !== false

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!isEnabled || ran.deny !== undefined || ran.isError === true) return ran
    const command = e.command
    if (typeof command !== 'string') return ran
    // Drafting runs on its own so the Bash call is not held up.
    void (async () => {
      try {
        if (!(await $.store.get('username'))) return
        const source = await sourceOf($, command, ran)
        if (source) await draft($, 'ship', source, `${SHIPPED_ASK}\n\nWhat I shipped: ${source}`)
      } catch {
        // A post draft is a nicety: never let it surface as a tool error.
      }
    })()
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, ship)
    if (s.status === 'idle') return next(e)
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const source = s.source ? s.source.slice(0, 80) : ''
    const question = s.kind === 'typed' ? (s.to ? `${source}?` : 'Post this to /dev/null?') : s.kind === 'session' ? 'Post this to /dev/null?' : 'Ship it to /dev/null?'

    const dismissButton = <Button key="ship-dismiss" plain dimColor label="Dismiss" onPress={() => dismiss($)} />

    let body
    if (s.status === 'drafting') {
      body = <Text color={MUTED}>{`Drafting a post about ${source}…`}</Text>
    } else if (s.status === 'posting') {
      body = <Text color={MUTED}>Posting…</Text>
    } else if (s.status === 'posted') {
      body = (
        <Box flexDirection="row" columnGap={2}>
          <Text>Posted to /dev/null</Text>
          {postedUrl ? <Link href={postedUrl} label="View" /> : null}
        </Box>
      )
    } else if (s.status === 'failed') {
      body = (
        <Box flexDirection="column">
          <Text color={DANGER}>{s.error ?? 'Could not post'}</Text>
          <Box flexDirection="row" columnGap={2}>
            {s.draft ? <Button key="ship-edit" label="Edit" onPress={() => edit($)} /> : null}
            {dismissButton}
          </Box>
        </Box>
      )
    } else {
      body = (
        <Box flexDirection="column">
          <Text weight="semibold">{question}</Text>
          {s.kind !== 'typed' && source ? <Text color={MUTED}>{source}</Text> : null}
          <Text>{s.draft ?? ''}</Text>
          {mentionsIn(s.draft ?? '').length > 0 && (
            <Text color={MUTED}>{`Tagging ${mentionsIn(s.draft ?? '').map(h => `@${h}`).join(', ')}`}</Text>
          )}
          <Box flexDirection="row" columnGap={2} paddingTop={1}>
            <Button key="ship-post" variant="primary" hotkey="p" label={s.to?.mode === 'reply' ? 'Reply' : s.to?.mode === 'quote' ? 'Quote' : 'Post'} onPress={() => post($)} />
            <Button key="ship-edit" label="Edit" onPress={() => edit($)} />
            {dismissButton}
          </Box>
        </Box>
      )
    }

    return (
      <Box key={`ship-${s.round}`} flexDirection="column" width={e.props.bodyColumns} paddingX={1}>
        {body}
      </Box>
    )
  })
}

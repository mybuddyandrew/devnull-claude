// Ship-to-/dev/null: work shipped in this session becomes a ready-to-post draft in the band above the prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Ship } from '../types'
import { draftInComposer, postCommit, refresh } from './feed'
import { openPane } from './pane'
import { DANGER, INITIAL_SHIP, MUTED } from './state'

const ship = atom({ plugin: 'devnull', key: 'ship' } as const, INITIAL_SHIP)

const POSTED_MS = 8000
const MAX_CHARS = 4000

const ASK = [
  'Write ONE post for /dev/null, a small social network for developers, about what I just shipped and why, based on this session.',
  'Plain text, under 280 characters, first person, casual dev voice, no hashtags, no emojis unless natural, no quotes around it.',
  'Reply with the post text only.',
].join(' ')

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

async function draft($: EngineInterface, source: string): Promise<void> {
  const now = await read($, ship)
  if (now.status === 'drafting' || now.status === 'posting' || (now.status === 'ready' && now.source === source)) return
  await update($, ship, (s): Ship => ({ status: 'drafting', source, round: s.round }))
  const prompt = `${ASK}\n\nWhat I shipped: ${source}`
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
  // A dismissal or a newer ship while the model worked wins.
  const after = await read($, ship)
  if (after.status !== 'drafting' || after.source !== source) return
  if (!text) await update($, ship, (s): Ship => ({ status: 'failed', source, error: `Could not draft a post (${reason})`, round: s.round }))
  else await update($, ship, (s): Ship => ({ status: 'ready', source, draft: text, round: s.round }))
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
  await update($, ship, (s): Ship => ({ ...s, status: 'posting', error: undefined }))
  try {
    const row = await postCommit($, body)
    postedUrl = row.url
    await update($, ship, (s): Ship => ({ status: 'posted', source: s.source, round: s.round + 1 }))
    await $.ui.toast('/dev/null: posted')
    $.audio.play({ asset: 'assets/shipped.wav' }).catch(() => {})
    postedTimer?.cancel()
    postedTimer = $.clock.after(POSTED_MS, () => void dismiss($))
    void refresh($)
  } catch (error) {
    await update($, ship, (s): Ship => ({ status: 'failed', source: s.source, draft: body, error: (error as Error).message, round: s.round }))
  }
}

async function edit($: EngineInterface): Promise<void> {
  const now = await read($, ship)
  if (!now.draft) return
  await draftInComposer($, now.draft)
  await openPane($)
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
        if (source) await draft($, source)
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
          <Box flexDirection="row">{dismissButton}</Box>
        </Box>
      )
    } else {
      body = (
        <Box flexDirection="column">
          <Text>Ship it to /dev/null?</Text>
          <Text color={MUTED}>{source}</Text>
          <Text>{s.draft ?? ''}</Text>
          <Box flexDirection="row" columnGap={2}>
            <Button key="ship-post" variant="primary" hotkey="p" label="Post" onPress={() => post($)} />
            <Button key="ship-edit" label="Edit in pane" onPress={() => edit($)} />
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

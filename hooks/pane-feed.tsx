// The log and notifications: the composer, the drawn window of rows, and its loaders.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CommitRow } from '../types'
import { aim, composeInPrompt } from './feed'
import { setLive } from './me'
import type { DrawCommit } from './pane-commit'
import type { Kit } from './pane-kit'
import type { Top } from './pane-top'
import { refreshToTop, slide } from './pane-scroll'
import { openProfile } from './profile'
import { NOTE_KINDS } from './rows'
import { offerFromPrompt } from './ship'
import {
  DANGER,
  HAIRLINE,
  INITIAL_COMPOSE,
  INITIAL_FEED,
  INITIAL_LIVE,
  INITIAL_PULL,
  INITIAL_TAB,
  INITIAL_WINDOW_START,
  MAX_DRAWN,
  MUTED,
  PRIMARY,
  PULL_TICKS,
  STAR,
} from './state'
import { ago } from './text'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const compose = atom({ plugin: 'devnull', key: 'compose' } as const, INITIAL_COMPOSE)
const feed = atom({ plugin: 'devnull', key: 'feed' } as const, INITIAL_FEED)
const live = atom({ plugin: 'devnull', key: 'live' } as const, INITIAL_LIVE)
const pull = atom({ plugin: 'devnull', key: 'pull' } as const, INITIAL_PULL)
const tab = atom({ plugin: 'devnull', key: 'tab' } as const, INITIAL_TAB)
const windowStart = atom({ plugin: 'devnull', key: 'windowStart' } as const, INITIAL_WINDOW_START)

// What is typed in the pane's field so far, handed back as its value on every draw so a redraw (a poll, an
// avatar, a star) never empties it. Kept here rather than in $.state: a write per key would redraw the pane per
// key. A new round (the post offered) starts the field empty.
let typed = { round: -1, text: '' }

export async function drawFeed($: EngineInterface, kit: Kit, top: Top, commit: DrawCommit) {
  const { Box, Text, Button } = kit.els
  const { Input, busy, now, progressBar, ring, skeletons } = kit
  const { header, tabs } = top
  const showing = await read($, tab)
  const f = await read($, feed)
  const draft = await read($, compose)
  const fresh = await read($, live)
  const pulled = await read($, pull)
  const from = await read($, windowStart)

  const targetLabel = draft.mode === 'reply' ? `Replying to @${draft.targetHandle}` : draft.mode === 'quote' ? `Quoting @${draft.targetHandle}` : undefined
  // The composer: a quick one-line field here, and Claude's prompt box for anything longer (the pane's
  // field can't be made wider or multi-line on the desktop; the prompt box is both). Either way the post
  // waits above the prompt for Post.
  const composer = (
    <Box flexDirection="column" width="100%" borderStyle="round" borderColor={draft.mode === 'new' ? HAIRLINE : PRIMARY} paddingX={1} paddingY={1} marginBottom={1}>
      {targetLabel && (
        <Box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
          <Text color={PRIMARY}>{targetLabel}</Text>
          <Button key="compose-cancel" plain dimColor label="Cancel" onPress={() => void aim($, 'new')} />
        </Box>
      )}
      <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" columnGap={2} rowGap={1}>
        {Input ? (
          <Input
            key={`compose-${draft.round}`}
            value={typed.round === draft.round ? typed.text : ''}
            onInput={(value: string) => {
              typed = { round: draft.round, text: value }
            }}
            placeholder={draft.mode === 'reply' ? 'Write your reply' : draft.mode === 'quote' ? 'Add your take' : "What's on your mind?"}
            submitLabel={draft.mode === 'reply' ? 'Reply' : draft.mode === 'quote' ? 'Quote' : 'Commit'}
            onSubmit={(value: string) => {
              void (async () => {
                const said = await offerFromPrompt($, value)
                // Offered: the field clears and the post waits above the prompt; otherwise say why.
                if (said.startsWith('Ready')) await update($, compose, c => ({ ...c, round: c.round + 1 }))
                else $.ui.toast(`/dev/null: ${said}`)
              })()
            }}
          />
        ) : (
          <Text color={MUTED}>{draft.mode === 'reply' ? 'Write your reply…' : draft.mode === 'quote' ? 'Add your take…' : "What's on your mind?"}</Text>
        )}
        <Button key="compose-open" plain dimColor label="✎ Write in prompt box" onPress={() => void composeInPrompt($)} />
      </Box>
    </Box>
  )

  const note = (n: (typeof f.notifications)[number]) => {
    const kind = NOTE_KINDS[n.type]
    return (
      <Box key={`n-${n.id}`} flexDirection="row" columnGap={2} paddingY={1}>
        <Box flexShrink={0}>{ring(n.lane, n.actor, 36)}</Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1}>
            {n.isUnread && <Text color={PRIMARY}>●</Text>}
            <Text color={n.type === 'starred' ? STAR : n.lane}>{kind?.glyph ?? '•'}</Text>
            <Button key={`actor-${n.id}`} plain label={`@${n.actor}`} onPress={() => void openProfile($, n.actor)} />
            <Text>
              {n.others > 0 ? `and ${n.others} ${n.others === 1 ? 'other' : 'others'} ` : ''}
              {kind?.verb ?? n.type}
              <Text color={MUTED}> · {ago(n.createdAt, now)}</Text>
            </Text>
          </Box>
          {n.excerpt && (
            <Text color={MUTED} wrap="truncate-end">
              {n.excerpt}
            </Text>
          )}
        </Box>
      </Box>
    )
  }

  const isEmpty = showing === 'notifications' ? f.notifications.length === 0 : f.commits.length === 0
  // Only a window of the loaded rows is drawn, so the drawing stays a fixed size however far you scroll.
  const rows: readonly { id: string }[] = showing === 'notifications' ? f.notifications : f.commits
  const start = Math.max(0, Math.min(from, rows.length - MAX_DRAWN))
  const drawn = rows.slice(start, start + MAX_DRAWN)
  const showNew = fresh.newCount > 0 && (showing === 'following' || showing === 'latest')
  return (
    <Box flexDirection="column">
      {pulled > 0 && (
        <Box flexDirection="row" justifyContent="center" paddingBottom={1}>
          <Text color={PRIMARY}>
            {pulled >= PULL_TICKS ? '↻ Refreshing…' : `↻ Keep scrolling up to refresh ${'●'.repeat(pulled)}${'○'.repeat(PULL_TICKS - pulled)}`}
          </Text>
        </Box>
      )}
      {header}
      {tabs}
      {showing !== 'notifications' && composer}
      {showNew && (
        <Box flexDirection="row" justifyContent="center" paddingBottom={1}>
          <Button
            key="new-commits"
            variant="primary"
            label={`↑ ${fresh.newCount} new ${fresh.newCount === 1 ? 'commit' : 'commits'}`}
            onPress={() => {
              void (async () => {
                await setLive($, { newCount: 0 })
                await refreshToTop($)
              })()
            }}
          />
        </Box>
      )}
      {f.error && <Text color={DANGER}>Couldn't load: {f.error}</Text>}
      {f.isLoading && !f.isLoadingMore && !isEmpty && progressBar('feed-progress')}
      {f.isLoading && isEmpty && skeletons('feed', showing === 'notifications' ? 6 : 4, showing === 'notifications' ? 36 : 44)}
      {isEmpty && !f.isLoading && !f.error && (
        <Text color={MUTED}>
          {showing === 'notifications' ? 'No notifications yet.' : showing === 'following' ? 'Nobody you follow has committed yet. Try Latest.' : 'Nothing here yet.'}
        </Text>
      )}
      {start > 0 && (
        <Box flexDirection="row" justifyContent="center" paddingBottom={1}>
          <Button key="newer" label={`↑ Newer ${showing === 'notifications' ? 'notifications' : 'commits'}`} onPress={() => void slide($, -1)} />
        </Box>
      )}
      {showing === 'notifications' ? (drawn as typeof f.notifications).map(note) : (drawn as CommitRow[]).map(c => commit(c, 0))}
      {(start + MAX_DRAWN < rows.length || f.nextCursor) && !isEmpty && (
        <Box flexDirection="row" justifyContent="center" paddingY={1}>
          {f.isLoadingMore ? busy('loading-more', 'Loading more') : <Button key="more" label="Load more" onPress={() => void slide($, 1)} />}
        </Box>
      )}
    </Box>
  )
}

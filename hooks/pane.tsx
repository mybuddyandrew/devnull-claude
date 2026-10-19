// The /dev/null pane: tabs, composer, the commit list and notifications.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderInput } from 'claude-code'

import type { CommitRow, Live } from '../types'
import { NOTE_KINDS, TAIL_HEIGHT, ago, avatarSvg, preview, tailSvg, underlineSvg } from './devnull'
import { aim, react, refresh, show, startInPrompt } from './feed'
import { startLogin, syncLogin } from './login'
import { heatmapSvg } from './streaks'
import {
  AVATAR_BUDGET_CHARS,
  AVATAR_MAX_CHARS,
  DANGER,
  HAIRLINE,
  INITIAL_AVATARS,
  INITIAL_COMPOSE,
  INITIAL_EXPANDED,
  INITIAL_FEED,
  INITIAL_LOGIN,
  INITIAL_LIVE,
  INITIAL_PULL,
  INITIAL_WINDOW_START,
  MAX_DRAWN,
  SLIDE_ROWS,
  LOAD_MORE_ROWS,
  PULL_TICKS,
  INITIAL_STATS,
  INITIAL_TAB,
  LABELS,
  MUTED,
  PANE,
  PRIMARY,
  STAR,
  TABS,
} from './state'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const avatars = atom({ plugin: 'devnull', key: 'avatars' } as const, INITIAL_AVATARS)
const compose = atom({ plugin: 'devnull', key: 'compose' } as const, INITIAL_COMPOSE)
const expanded = atom({ plugin: 'devnull', key: 'expanded' } as const, INITIAL_EXPANDED)
const feed = atom({ plugin: 'devnull', key: 'feed' } as const, INITIAL_FEED)
const login = atom({ plugin: 'devnull', key: 'login' } as const, INITIAL_LOGIN)
const tab = atom({ plugin: 'devnull', key: 'tab' } as const, INITIAL_TAB)
const live = atom({ plugin: 'devnull', key: 'live' } as const, INITIAL_LIVE)
const pull = atom({ plugin: 'devnull', key: 'pull' } as const, INITIAL_PULL)
const windowStart = atom({ plugin: 'devnull', key: 'windowStart' } as const, INITIAL_WINDOW_START)
const stats = atom({ plugin: 'devnull', key: 'stats' } as const, INITIAL_STATS)

export async function openPane($: EngineInterface) {
  await syncLogin($)
  await $.ui.open({ id: PANE, title: '/dev/null' })
  await refresh($)
}

export async function drawPane($: EngineInterface, e: RenderInput) {
    try {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link, Markdown } = els
    // The terminal draws no SVG: it gets a dot where the avatar would be.
    const Svg = 'Svg' in els ? els.Svg : undefined
    const showing = await read($, tab)
    const f = await read($, feed)
    const who = await read($, login)
    const faces = await read($, avatars)
    const draft = await read($, compose)
    const open = await read($, expanded)
    const fresh = await read($, live)
    const pulled = await read($, pull)
    const from = await read($, windowStart)
    const me = await read($, stats)
    const now = Date.now()

    // Photos past the budget fall back to initials, so one draw stays well under what the desktop takes.
    let photoBudget = AVATAR_BUDGET_CHARS
    const ring = (lane: string, username: string, size: number) => {
      if (!Svg) return <Text color={lane}>●</Text>
      const face = faces[username]
      const photo = face && face.length <= AVATAR_MAX_CHARS && face.length <= photoBudget ? face : undefined
      if (photo) photoBudget -= photo.length
      return <Svg source={avatarSvg(lane, size, photo, username)} alt={`@${username}`} width={size} height={size} />
    }

    const tabs = (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingBottom={1}>
        <Box flexDirection="row" columnGap={3}>
          {TABS.map(t => (
            <Box key={`tabbox-${t}`} flexDirection="column" alignItems="center" rowGap={0}>
              <Button key={`tab-${t}`} plain label={t === 'notifications' && fresh.unread > 0 ? `${LABELS[t]} (${fresh.unread})` : LABELS[t]} {...(t === showing ? {} : { dimColor: true as const })} onPress={() => show($, t)} />
              {t === showing && Svg && <Svg source={underlineSvg(LABELS[t].length * 8)} alt="Selected tab" width={LABELS[t].length * 8} height={3} />}
            </Box>
          ))}
        </Box>
        <Button key="refresh" plain dimColor label={f.isLoading ? 'Loading…' : '↻ Refresh'} onPress={() => refreshToTop($)} />
      </Box>
    )

    if (who.status !== 'signed-in') {
      return (
        <Box flexDirection="column" paddingY={2} rowGap={1}>
          <Text size="title" weight="bold">
            /dev/null
          </Text>
          <Text color={MUTED}>a social network for devs</Text>
          {who.status === 'waiting' ? (
            <Text color={MUTED}>Approve this device in your browser, then come back here.</Text>
          ) : (
            <Box flexDirection="row">
              <Button key="sign-in" variant="primary" label="Sign in with GitHub" onPress={() => void startLogin($)} />
            </Box>
          )}
          {who.message && <Text color={DANGER}>{who.message}</Text>}
        </Box>
      )
    }

    const targetLabel = draft.mode === 'reply' ? `Replying to @${draft.targetHandle}` : draft.mode === 'quote' ? `Quoting @${draft.targetHandle}` : undefined
    // The composer is a full-width box that starts the post in Claude's prompt box: the pane's own text
    // field can't be made wider or multi-line on the desktop, the prompt box is both.
    const composer = (
      <Box flexDirection="column" width="100%" borderStyle="round" borderColor={draft.mode === 'new' ? HAIRLINE : PRIMARY} paddingX={1} paddingY={1} marginBottom={1}>
        {targetLabel && (
          <Box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
            <Text color={PRIMARY}>{targetLabel}</Text>
            <Button key="compose-cancel" plain dimColor label="Cancel" onPress={() => aim($, 'new')} />
          </Box>
        )}
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Button
            key="compose-open"
            plain
            dimColor
            label={draft.mode === 'reply' ? 'Write your reply…' : draft.mode === 'quote' ? 'Add your take…' : "What's on your mind?"}
            onPress={() => startInPrompt($)}
          />
          <Button key="compose-go" variant="primary" label={draft.mode === 'reply' ? 'Reply' : draft.mode === 'quote' ? 'Quote' : 'Commit'} onPress={() => startInPrompt($)} />
        </Box>
        {draft.error && <Text color={DANGER}>Not sent: {draft.error}</Text>}
      </Box>
    )

    const commit = (c: CommitRow, depth: number): ReturnType<typeof Box> => {
      const size = depth === 0 ? 44 : 32
      const isOpen = open.includes(c.id)
      const body = preview(c.body)
      return (
      <Box key={`c-${depth}-${c.id}`} flexDirection="row" alignItems="stretch" columnGap={2} paddingTop={depth === 0 ? 2 : 1} paddingBottom={depth === 0 ? 1 : 0}>
        {/* Never shrinks: a wide quote or code block beside it would otherwise squeeze the avatar. */}
        <Box flexDirection="column" alignItems="center" flexShrink={0}>
          {ring(c.lane, c.username, size)}
          {/* The lane fading out under the avatar: the desktop draws any border as a full outline, so no stretched bar. */}
          {Svg && <Svg source={tailSvg(c.lane, size)} alt="Lane" width={size} height={TAIL_HEIGHT} />}
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
            <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={1}>
              <Text size={depth === 0 ? 'heading' : 'body'} weight="semibold" wrap="truncate-end">
                {c.name ?? c.username}
              </Text>
              <Text size="footnote" mono color={MUTED} wrap="truncate-end">
                @{c.username} · {ago(c.createdAt, now)}
              </Text>
            </Box>
            {c.url ? <Link href={c.url} label={c.hash} /> : <Text size="footnote" mono color={MUTED}>{c.hash}</Text>}
          </Box>
          <Markdown key={`b-${depth}-${c.id}`} text={isOpen || !body.isCut ? c.body : body.text} />
          {body.isCut && (
            <Box flexDirection="row">
              <Button
                key={`more-${depth}-${c.id}`}
                plain
                label={isOpen ? 'Show less' : 'Show more'}
                onPress={() => update($, expanded, ids => (isOpen ? ids.filter(id => id !== c.id) : [...ids, c.id]))}
              />
            </Box>
          )}
          {c.quoted && (
            <Box flexDirection="column" borderStyle="round" borderColor={HAIRLINE} paddingX={1} marginTop={1}>
              <Text wrap="truncate-end">
                <Text color={c.quoted.lane}>● </Text>
                <Text bold>{c.quoted.name ?? c.quoted.username}</Text> <Text mono color={MUTED}>@{c.quoted.username}</Text>
              </Text>
              <Text color={MUTED} wrap="wrap">
                {c.quoted.body.length > 280 ? c.quoted.body.slice(0, 280) + '…' : c.quoted.body}
              </Text>
            </Box>
          )}
          {c.images > 0 && c.url && <Link href={c.url} label={c.images === 1 ? 'View image' : `View ${c.images} images`} />}
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingTop={1}>
            <Box flexDirection="row" columnGap={4}>
              <Button
                key={`star-${depth}-${c.id}`}
                plain
                {...(c.isStarred ? {} : { dimColor: true as const })}
                label={`${c.isStarred ? '★' : '☆'}${c.stars > 0 ? ` ${c.stars}` : ''}`}
                onPress={() => react($, c, 'star')}
              />
              {depth === 0 && <Button key={`quote-${c.id}`} plain dimColor label="❝ Quote" onPress={() => aim($, 'quote', c)} />}
              <Button key={`reply-${depth}-${c.id}`} plain dimColor label={`↩ Reply${c.replies > 0 ? ` ${c.replies}` : ''}`} onPress={() => aim($, 'reply', c)} />
            </Box>
            <Button
              key={`save-${depth}-${c.id}`}
              plain
              {...(c.isSaved ? {} : { dimColor: true as const })}
              label={c.isSaved ? '■ Saved' : '□ Save'}
              onPress={() => react($, c, 'save')}
            />
          </Box>
          {c.replyPreview.map(r => commit(r, depth + 1))}
        </Box>
      </Box>
      )
    }

    const note = (n: (typeof f.notifications)[number]) => {
      const kind = NOTE_KINDS[n.type]
      return (
        <Box key={`n-${n.id}`} flexDirection="row" columnGap={2} paddingY={1}>
          <Box flexShrink={0}>{ring(n.lane, n.actor, 36)}</Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text wrap="wrap">
              {n.isUnread && <Text color={PRIMARY}>● </Text>}
              <Text color={n.type === 'starred' ? STAR : n.lane}>{kind?.glyph ?? '•'} </Text>
              <Text weight="semibold">@{n.actor}</Text>
              {n.others > 0 ? ` and ${n.others} ${n.others === 1 ? 'other' : 'others'}` : ''} {kind?.verb ?? n.type}
              <Text color={MUTED}> · {ago(n.createdAt, now)}</Text>
            </Text>
            {n.excerpt && (
              <Text color={MUTED} wrap="truncate-end">
                {n.excerpt}
              </Text>
            )}
          </Box>
        </Box>
      )
    }

    // Your streak, rank and XP over a heatmap of your commits, as on your dev-null.sh profile.
    const header = me && (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} paddingBottom={1} flexWrap="wrap">
        <Box flexDirection="column">
          <Text>
            <Text bold>{me.streak > 0 ? `🔥 ${me.streak}-day streak` : 'No streak yet'}</Text>
            <Text color={MUTED}> · longest {me.longest}</Text>
          </Text>
          {(me.rank || me.xp !== undefined) && (
            <Text color={MUTED}>
              {[me.rank, me.level !== undefined ? `level ${me.level}` : '', me.xp !== undefined ? `${me.xp.toLocaleString()}${me.nextLevelXp ? ` / ${me.nextLevelXp.toLocaleString()}` : ''} XP` : '']
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )}
        </Box>
        {Svg && me.buckets.length > 0 && (() => {
          const map = heatmapSvg(me, PRIMARY)
          return <Svg source={map.source} alt={`Your commits over the last ${me.scale}`} width={map.width} height={map.height} />
        })()}
      </Box>
    )

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
              onPress={async () => {
                await update($, live, (l): Live => ({ ...l, newCount: 0 }))
                await refreshToTop($)
              }}
            />
          </Box>
        )}
        {f.error && <Text color={DANGER}>Couldn't load: {f.error}</Text>}
        {isEmpty && !f.isLoading && !f.error && (
          <Text color={MUTED}>
            {showing === 'notifications' ? 'No notifications yet.' : showing === 'following' ? 'Nobody you follow has committed yet. Try Latest.' : 'Nothing here yet.'}
          </Text>
        )}
        {start > 0 && (
          <Box flexDirection="row" justifyContent="center" paddingBottom={1}>
            <Button key="newer" label={`↑ Newer ${showing === 'notifications' ? 'notifications' : 'commits'}`} onPress={() => slide($, -1)} />
          </Box>
        )}
        {showing === 'notifications' ? (drawn as typeof f.notifications).map(note) : (drawn as CommitRow[]).map(c => commit(c, 0))}
        {(start + MAX_DRAWN < rows.length || f.nextCursor) && !isEmpty && (
          <Box flexDirection="row" justifyContent="center" paddingY={1}>
            {f.isLoading ? <Text color={MUTED}>Loading more…</Text> : <Button key="more" label="Load more" onPress={() => slide($, 1)} />}
          </Box>
        )}
      </Box>
    )
    } catch (error) {
      // Drawn as text so a failure shows its reason instead of an empty pane.
      const { Text } = $.ui.resolve(e)
      return <Text color={DANGER}>/dev/null couldn't draw this: {String((error as Error)?.message ?? error)}</Text>
    }
}

// Draws the pane; register.tsx hands this file its `on`.
export function registerPane(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawPane($, e))

  // Infinite scroll near the bottom, and pull to refresh: wheel up past the top a few times in a row.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (e.origin.kind !== 'person') return moved
    const now = await $.clock.now()
    if (e.by < 0 && e.offset === 0 && (await read($, windowStart)) > 0) {
      // Deep in the list, the top of the pane is only the top of the drawn window: bring back newer rows.
      await slide($, -1)
      return moved
    }
    if (e.by < 0 && e.offset === 0) {
      const ticks = now - lastPullAt > PULL_WINDOW_MS ? 1 : (await read($, pull)) + 1
      lastPullAt = now
      if (ticks >= PULL_TICKS) {
        await update($, pull, () => PULL_TICKS)
        await refreshToTop($)
        await update($, pull, () => 0)
      } else {
        await update($, pull, () => ticks)
        $.clock.after(PULL_WINDOW_MS, () => {
          void (async () => {
            if ((await $.clock.now()) - lastPullAt >= PULL_WINDOW_MS) await update($, pull, () => 0)
          })()
        })
      }
      return moved
    }
    if (e.by > 0) {
      if ((await read($, pull)) > 0) await update($, pull, () => 0)
      const f = await read($, feed)
      if (!f.isLoading && e.offset + e.bodyRows >= e.contentRows - LOAD_MORE_ROWS) void slide($, 1)
    }
    return moved
  })
}

// Pull ticks further apart than this start over.
const PULL_WINDOW_MS = 1500
let lastPullAt = 0

// The key each drawn row's Box carries, for scrolling a row back into view after the window moves.
const rowKey = (isNote: boolean, id: string) => (isNote ? `n-${id}` : `c-0-${id}`)

// Moves the drawn window a step down the list (1) or back up (-1), loading the next page when the
// window reaches the end of what's loaded. The row that was at the window's edge is scrolled back
// to the same edge, so the view doesn't jump when rows leave the other end.
async function slide($: EngineInterface, direction: 1 | -1): Promise<void> {
  const isNote = (await read($, tab)) === 'notifications'
  let f = await read($, feed)
  const list = () => (isNote ? f.notifications : f.commits) as readonly { id: string }[]
  const from = Math.max(0, Math.min(await read($, windowStart), list().length - MAX_DRAWN))
  if (direction === 1) {
    if (from + MAX_DRAWN >= list().length) {
      if (!f.nextCursor || f.isLoading) return
      await refresh($, true)
      f = await read($, feed)
      // The first page or two fit whole; the window only slides once there's more than it draws.
      if (list().length <= MAX_DRAWN) return
    }
    const anchor = list()[Math.min(from + MAX_DRAWN, list().length) - 1]?.id
    const next = Math.min(from + SLIDE_ROWS, Math.max(0, list().length - MAX_DRAWN))
    if (next === from) return
    await update($, windowStart, () => next)
    if (anchor) keepInView($, rowKey(isNote, anchor), 'end')
  } else {
    const anchor = list()[from]?.id
    await update($, windowStart, () => Math.max(0, from - SLIDE_ROWS))
    if (anchor) keepInView($, rowKey(isNote, anchor), 'start')
  }
}

// After the redraw lands, scroll the anchor row back to the edge it was on.
function keepInView($: EngineInterface, key: string, block: 'start' | 'end'): void {
  $.clock.after(120, () => {
    void $.ui.scroll({ to: { key }, in: PANE, block }).catch(() => {})
  })
}

// Reloads the shown list from its newest row and puts the pane back at its top.
async function refreshToTop($: EngineInterface): Promise<void> {
  await refresh($)
  $.clock.after(120, () => {
    void $.ui.scroll({ to: 'start', in: PANE }).catch(() => {})
  })
}

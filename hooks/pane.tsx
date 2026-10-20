// The /dev/null pane: tabs, composer, the commit list and notifications.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderInput } from 'claude-code'

import type { CommitRow, ConversationRow, InboxSection, Live, MessageRow } from '../types'
import { NOTE_KINDS } from './rows'
import { avatarSvg, pictureSvg, progressSvg, skeletonSvg, spinnerSvg, TAIL_HEIGHT, tailSvg, underlineSvg } from './svg'
import { ago, handleFromHref, linkMentions, MENTION_HREF, mentionsIn, preview } from './text'
import { aim, offerFromPrompt, react, refresh, show, startInPrompt } from './feed'
import { startLogin, syncLogin } from './login'
import { closeProfile, openProfile, toggleFollow } from './profile'
import { answerRequest, checkRemotes, closeThread, loadInbox, openThread, pingTyping, retryMessage, setStashed, toggleReaction } from './remotes'
import { toggleReplies } from './replies'
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
  INITIAL_INBOX,
  INITIAL_OPEN_REPLIES,
  INITIAL_PICTURES,
  MAX_INLINE_REPLIES,
  INITIAL_THREAD,
  INITIAL_PROFILE,
  PICTURE_BUDGET_CHARS,
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
const profile = atom({ plugin: 'devnull', key: 'profile' } as const, INITIAL_PROFILE)
const pictures = atom({ plugin: 'devnull', key: 'pictures' } as const, INITIAL_PICTURES)
const inbox = atom({ plugin: 'devnull', key: 'inbox' } as const, INITIAL_INBOX)
const openReplies = atom({ plugin: 'devnull', key: 'openReplies' } as const, INITIAL_OPEN_REPLIES)
const thread = atom({ plugin: 'devnull', key: 'thread' } as const, INITIAL_THREAD)
const stats = atom({ plugin: 'devnull', key: 'stats' } as const, INITIAL_STATS)

export async function openPane($: EngineInterface) {
  await syncLogin($)
  await checkRemotes($)
  await $.ui.open({ id: PANE, title: '/dev/null' })
  await refresh($)
}

export async function drawPane($: EngineInterface, e: RenderInput) {
    try {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link, Markdown } = els
    // The terminal draws no SVG: it gets a dot where the avatar would be.
    const Svg = 'Svg' in els ? els.Svg : undefined
    const Input = 'Input' in els ? els.Input : undefined
    const showing = await read($, tab)
    const f = await read($, feed)
    const who = await read($, login)
    const faces = await read($, avatars)
    const draft = await read($, compose)
    const open = await read($, expanded)
    const fresh = await read($, live)
    const pulled = await read($, pull)
    const from = await read($, windowStart)
    const person = await read($, profile)
    const images = await read($, pictures)
    const box = await read($, inbox)
    const threads = await read($, openReplies)
    const chat = await read($, thread)
    const myId = (await $.store.get('userId').catch(() => undefined)) as string | undefined

    // Loaders: skeleton rows the first time a list loads, a sweeping bar while one refreshes over what's
    // shown, and a spinner beside a button. Text stands in where a surface draws no SVG.
    // The pane's width in pixels, from its width in cells (about 7.5px each on the desktop). Every drawing is
    // sized to it, so a narrow docked pane scales its drawings down instead of cutting the content off.
    const paneWidth = Math.max(140, Math.floor(((e.props as { bodyColumns?: number }).bodyColumns ?? 60) * 7.5) - 16)
    // A commit's content sits beside its avatar gutter, so it has a little less room.
    const contentWidth = Math.max(100, paneWidth - 64)
    const fit = (map: { width: number; height: number }, room: number) => {
      const width = Math.min(map.width, room)
      return { width, height: Math.max(1, Math.round((map.height * width) / map.width)) }
    }
    const loaderWidth = Math.min(640, paneWidth)
    const skeletons = (n: number, avatar = 40) =>
      Svg
        ? Array.from({ length: n }, (_, i) => {
            const sk = skeletonSvg(loaderWidth, avatar)
            return (
              <Box key={`sk-${i}`} paddingY={1}>
                <Svg source={sk.source} alt="Loading" width={sk.width} height={sk.height} isInteractive />
              </Box>
            )
          })
        : [<Text key="sk-text" color={MUTED}>Loading…</Text>]
    const progressBar = (key: string) => {
      if (!Svg) return null
      const bar = progressSvg(loaderWidth, PRIMARY)
      return (
        <Box key={key} paddingBottom={1}>
          <Svg source={bar.source} alt="Refreshing" width={bar.width} height={bar.height} isInteractive />
        </Box>
      )
    }
    const busy = (key: string, label: string) => (
      <Box key={key} flexDirection="row" alignItems="center" columnGap={1}>
        {Svg && <Svg source={spinnerSvg(14, MUTED)} alt="Loading" width={14} height={14} isInteractive />}
        <Text color={MUTED}>{label}</Text>
      </Box>
    )
    const me = await read($, stats)
    const now = Date.now()

    // Photos past the budget fall back to initials, so one draw stays well under what the desktop takes.
    let photoBudget = AVATAR_BUDGET_CHARS
    // Commit images have a budget of their own; past it, a commit shows a link instead.
    let pictureBudget = PICTURE_BUDGET_CHARS
    const ring = (lane: string, username: string, size: number) => {
      if (!Svg) return <Text color={lane}>●</Text>
      const face = faces[username]
      const photo = face && face.length <= AVATAR_MAX_CHARS && face.length <= photoBudget ? face : undefined
      if (photo) photoBudget -= photo.length
      return <Svg source={avatarSvg(lane, size, photo, username)} alt={`@${username}`} width={size} height={size} />
    }

    const tabs = (
      <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" rowGap={1} paddingBottom={1}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
          {/* Remotes only shows once dev-null.sh serves it and you have it switched on. */}
          {TABS.filter(t => t !== 'remotes' || fresh.remotesOn || showing === 'remotes').map(t => (
            <Box key={`tabbox-${t}`} flexDirection="column" alignItems="center" rowGap={0}>
              <Button key={`tab-${t}`} plain label={t === 'notifications' && fresh.unread > 0 ? `${LABELS[t]} (${fresh.unread})` : t === 'remotes' && (fresh.remotesUnread ?? 0) > 0 ? `${LABELS[t]} (${fresh.remotesUnread})` : LABELS[t]} {...(t === showing ? {} : { dimColor: true as const })} onPress={() => void show($, t)} />
              {t === showing && Svg && <Svg source={underlineSvg(LABELS[t].length * 8)} alt="Selected tab" width={LABELS[t].length * 8} height={3} />}
            </Box>
          ))}
        </Box>
        {(showing === 'remotes' ? box.isLoading : f.isLoading && !f.isLoadingMore) ? busy('refreshing', 'Refreshing') : <Button key="refresh" plain dimColor label="↻ Refresh" onPress={() => void refreshToTop($)} />}
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
          <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" columnGap={1}>
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} flexShrink={1}>
              <Text size={depth === 0 ? 'heading' : 'body'} weight="semibold" wrap="truncate-end">
                {c.name ?? c.username}
              </Text>
              <Button key={`who-${depth}-${c.id}`} plain dimColor label={`@${c.username}`} onPress={() => void openProfile($, c.username)} />
              <Text size="footnote" color={MUTED}>
                · {ago(c.createdAt, now)}
              </Text>
            </Box>
            {c.url ? <Link href={c.url} label={c.hash} /> : <Text size="footnote" mono color={MUTED}>{c.hash}</Text>}
          </Box>
          {(() => {
            const text = isOpen || !body.isCut ? c.body : body.text
            const tagged = mentionsIn(text).map(h => MENTION_HREF + h)
            // @mentions are links to the person's profile, opened here in the pane rather than the browser.
            return (
              <Markdown
                key={`b-${depth}-${c.id}`}
                text={linkMentions(text)}
                {...(tagged.length > 0
                  ? {
                      pressableLinks: tagged,
                      onLinkPress: (link: { href: string }) => {
                        const handle = handleFromHref(link.href)
                        if (handle) void openProfile($, handle)
                      },
                    }
                  : {})}
              />
            )
          })()}
          {body.isCut && (
            <Box flexDirection="row">
              <Button
                key={`more-${depth}-${c.id}`}
                plain
                label={isOpen ? 'Show less' : 'Show more'}
                onPress={() => void update($, expanded, ids => (isOpen ? ids.filter(id => id !== c.id) : [...ids, c.id]))}
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
          {(() => {
            const first = (c.pictures ?? [])[0]
            const data = first ? images[first.url] : undefined
            if (Svg && first && data && data.length <= pictureBudget) {
              pictureBudget -= data.length
              const pic = pictureSvg(data, first.width, first.height, Math.min(260, contentWidth))
              return (
                <Box flexDirection="column" paddingTop={1}>
                  <Svg source={pic.source} alt={first.alt ?? `Image from @${c.username}`} width={pic.width} height={pic.height} />
                  {c.images > 1 && c.url && <Link href={c.url} label={`+${c.images - 1} more on dev-null.sh`} />}
                </Box>
              )
            }
            return c.images > 0 && c.url ? <Link href={c.url} label={c.images === 1 ? 'View image' : `View ${c.images} images`} /> : null
          })()}
          {c.preview && (() => {
            // The link's card, as dev-null.sh shows it: its image (within the picture budget), site, title and description.
            const card = c.preview
            const thumb = card.imageUrl ? images[card.imageUrl] : undefined
            const hasThumb = Boolean(Svg && thumb && thumb.length <= pictureBudget && contentWidth >= 260)
            if (hasThumb && thumb) pictureBudget -= thumb.length
            const pic = hasThumb && thumb ? pictureSvg(thumb, 120, 90, 120) : undefined
            return (
              <Box key={`card-${depth}-${c.id}`} flexDirection="row" columnGap={2} borderStyle="round" borderColor={HAIRLINE} paddingX={1} marginTop={1}>
                {Svg && pic && (
                  <Box flexShrink={0}>
                    <Svg source={pic.source} alt={card.title ?? 'Link preview'} width={pic.width} height={pic.height} />
                  </Box>
                )}
                <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                  {card.site && (
                    <Text size="footnote" color={MUTED}>
                      {card.site}
                    </Text>
                  )}
                  {card.title && (
                    <Text weight="semibold" wrap="truncate-end">
                      {card.title}
                    </Text>
                  )}
                  {card.description && (
                    <Text color={MUTED} wrap="truncate-end">
                      {card.description}
                    </Text>
                  )}
                  <Link href={card.url} label="Open ↗" />
                </Box>
              </Box>
            )
          })()}
          <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" rowGap={1} paddingTop={1}>
            <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
              <Button
                key={`star-${depth}-${c.id}`}
                plain
                {...(c.isStarred ? {} : { dimColor: true as const })}
                label={`${c.isStarred ? '★' : '☆'}${c.stars > 0 ? ` ${c.stars}` : ''}`}
                onPress={() => void react($, c, 'star')}
              />
              {depth === 0 && <Button key={`quote-${c.id}`} plain dimColor label="❝ Quote" onPress={() => void composeInPrompt($, 'quote', c)} />}
              <Button key={`reply-${depth}-${c.id}`} plain dimColor label="↩ Reply" onPress={() => void composeInPrompt($, 'reply', c)} />
              {c.replies > 0 && depth < 3 && (
                <Button
                  key={`thread-${depth}-${c.id}`}
                  plain
                  {...(threads[c.id] ? {} : { dimColor: true as const })}
                  label={threads[c.id] ? `▾ Hide ${c.replies === 1 ? 'reply' : 'replies'}` : `▸ ${c.replies} ${c.replies === 1 ? 'reply' : 'replies'}`}
                  onPress={() => void toggleReplies($, c.id)}
                />
              )}
            </Box>
            <Button
              key={`save-${depth}-${c.id}`}
              plain
              {...(c.isSaved ? {} : { dimColor: true as const })}
              label={c.isSaved ? '■ Saved' : '□ Save'}
              onPress={() => void react($, c, 'save')}
            />
          </Box>
          {(() => {
            // An open thread shows every reply (up to a cap) in place of the one-reply preview.
            const open = threads[c.id]
            if (!open) return c.replyPreview.map(r => commit(r, depth + 1))
            if (open.status === 'loading') return skeletons(1, 32)
            if (open.status === 'failed') return <Text color={DANGER}>{`Couldn't load the replies: ${open.error ?? ''}`}</Text>
            return [
              ...open.replies.slice(0, MAX_INLINE_REPLIES).map(r => commit(r, depth + 1)),
              ...(open.replies.length > MAX_INLINE_REPLIES && c.url ? [<Link key={`thread-all-${c.id}`} href={c.url} label={`All ${open.replies.length} replies on dev-null.sh`} />] : []),
              ...(open.replies.length === 0 ? [<Text key={`thread-none-${c.id}`} color={MUTED}>No replies to show.</Text>] : []),
            ]
          })()}
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

    // Your streak, rank and XP over a heatmap of your commits, as on your dev-null.sh profile.
    const header = me && (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} paddingBottom={1} flexWrap="wrap">
        <Box flexDirection="column">
          <Text>
            <Text bold>{me.streak > 0 ? `🔥 ${me.streak}-day streak` : 'No streak yet'}</Text>
            <Text color={MUTED}> · longest {me.longest}</Text>
          </Text>
          <Box flexDirection="row">
            <Button key="my-profile" plain dimColor label={`@${me.username} · your profile`} onPress={() => void openProfile($, me.username)} />
          </Box>
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
          const size = fit(map, paneWidth)
          return <Svg source={map.source} alt={`Your commits over the last ${me.scale}`} width={size.width} height={size.height} />
        })()}
      </Box>
    )

    // Remotes: a thread, when one is open, in place of the inbox.
    if (showing === 'remotes' && !person) {
      const QUICK = ['😂', '✅', '❤️']
      const sections: { id: InboxSection; label: string }[] = [
        { id: 'open', label: 'Open' },
        { id: 'stashed', label: 'Stashed' },
        ...(box.requests > 0 || box.section === 'fetched' ? [{ id: 'fetched' as const, label: `Fetched${box.requests > 0 ? ` · ${box.requests}` : ''}` }] : []),
      ]
      const handleOf = (isOrg: boolean, target: string) => (isOrg ? `org:${target}` : `@${target}`)
      const inboxRow = (r: ConversationRow) => (
        <Box key={`rm-${r.id}`} flexDirection="row" columnGap={2} paddingY={1}>
          <Box flexShrink={0}>{ring(r.lane, r.avatarUser ?? r.title, 36)}</Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
              <Button key={`rm-open-${r.id}`} plain label={r.isOrg ? `${r.title} · org` : r.title} onPress={() => void openThread($, r)} />
              <Text size="footnote" color={r.ahead > 0 ? PRIMARY : MUTED}>
                {r.ahead > 0 ? `${r.ahead} ahead` : ago(r.lastAt, now)}
              </Text>
            </Box>
            {r.lastText && (
              <Text color={MUTED} wrap="truncate-end">
                {`${r.lastIsMine ? 'you: ' : ''}${r.lastText}`}
              </Text>
            )}
          </Box>
        </Box>
      )
      const bubble = (m: MessageRow, isLastMine: boolean) => {
        if (m.event) {
          return (
            <Box key={`msg-${m.id}`} flexDirection="row" justifyContent="center" paddingY={1}>
              <Text size="footnote" color={MUTED}>{`${m.username ? `@${m.username} ` : ''}${m.event}`}</Text>
            </Box>
          )
        }
        const groups = [...new Set(m.reactions.map(r => r.emoji))].map(emoji => ({ emoji, count: m.reactions.filter(r => r.emoji === emoji).length, isMine: m.reactions.some(r => r.emoji === emoji && r.userId === myId) }))
        const status = m.status === 'staged' ? 'staged…' : m.status === 'rejected' ? undefined : isLastMine ? (chat && chat.partnerReadThrough >= m.id ? 'pulled' : 'pushed') : undefined
        return (
          <Box key={`msg-${m.id || m.clientId}`} flexDirection="row" justifyContent={m.isMine ? 'flex-end' : 'flex-start'} paddingTop={1}>
            <Box flexDirection="column" borderStyle="round" borderColor={m.isMine ? (chat?.lane ?? PRIMARY) : HAIRLINE} paddingX={1} width="80%">
              {chat?.isOrg && !m.isMine && m.username && (
                <Text size="footnote" color={MUTED}>
                  @{m.username}
                </Text>
              )}
              {m.replyTo && <Text size="footnote" color={MUTED} wrap="truncate-end">{`↩ ${m.replyTo.body}`}</Text>}
              {m.body !== '' && <Markdown key={`mb-${m.id || m.clientId}`} text={linkMentions(m.body)} />}
              {m.images > 0 && <Text color={MUTED}>{m.images === 1 ? '📷 an image (open on dev-null.sh)' : `📷 ${m.images} images`}</Text>}
              {(groups.length > 0 || (!m.isMine && m.id > 0)) && (
                <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
                  {groups.map(g => (
                    <Button key={`rx-${m.id}-${g.emoji}`} plain {...(g.isMine ? {} : { dimColor: true as const })} label={`${g.emoji} ${g.count}`} onPress={() => void toggleReaction($, m.id, g.emoji)} />
                  ))}
                  {!m.isMine && m.id > 0 && QUICK.filter(q => !groups.some(g => g.emoji === q)).map(q => (
                    <Button key={`rq-${m.id}-${q}`} plain dimColor label={q} onPress={() => void toggleReaction($, m.id, q)} />
                  ))}
                </Box>
              )}
              {status && <Text size="footnote" color={MUTED}>{status}</Text>}
              {m.status === 'rejected' && m.clientId && (
                <Box flexDirection="row" columnGap={2}>
                  <Text size="footnote" color={DANGER}>rejected</Text>
                  <Button key={`retry-${m.clientId}`} plain label="Retry" onPress={() => void retryMessage($, m.clientId!)} />
                </Box>
              )}
            </Box>
          </Box>
        )
      }

      if (chat) {
        const lastMine = [...chat.messages].reverse().find(m => m.isMine && m.id > 0)?.id
        const shown = chat.messages.slice(-40)
        const typing = chat.typing.length === 0 ? '' : chat.typing.length === 1 ? `@${chat.typing[0]} is typing…` : chat.typing.length === 2 ? `@${chat.typing[0]} and @${chat.typing[1]} are typing…` : `${chat.typing.length} people are typing…`
        return (
          <Box flexDirection="column">
            <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingBottom={1}>
              <Button key="thread-back" plain label="← Remotes" onPress={() => void closeThread($)} />
              {chat.status === 'ready' && (
                <Button key="thread-stash" plain dimColor label={chat.isArchived ? 'Pop' : 'Stash'} onPress={() => void setStashed($, !chat.isArchived)} />
              )}
            </Box>
            <Box flexDirection="row" alignItems="center" columnGap={2} paddingBottom={1}>
              <Box flexShrink={0}>{ring(chat.lane, chat.avatarUser ?? chat.title, 40)}</Box>
              <Box flexDirection="column">
                <Text size="heading" weight="semibold">
                  {chat.title}
                </Text>
                <Text size="footnote" color={typing ? PRIMARY : MUTED}>
                  {typing || (chat.isOrg ? 'org' : `@${chat.target}`)}
                </Text>
              </Box>
            </Box>
            {chat.status === 'loading' && skeletons(3, 32)}
            {chat.status === 'failed' && <Text color={DANGER}>Couldn't open this remote: {chat.error}</Text>}
            {chat.hasOlder && chat.messages.length > 0 && <Text size="footnote" color={MUTED}>Older messages are on dev-null.sh.</Text>}
            {shown.map(m => bubble(m, m.id === lastMine))}
            <Box flexDirection="column" paddingTop={1}>
              {chat.access === 'request' && (
                <Box flexDirection="column" rowGap={1}>
                  <Text>{`@${chat.target} wants to push to you.`}</Text>
                  <Box flexDirection="row" columnGap={2}>
                    <Button key="req-merge" variant="primary" label="Merge" onPress={() => void answerRequest($, 'merge')} />
                    <Button key="req-drop" label="Drop" onPress={() => void answerRequest($, 'drop')} />
                  </Box>
                </Box>
              )}
              {chat.access === 'waiting' && <Text color={MUTED}>{`@${chat.target} hasn't merged your request yet.`}</Text>}
              {chat.access === 'restricted' && <Text color={MUTED}>{`@${chat.target} doesn't follow you, so you can't push to them yet.`}</Text>}
              {chat.access === 'closed' && <Text color={MUTED}>{`@${chat.target} isn't taking remotes.`}</Text>}
              {chat.access === 'open' && chat.status === 'ready' && (
                <Box flexDirection="row">
                  <Button
                    key="thread-reply"
                    variant="primary"
                    label="Write a message"
                    onPress={() => {
                      void $.prompt.fill({ text: `/devnull remote ${handleOf(chat.isOrg, chat.target)} ` }).catch(() => {})
                      void pingTyping($)
                    }}
                  />
                </Box>
              )}
            </Box>
          </Box>
        )
      }

      return (
        <Box flexDirection="column">
          {header}
          {tabs}
          <Box flexDirection="row" columnGap={3} paddingBottom={1}>
            {sections.map(sec => (
              <Button key={`rs-${sec.id}`} plain {...(sec.id === box.section ? {} : { dimColor: true as const })} label={sec.label} onPress={() => void loadInbox($, sec.id)} />
            ))}
          </Box>
          {box.error && <Text color={DANGER}>{box.error}</Text>}
          {box.isLoading && box.rows.length === 0 && skeletons(4, 36)}
          {box.isLoading && box.rows.length > 0 && progressBar('inbox-progress')}
          {!box.isLoading && !box.error && box.rows.length === 0 && (
            <Text color={MUTED}>{box.section === 'stashed' ? 'Nothing stashed.' : box.section === 'fetched' ? 'No requests.' : 'No remotes yet. Open someone’s profile to start one.'}</Text>
          )}
          {box.rows.slice(0, 30).map(inboxRow)}
          {box.hasMore && (
            <Box flexDirection="row" justifyContent="center" paddingY={1}>
              {box.isLoading ? busy('rm-loading', 'Loading more') : <Button key="rm-more" label="Load more" onPress={() => void loadInbox($, undefined, true)} />}
            </Box>
          )}
        </Box>
      )
    }

    // A profile, when one is open, takes the pane's place until Back.
    if (person) {
      const v = person.view
      const counts = v ? [v.commits !== undefined ? `${v.commits} commits` : '', v.followers !== undefined ? `${v.followers} followers` : '', v.following !== undefined ? `${v.following} following` : ''].filter(Boolean) : []
      const rank = v ? [v.stats.rank, v.stats.level !== undefined ? `level ${v.stats.level}` : '', v.stats.xp !== undefined ? `${v.stats.xp.toLocaleString()} XP` : ''].filter(Boolean) : []
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingBottom={1}>
            <Button key="profile-back" plain label="← Back" onPress={() => void closeProfile($)} />
            {v && !v.isMe && (
              <Button
                key="profile-follow"
                variant={v.isFollowing ? 'secondary' : 'primary'}
                label={person.isFollowBusy ? '…' : v.isFollowing ? 'Following ✓' : 'Follow'}
                onPress={() => void toggleFollow($)}
              />
            )}
          </Box>
          {person.status === 'loading' && skeletons(1, 64)}
          {person.status === 'loading' && skeletons(3, 44)}
          {person.status === 'failed' && <Text color={DANGER}>Couldn't load @{person.username}: {person.error}</Text>}
          {v && (
            <Box flexDirection="column" rowGap={1} paddingBottom={1}>
              <Box flexDirection="row" alignItems="center" columnGap={2}>
                <Box flexShrink={0}>{ring(v.lane, v.username, 64)}</Box>
                <Box flexDirection="column">
                  <Text size="title" weight="bold">
                    {v.name ?? v.username}
                  </Text>
                  <Text mono color={MUTED}>
                    @{v.username}
                    {v.followsYou ? ' · follows you' : ''}
                  </Text>
                </Box>
              </Box>
              {v.bio && (() => {
                const tagged = mentionsIn(v.bio).map(h => MENTION_HREF + h)
                return (
                  <Markdown
                    key={`bio-${v.username}`}
                    text={linkMentions(v.bio)}
                    {...(tagged.length > 0
                      ? {
                          pressableLinks: tagged,
                          onLinkPress: (link: { href: string }) => {
                            const handle = handleFromHref(link.href)
                            if (handle) void openProfile($, handle)
                          },
                        }
                      : {})}
                  />
                )
              })()}
              {(v.location || v.website) && (
                <Box flexDirection="row" columnGap={2}>
                  {v.location && <Text color={MUTED}>{v.location}</Text>}
                  {v.website && /^https?:\/\//.test(v.website) && <Link href={v.website} label={v.website.replace(/^https?:\/\//, '')} />}
                </Box>
              )}
              {counts.length > 0 && <Text color={MUTED}>{counts.join(' · ')}</Text>}
              <Text>
                <Text weight="semibold">{v.stats.streak > 0 ? `🔥 ${v.stats.streak}-day streak` : 'No streak right now'}</Text>
                <Text color={MUTED}>{` · longest ${v.stats.longest}${rank.length ? ` · ${rank.join(' · ')}` : ''}`}</Text>
              </Text>
              {v.badges.length > 0 && <Text color={MUTED} wrap="wrap">{`Badges: ${v.badges.join(', ')}`}</Text>}
              {Svg && v.stats.buckets.length > 0 && (() => {
                const map = heatmapSvg(v.stats, v.lane)
                const size = fit(map, paneWidth)
                return <Svg source={map.source} alt={`@${v.username}'s commits over the last ${v.stats.scale}`} width={size.width} height={size.height} />
              })()}
            </Box>
          )}
          {v && person.commits.length === 0 && person.status === 'ready' && <Text color={MUTED}>No commits yet.</Text>}
          {person.commits.slice(0, MAX_DRAWN).map(c => commit(c, 0))}
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
                  await update($, live, (l): Live => ({ ...l, newCount: 0 }))
                  await refreshToTop($)
                })()
              }}
            />
          </Box>
        )}
        {f.error && <Text color={DANGER}>Couldn't load: {f.error}</Text>}
        {f.isLoading && !f.isLoadingMore && !isEmpty && progressBar('feed-progress')}
        {f.isLoading && isEmpty && skeletons(showing === 'notifications' ? 6 : 4, showing === 'notifications' ? 36 : 44)}
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
    // A profile scrolls as one page; the log's window and pull to refresh wait for Back. So does Remotes.
    if (await read($, profile)) return moved
    if ((await read($, tab)) === 'remotes') return moved
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

// Starts a post in Claude's prompt box from a press in the pane. No mods API can focus the prompt box, and
// closing the pane doesn't hand it focus on the desktop either, so the person clicks it to type.
async function composeInPrompt($: EngineInterface, mode: 'new' | 'reply' | 'quote' = 'new', row?: CommitRow): Promise<void> {
  if (mode === 'new') await startInPrompt($)
  else await aim($, mode, row)
}

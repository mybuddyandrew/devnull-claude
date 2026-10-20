// One commit as the pane draws it, with its quote, image, link card, actions and inline replies.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { CommitRow } from '../types'
import { composeInPrompt, react } from './feed'
import type { Kit } from './pane-kit'
import { openProfile } from './profile'
import { toggleReplies } from './replies'
import { DANGER, HAIRLINE, INITIAL_EXPANDED, INITIAL_OPEN_REPLIES, INITIAL_PICTURES, MAX_INLINE_REPLIES, MUTED } from './state'
import { pictureSvg, TAIL_HEIGHT, tailSvg } from './svg'
import { ago, handleFromHref, linkMentions, MENTION_HREF, mentionsIn, preview } from './text'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const expanded = atom({ plugin: 'devnull', key: 'expanded' } as const, INITIAL_EXPANDED)
const openReplies = atom({ plugin: 'devnull', key: 'openReplies' } as const, INITIAL_OPEN_REPLIES)
const pictures = atom({ plugin: 'devnull', key: 'pictures' } as const, INITIAL_PICTURES)

// Answers the drawer for this draw: commits share its image budget, so it is made once per draw.
export async function commitDrawer($: EngineInterface, kit: Kit) {
  const { Box, Text, Button, Link, Markdown } = kit.els
  const { Svg, contentWidth, now, ring, skeletons } = kit
  const open = await read($, expanded)
  const images = await read($, pictures)
  const threads = await read($, openReplies)

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
              <Text weight="bold">{c.quoted.name ?? c.quoted.username}</Text> <Text mono color={MUTED}>@{c.quoted.username}</Text>
            </Text>
            <Text color={MUTED} wrap="wrap">
              {c.quoted.body.length > 280 ? c.quoted.body.slice(0, 280) + '…' : c.quoted.body}
            </Text>
          </Box>
        )}
        {(() => {
          const first = (c.pictures ?? [])[0]
          const data = first ? images[first.url] : undefined
          if (Svg && first && data && data.length <= kit.budget.pictures) {
            kit.budget.pictures -= data.length
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
          const hasThumb = Boolean(Svg && thumb && thumb.length <= kit.budget.pictures && contentWidth >= 260)
          if (hasThumb && thumb) kit.budget.pictures -= thumb.length
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
          if (open.status === 'loading') return skeletons(`replies-${c.id}`, 1, 32)
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

  return commit
}

export type DrawCommit = Awaited<ReturnType<typeof commitDrawer>>

// A person's profile in the pane, in the log's place until Back.
import type { EngineInterface } from 'claude-code'

import type { Profile } from '../types'
import type { DrawCommit } from './pane-commit'
import type { Kit } from './pane-kit'
import { closeProfile, openProfile, toggleFollow } from './profile'
import { DANGER, MAX_DRAWN, MUTED } from './state'
import { heatmapSvg } from './streaks'
import { handleFromHref, linkMentions, MENTION_HREF, mentionsIn } from './text'

export function drawProfile($: EngineInterface, kit: Kit, commit: DrawCommit, person: NonNullable<Profile>) {
  const { Box, Text, Button, Link, Markdown } = kit.els
  const { Svg, fit, paneWidth, ring, skeletons } = kit
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
      {person.status === 'loading' && skeletons('profile-head', 1, 64)}
      {person.status === 'loading' && skeletons('profile-rows', 3, 44)}
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

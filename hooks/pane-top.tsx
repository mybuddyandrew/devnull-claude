// The top of the log and inbox: your streak header and the tabs.
import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { show } from './feed'
import type { Kit } from './pane-kit'
import { refreshToTop } from './pane-scroll'
import { openProfile } from './profile'
import { INITIAL_FEED, INITIAL_INBOX, INITIAL_LIVE, INITIAL_STATS, INITIAL_TAB, LABELS, MUTED, PRIMARY, TABS } from './state'
import { heatmapSvg } from './streaks'
import { underlineSvg } from './svg'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const feed = atom({ plugin: 'devnull', key: 'feed' } as const, INITIAL_FEED)
const inbox = atom({ plugin: 'devnull', key: 'inbox' } as const, INITIAL_INBOX)
const live = atom({ plugin: 'devnull', key: 'live' } as const, INITIAL_LIVE)
const stats = atom({ plugin: 'devnull', key: 'stats' } as const, INITIAL_STATS)
const tab = atom({ plugin: 'devnull', key: 'tab' } as const, INITIAL_TAB)

export async function drawTop($: EngineInterface, kit: Kit) {
  const { Box, Text, Button } = kit.els
  const { Svg, busy, fit, paneWidth } = kit
  const showing = await read($, tab)
  const f = await read($, feed)
  const box = await read($, inbox)
  const fresh = await read($, live)
  const me = await read($, stats)

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

  return { tabs, header }
}

export type Top = Awaited<ReturnType<typeof drawTop>>

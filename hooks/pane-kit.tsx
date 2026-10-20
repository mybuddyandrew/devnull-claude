// What every view of the pane draws with: the surface's elements, its width, loaders and avatar rings.
import { atom, read } from 'claude-code'
import type { EngineInterface, RenderInput } from 'claude-code'

import { AVATAR_BUDGET_CHARS, AVATAR_MAX_CHARS, INITIAL_AVATARS, MUTED, PICTURE_BUDGET_CHARS, PRIMARY } from './state'
import { avatarSvg, progressSvg, skeletonSvg, spinnerSvg } from './svg'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const avatars = atom({ plugin: 'devnull', key: 'avatars' } as const, INITIAL_AVATARS)

export async function makeKit($: EngineInterface, e: RenderInput) {
  const els = $.ui.resolve(e)
  const { Box, Text } = els
  // The terminal draws no SVG: it gets a dot where the avatar would be.
  const Svg = 'Svg' in els ? els.Svg : undefined
  const Input = 'Input' in els ? els.Input : undefined
  const faces = await read($, avatars)
  const now = Date.now()

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
  // `id` keeps the keys of two skeleton runs in one drawing apart.
  const skeletons = (id: string, n: number, avatar = 40) =>
    Svg
      ? Array.from({ length: n }, (_, i) => {
          const sk = skeletonSvg(loaderWidth, avatar)
          return (
            <Box key={`sk-${id}-${i}`} paddingY={1}>
              <Svg source={sk.source} alt="Loading" width={sk.width} height={sk.height} isInteractive />
            </Box>
          )
        })
      : [<Text key={`sk-${id}-text`} color={MUTED}>Loading…</Text>]
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
  // Photos past the budget fall back to initials, so one draw stays well under what the desktop takes.
  // Commit images have a budget of their own; past it, a commit shows a link instead.
  const budget = { photos: AVATAR_BUDGET_CHARS, pictures: PICTURE_BUDGET_CHARS }
  const ring = (lane: string, username: string, size: number) => {
    if (!Svg) return <Text color={lane}>●</Text>
    const face = faces[username]
    const photo = face && face.length <= AVATAR_MAX_CHARS && face.length <= budget.photos ? face : undefined
    if (photo) budget.photos -= photo.length
    return <Svg source={avatarSvg(lane, size, photo, username)} alt={`@${username}`} width={size} height={size} />
  }


  return { els, Svg, Input, now, paneWidth, contentWidth, fit, skeletons, progressBar, busy, ring, budget }
}

export type Kit = Awaited<ReturnType<typeof makeKit>>

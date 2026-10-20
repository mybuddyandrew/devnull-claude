// Scrolling the pane's log: a window of rows that slides as you scroll, more loaded near the end, and pull to
// refresh (wheel up past the top a few times in a row).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import { refresh } from './feed'
import { INITIAL_FEED, INITIAL_PROFILE, INITIAL_PULL, INITIAL_TAB, INITIAL_WINDOW_START, LOAD_MORE_ROWS, MAX_DRAWN, PANE, PULL_TICKS, SLIDE_ROWS } from './state'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const feed = atom({ plugin: 'devnull', key: 'feed' } as const, INITIAL_FEED)
const profile = atom({ plugin: 'devnull', key: 'profile' } as const, INITIAL_PROFILE)
const pull = atom({ plugin: 'devnull', key: 'pull' } as const, INITIAL_PULL)
const tab = atom({ plugin: 'devnull', key: 'tab' } as const, INITIAL_TAB)
const windowStart = atom({ plugin: 'devnull', key: 'windowStart' } as const, INITIAL_WINDOW_START)

export function registerScroll(on: On): void {
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
export async function slide($: EngineInterface, direction: 1 | -1): Promise<void> {
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
export async function refreshToTop($: EngineInterface): Promise<void> {
  await refresh($)
  $.clock.after(120, () => {
    void $.ui.scroll({ to: 'start', in: PANE }).catch(() => {})
  })
}

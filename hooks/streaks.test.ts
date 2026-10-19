import { expect, test } from 'claude-code/testing'

import { hasCommittedToday, heatmapSvg, statusLine, toStats } from './streaks'

const NOW = Date.parse('2026-10-19T19:00:00Z')

// A made-up year of activity: 365 days, Sunday-first, a commit every third day and one today.
const year = Array.from({ length: 365 }, (_, i) => {
  const date = new Date(NOW - (364 - i) * 86_400_000).toISOString().slice(0, 10)
  return { date, count: i === 364 ? 2 : i % 3 === 0 ? 1 : 0 }
})

const profile = {
  data: { username: 'ada' },
  streaks: { current: 12, longest: 30 },
  achievements: { level: 6, rank: 'root', xp: 2410, next_level_xp: null },
  activity: { scale: 'year', buckets: year },
}

test('reads streaks, rank and activity from a signed profile', async () => {
  const s = toStats('ada', profile, NOW)
  expect(s).toMatchObject({ username: 'ada', streak: 12, longest: 30, rank: 'root', level: 6, xp: 2410, scale: 'year' })
  expect(s.nextLevelXp).toBeUndefined()
  expect(s.buckets).toHaveLength(365)
  expect(hasCommittedToday(s, NOW)).toBe(true)
  expect(hasCommittedToday({ ...s, buckets: s.buckets.slice(0, -1) }, NOW)).toBe(false)
})

test('a guest-shaped profile reads as no streak', async () => {
  const s = toStats('ada', { data: {} }, NOW)
  expect(s).toMatchObject({ streak: 0, longest: 0, scale: 'year', buckets: [] })
})

test('a year heatmap is 7 rows of week columns and stays a few KB', async () => {
  const map = heatmapSvg(toStats('ada', profile, NOW), '#7aa2f7')
  expect(map.height).toBe(7 * 9 - 2)
  expect(map.width).toBeGreaterThan(50 * 9)
  expect(map.source.length).toBeLessThan(12_000)
  expect(map.source).toContain('<path')
})

test('the status line names the streak and what is waiting', async () => {
  const s = toStats('ada', profile, NOW)
  expect(statusLine(s, { newCount: 3, unread: 2 })).toBe('/dev/null: 🔥 12-day streak · root · 2 unread · 3 new')
  expect(statusLine({ ...s, streak: 0, rank: undefined }, { newCount: 0, unread: 0 })).toBe('/dev/null: No streak yet')
})

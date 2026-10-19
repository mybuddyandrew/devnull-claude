// A made-up page of the Following log, shaped like dev-null.sh's /api/v1 answer, for the signed-in render test.
const author = (username: string, name: string, lane: number | string) => ({ username, name, lane, avatar_url: null })

const commit = (id: string, body: string, who: ReturnType<typeof author>, extra: Record<string, unknown> = {}) => ({
  id,
  short_hash: id.slice(0, 7),
  body,
  author: who,
  created_at: '2026-10-19T18:30:00Z',
  html_url: `https://dev-null.sh/@${who.username}/commits/${id}`,
  stars_count: 0,
  replies_count: 0,
  starred: false,
  is_saved: false,
  images: [],
  reply_preview: { data: [] },
  ...extra,
})

const ada = author('ada', 'Ada Example', 2)
const linus = author('linus', 'Linus Example', '#3bc9db')
const grace = author('grace', 'Grace Example', 5)

export const FOLLOWING = {
  data: [
    commit('0a1b2c3d4e', 'shipped the thing', ada, { stars_count: 3 }),
    commit('1b2c3d4e5f', ['a long one:', '```ts', ...Array.from({ length: 20 }, (_, i) => `const line${i} = ${i}`), '```'].join('\n'), linus),
    commit('2c3d4e5f6a', 'who else is up late?', grace, {
      replies_count: 1,
      reply_preview: { data: [commit('reply-1', 'me', ada)] },
    }),
  ],
  meta: { next_cursor: 'x' },
}

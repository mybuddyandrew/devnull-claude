// Profiles in the pane: open anyone's from their handle or a mention, follow or unfollow them, and go back.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Profile, ProfileView } from '../types'
import { api, loadAvatars, loadPictures } from './core'
import { dataList, laneColor, toCommitRow } from './devnull'
import { INITIAL_PROFILE } from './state'
import { toStats } from './streaks'
import { rememberPeople } from './transcript'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const profile = atom({ plugin: 'devnull', key: 'profile' } as const, INITIAL_PROFILE)

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

// GET users/{username}, signed: the user under `data`, the rest beside it.
export const toProfileView = (username: string, json: unknown, me: string | undefined, nowMs: number): ProfileView => {
  const root = obj(json)
  const user = obj(root.data)
  const name = str(user.username) ?? username
  const badges = (Array.isArray(obj(root.achievements).badges) ? (obj(root.achievements).badges as unknown[]) : [])
    .map(obj)
    .filter(b => b.unlocked === true)
    .map(b => str(b.name) ?? str(b.id) ?? '')
    .filter(Boolean)
  const fields = {
    name: str(user.name),
    bio: str(user.bio),
    location: str(user.location),
    website: str(user.website),
    avatarUrl: str(user.avatar_url),
    commits: num(user.commits_count),
    followers: num(user.followers_count),
    following: num(user.following_count),
  }
  return {
    username: name,
    ...(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Partial<ProfileView>),
    lane: laneColor(user.lane),
    isFollowing: root.is_following === true,
    followsYou: root.follows_you === true,
    isMe: me !== undefined && me.toLowerCase() === name.toLowerCase(),
    stats: toStats(name, json, nowMs),
    badges,
  }
}

export async function openProfile($: EngineInterface, username: string): Promise<void> {
  const name = username.replace(/^@/, '').trim()
  if (!name) return
  await update($, profile, (): Profile | null => ({ username: name, status: 'loading', commits: [] }))
  try {
    const me = (await $.store.get('username')) as string | undefined
    const [json, posts] = await Promise.all([
      api($, 'GET', `users/${encodeURIComponent(name)}`),
      api($, 'GET', `users/${encodeURIComponent(name)}/commits`).catch(() => ({})),
    ])
    const view = toProfileView(name, json, me, await $.clock.now())
    const commits = dataList(posts).map(toCommitRow)
    // A newer open (another profile, or Back) while this loaded wins.
    if ((await read($, profile))?.username !== name) return
    await update($, profile, (): Profile | null => ({ username: name, status: 'ready', view, commits }))
    void loadAvatars($, [[view.username, view.avatarUrl], ...commits.flatMap(c => [c, ...c.replyPreview]).map((c): [string, string | undefined] => [c.username, c.avatarUrl])])
    void rememberPeople($, [view.username, ...commits.map(c => c.username)]).catch(() => {})
    void loadPictures($, commits.flatMap(c => [...(c.pictures[0] ? [c.pictures[0].url] : []), ...(c.preview?.imageUrl ? [c.preview.imageUrl] : [])])).catch(() => {})
  } catch (error) {
    if ((await read($, profile))?.username !== name) return
    await update($, profile, (): Profile | null => ({ username: name, status: 'failed', commits: [], error: (error as Error).message }))
  }
}

export async function closeProfile($: EngineInterface): Promise<void> {
  await update($, profile, (): Profile | null => null)
}

// POST or DELETE users/{u}/follow; the counts and button flip at once and go back if dev-null.sh refuses.
export async function toggleFollow($: EngineInterface): Promise<void> {
  const now = await read($, profile)
  const view = now?.view
  if (!now || !view || view.isMe || now.isFollowBusy) return
  const follow = !view.isFollowing
  // The follower count is always worked out from the count before the press, so repeat flips don't drift.
  const flip = (p: Profile | null, on: boolean, busy: boolean): Profile | null =>
    p && p.view && p.username === now.username
      ? {
          ...p,
          isFollowBusy: busy,
          view: {
            ...p.view,
            isFollowing: on,
            ...(view.followers !== undefined ? { followers: Math.max(0, view.followers + (on === view.isFollowing ? 0 : on ? 1 : -1)) } : {}),
          },
        }
      : p
  await update($, profile, p => flip(p, follow, true))
  try {
    await api($, follow ? 'POST' : 'DELETE', `users/${encodeURIComponent(view.username)}/follow`)
    await update($, profile, p => flip(p, follow, false))
    $.ui.toast(follow ? `/dev/null: following @${view.username}` : `/dev/null: unfollowed @${view.username}`)
  } catch (error) {
    await update($, profile, p => flip(p, view.isFollowing, false))
    $.ui.toast(`/dev/null: ${(error as Error).message}`)
  }
}

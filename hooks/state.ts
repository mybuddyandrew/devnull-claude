// The mod's shared state and look: one place for the atoms every feature reads.
import type { Compose, Feed, Live, Login, Ship, Stats, Tab } from '../types'

export const PANE = 'devnull'
export const TABS: Tab[] = ['following', 'latest', 'trending', 'notifications']
export const LABELS: Record<Tab, string> = { following: 'Following', latest: 'Latest', trending: 'Trending', notifications: 'Notifications' }
// The web app's dark tokens.
export const PRIMARY = '#7aa2f7'
export const MUTED = '#a1a1a6'
export const HAIRLINE = '#2a2a2d'
export const STAR = '#fcc419'
export const DANGER = '#ff6b6b'
// Avatar photos are embedded in the tree: one may be at most 8 KB, and one draw carries 50 KB of them.
export const AVATAR_MAX_CHARS = 8_000
export const AVATAR_BUDGET_CHARS = 50_000
export const LOGIN_WINDOW_MS = 5 * 60 * 1000
export const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

export const INITIAL_TAB = 'following' as Tab
export const INITIAL_FEED = { isLoading: false, commits: [], notifications: [] } as Feed
export const INITIAL_LOGIN = { status: 'signed-out' } as Login
export const INITIAL_AVATARS = {} as Record<string, string>
export const INITIAL_COMPOSE = { mode: 'new', isSending: false, round: 0 } as Compose
export const INITIAL_EXPANDED = [] as string[]
export const INITIAL_SHIP = { status: 'idle', round: 0 } as Ship
export const INITIAL_STATS = null as Stats | null
export const INITIAL_LIVE = { newCount: 0, unread: 0 } as Live
export const INITIAL_PEOPLE = [] as string[]

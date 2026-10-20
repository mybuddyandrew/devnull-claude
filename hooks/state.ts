// The mod's shared state and look: one place for the atoms every feature reads.
import type { Compose, Feed, Inbox, Live, Login, Profile, Ship, Stats, Tab, Thread } from '../types'

export const PANE = 'devnull'
export const TABS: Tab[] = ['following', 'latest', 'trending', 'notifications', 'remotes']
export const LABELS: Record<Tab, string> = { following: 'Following', latest: 'Latest', trending: 'Trending', notifications: 'Notifications', remotes: 'Remotes' }
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
export const INITIAL_PULL = 0
export const INITIAL_WINDOW_START = 0
// The pane draws at most this many rows of a list (about 4 KB each), sliding by SLIDE_ROWS as you scroll.
export const MAX_DRAWN = 15
export const SLIDE_ROWS = 6
// Loaded rows kept in memory; the oldest beyond this are dropped.
export const MAX_LOADED = 300
// Wheel ticks up past the top that refresh the pane, and how near the end a scroll loads the next page.
export const PULL_TICKS = 4
export const LOAD_MORE_ROWS = 12
export const INITIAL_PROFILE = null as Profile | null
export const INITIAL_PICTURES = {} as Record<string, string>
// Images are embedded too: each a 260px JPEG of at most 16 KB, and one draw carries at most 45 KB of them.
export const PICTURE_MAX_CHARS = 16_000
export const PICTURE_BUDGET_CHARS = 45_000
export const INITIAL_INBOX = { section: 'open', rows: [], isLoading: false, hasMore: false, unread: 0, requests: 0 } as Inbox
export const INITIAL_THREAD = null as Thread | null
// Remotes polls as the phone app does: an open thread every few seconds, faster right after activity.
export const THREAD_POLL_MS = 3000
// dev-null.sh takes messages up to 2000 characters, 30 a minute.
export const MESSAGE_MAX = 2000

export type Tab = 'following' | 'latest' | 'trending' | 'notifications'

export type CommitRow = {
  id: string
  hash: string
  username: string
  name?: string
  avatarUrl?: string
  lane: string
  body: string
  createdAt?: string
  stars: number
  replies: number
  images: number
  isStarred: boolean
  isSaved: boolean
  url?: string
  quoted?: CommitRow
  replyPreview: CommitRow[]
}

export type NoteRow = {
  id: string
  type: string
  actor: string
  avatarUrl?: string
  lane: string
  others: number
  excerpt?: string
  createdAt?: string
  isUnread: boolean
}

export type Feed = {
  isLoading: boolean
  error?: string
  commits: CommitRow[]
  notifications: NoteRow[]
  fetchedAt?: number
  nextCursor?: string
}

export type Login = {
  status: 'signed-out' | 'waiting' | 'signed-in' | 'failed'
  username?: string
  message?: string
}

// What the composer is writing: a new commit, or a reply to or quote of one.
export type Compose = {
  mode: 'new' | 'reply' | 'quote'
  targetId?: string
  targetHandle?: string
  isSending: boolean
  error?: string
  // bumped after a send so the field draws empty again
  round: number
  // text the field starts with, e.g. a draft Claude wrote
  draft?: string
}

// The ship-to-/dev/null band: a draft post made from work just shipped in this session.
export type Ship = {
  status: 'idle' | 'drafting' | 'ready' | 'posting' | 'posted' | 'failed'
  // what was shipped, e.g. the git commit subject
  source?: string
  draft?: string
  error?: string
  // bumped after each post or dismissal so the band's field draws fresh
  round: number
}

// The signed-in user's profile stats from GET users/{me}.
export type Stats = {
  username: string
  streak: number
  longest: number
  rank?: string
  level?: number
  xp?: number
  nextLevelXp?: number
  scale: 'day' | 'week' | 'month' | 'year'
  buckets: { date: string; count: number }[]
  fetchedAt: number
}

// What changed since the pane last loaded: new commits on the shown log, and unread notifications.
export type Live = { newCount: number; unread: number }

declare module 'claude-code' {
  interface PluginState {
    // avatars: username → data: URI, fetched once per session
    devnull: {
      tab: Tab; feed: Feed; login: Login; avatars: Record<string, string>; compose: Compose
      expanded: string[]
      ship: Ship
      stats: Stats | null
      live: Live
      // usernames seen in logs and your follows, for @ completion
      people: string[]
    }
  }
}

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
}

declare module 'claude-code' {
  interface PluginState {
    // avatars: username → data: URI, fetched once per session
    devnull: { tab: Tab; feed: Feed; login: Login; avatars: Record<string, string>; compose: Compose; expanded: string[] }
  }
}

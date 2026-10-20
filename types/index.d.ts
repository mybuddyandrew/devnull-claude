export type Tab = 'following' | 'latest' | 'trending' | 'notifications' | 'remotes'

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
  // the commit's images: dev-null.sh URLs with their size and alt text
  pictures: { url: string; width: number; height: number; alt?: string }[]
  // the card dev-null.sh makes for a commit's first link: page title, description, image, site
  preview?: { url: string; title?: string; description?: string; site?: string; imageUrl?: string }
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
  // set while the next page loads, as opposed to a refresh of the first
  isLoadingMore?: boolean
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
  // where the draft came from: work shipped (git commit, gh pr create), typed with /devnull post, or /devnull draft
  kind?: 'ship' | 'typed' | 'session'
  // a reply or quote target for the post, or a Remotes message to send instead (id: the username or org id)
  to?: { mode: 'reply' | 'quote'; id: string; handle?: string } | { mode: 'remote'; id: string; isOrg: boolean }
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

// Someone's profile as the pane shows it: GET users/{username}, signed.
export type ProfileView = {
  username: string
  name?: string
  bio?: string
  location?: string
  website?: string
  avatarUrl?: string
  lane: string
  commits?: number
  followers?: number
  following?: number
  isFollowing: boolean
  followsYou: boolean
  isMe: boolean
  stats: Stats
  // earned badges' names
  badges: string[]
}

// The profile open in the pane, if any: the pane shows it in place of the log.
export type Profile = {
  username: string
  status: 'loading' | 'ready' | 'failed'
  view?: ProfileView
  commits: CommitRow[]
  error?: string
  isFollowBusy?: boolean
}

// What changed since the pane last loaded: new commits on the shown log, and unread notifications.
// remotesOn: dev-null.sh serves Remotes (direct messages) and you have them switched on; remotesUnread: its badge.
export type Live = { newCount: number; unread: number; remotesOn?: boolean; remotesUnread?: number }

// A Remotes conversation in the inbox: a direct one with a partner, or an org (a group).
export type ConversationRow = {
  id: string
  isOrg: boolean
  // the partner's username for a direct conversation; the org's id for an org
  target: string
  title: string
  lane: string
  avatarUrl?: string
  avatarUser?: string
  lastText?: string
  lastIsMine: boolean
  lastAt?: string
  ahead: number
  isArchived: boolean
}

// One message in a Remotes thread, as dev-null.sh sends it.
export type MessageRow = {
  id: number
  userId: string
  username?: string
  isMine: boolean
  body: string
  replyTo?: { id: number; body: string }
  event?: string
  reactions: { userId: string; emoji: string }[]
  images: number
  createdAt?: string
  // set while the message is being sent, or when dev-null.sh refused it
  status?: 'staged' | 'rejected'
  clientId?: string
}

export type InboxSection = 'open' | 'stashed' | 'fetched'

export type Inbox = {
  section: InboxSection
  rows: ConversationRow[]
  isLoading: boolean
  error?: string
  hasMore: boolean
  unread: number
  requests: number
}

// The open Remotes thread, if any: the pane shows it in place of the inbox.
export type Thread = {
  isOrg: boolean
  target: string
  title: string
  lane: string
  avatarUrl?: string
  avatarUser?: string
  status: 'loading' | 'ready' | 'failed'
  error?: string
  messages: MessageRow[]
  hasOlder: boolean
  access: 'open' | 'request' | 'waiting' | 'restricted' | 'closed'
  typing: string[]
  readThrough: number
  partnerReadThrough: number
  reactionsVersion: number
  isArchived: boolean
}

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
      // wheel ticks upward while the pane is already at its top: pull to refresh
      pull: number
      // index of the first loaded row the pane draws; the desktop drops a drawing that grows too large
      windowStart: number
      profile: Profile | null
      inbox: Inbox
      thread: Thread | null
      // commits whose replies are open inline in the pane, by commit id
      openReplies: Record<string, { status: 'loading' | 'ready' | 'failed'; replies: CommitRow[]; error?: string }>
      // each log tab's last-loaded list, shown at once when you switch back to it while it refreshes
      tabCache: Record<string, { commits: CommitRow[]; notifications: NoteRow[]; nextCursor?: string }>
      // image URL → small JPEG data: URI, fetched once per session, drawn inline within a budget
      pictures: Record<string, string>
    }
  }
}

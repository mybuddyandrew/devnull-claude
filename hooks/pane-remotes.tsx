// Remotes in the pane: the inbox, or the open thread in its place.
import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { ConversationRow, InboxSection, MessageRow } from '../types'
import type { Kit } from './pane-kit'
import { startCommand } from './prompt'
import type { Top } from './pane-top'
import { answerRequest, closeThread, loadInbox, openThread, pingTyping, retryMessage, setStashed, toggleReaction } from './remotes'
import { DANGER, HAIRLINE, INITIAL_INBOX, INITIAL_THREAD, MUTED, PRIMARY } from './state'
import { ago, linkMentions } from './text'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const inbox = atom({ plugin: 'devnull', key: 'inbox' } as const, INITIAL_INBOX)
const thread = atom({ plugin: 'devnull', key: 'thread' } as const, INITIAL_THREAD)

export async function drawRemotes($: EngineInterface, kit: Kit, top: Top) {
  const { Box, Text, Button, Markdown } = kit.els
  const { busy, now, progressBar, ring, skeletons } = kit
  const { header, tabs } = top
  const box = await read($, inbox)
  const chat = await read($, thread)
  const myId = (await $.store.get('userId').catch(() => undefined)) as string | undefined

  const QUICK = ['😂', '✅', '❤️']
  const sections: { id: InboxSection; label: string }[] = [
    { id: 'open', label: 'Open' },
    { id: 'stashed', label: 'Stashed' },
    ...(box.requests > 0 || box.section === 'fetched' ? [{ id: 'fetched' as const, label: `Fetched${box.requests > 0 ? ` · ${box.requests}` : ''}` }] : []),
  ]
  const handleOf = (isOrg: boolean, target: string) => (isOrg ? `org:${target}` : `@${target}`)
  const inboxRow = (r: ConversationRow) => (
    <Box key={`rm-${r.id}`} flexDirection="row" columnGap={2} paddingY={1}>
      <Box flexShrink={0}>{ring(r.lane, r.avatarUser ?? r.title, 36)}</Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
          <Button key={`rm-open-${r.id}`} plain label={r.isOrg ? `${r.title} · org` : r.title} onPress={() => void openThread($, r)} />
          <Text size="footnote" color={r.ahead > 0 ? PRIMARY : MUTED}>
            {r.ahead > 0 ? `${r.ahead} ahead` : ago(r.lastAt, now)}
          </Text>
        </Box>
        {r.lastText && (
          <Text color={MUTED} wrap="truncate-end">
            {`${r.lastIsMine ? 'you: ' : ''}${r.lastText}`}
          </Text>
        )}
      </Box>
    </Box>
  )
  const bubble = (m: MessageRow, isLastMine: boolean) => {
    if (m.event) {
      return (
        <Box key={`msg-${m.id}`} flexDirection="row" justifyContent="center" paddingY={1}>
          <Text size="footnote" color={MUTED}>{`${m.username ? `@${m.username} ` : ''}${m.event}`}</Text>
        </Box>
      )
    }
    const groups = [...new Set(m.reactions.map(r => r.emoji))].map(emoji => ({ emoji, count: m.reactions.filter(r => r.emoji === emoji).length, isMine: m.reactions.some(r => r.emoji === emoji && r.userId === myId) }))
    const status = m.status === 'staged' ? 'staged…' : m.status === 'rejected' ? undefined : isLastMine ? (chat && chat.partnerReadThrough >= m.id ? 'pulled' : 'pushed') : undefined
    return (
      <Box key={`msg-${m.id || m.clientId}`} flexDirection="row" justifyContent={m.isMine ? 'flex-end' : 'flex-start'} paddingTop={1}>
        <Box flexDirection="column" borderStyle="round" borderColor={m.isMine ? (chat?.lane ?? PRIMARY) : HAIRLINE} paddingX={1} width="80%">
          {chat?.isOrg && !m.isMine && m.username && (
            <Text size="footnote" color={MUTED}>
              @{m.username}
            </Text>
          )}
          {m.replyTo && <Text size="footnote" color={MUTED} wrap="truncate-end">{`↩ ${m.replyTo.body}`}</Text>}
          {m.body !== '' && <Markdown key={`mb-${m.id || m.clientId}`} text={linkMentions(m.body)} />}
          {m.images > 0 && <Text color={MUTED}>{m.images === 1 ? '📷 an image (open on dev-null.sh)' : `📷 ${m.images} images`}</Text>}
          {(groups.length > 0 || (!m.isMine && m.id > 0)) && (
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {groups.map(g => (
                <Button key={`rx-${m.id}-${g.emoji}`} plain {...(g.isMine ? {} : { dimColor: true as const })} label={`${g.emoji} ${g.count}`} onPress={() => void toggleReaction($, m.id, g.emoji)} />
              ))}
              {!m.isMine && m.id > 0 && QUICK.filter(q => !groups.some(g => g.emoji === q)).map(q => (
                <Button key={`rq-${m.id}-${q}`} plain dimColor label={q} onPress={() => void toggleReaction($, m.id, q)} />
              ))}
            </Box>
          )}
          {status && <Text size="footnote" color={MUTED}>{status}</Text>}
          {m.status === 'rejected' && m.clientId && (
            <Box flexDirection="row" columnGap={2}>
              <Text size="footnote" color={DANGER}>rejected</Text>
              <Button key={`retry-${m.clientId}`} plain label="Retry" onPress={() => void retryMessage($, m.clientId!)} />
            </Box>
          )}
        </Box>
      </Box>
    )
  }

  if (chat) {
    const lastMine = [...chat.messages].reverse().find(m => m.isMine && m.id > 0)?.id
    const shown = chat.messages.slice(-40)
    const typing = chat.typing.length === 0 ? '' : chat.typing.length === 1 ? `@${chat.typing[0]} is typing…` : chat.typing.length === 2 ? `@${chat.typing[0]} and @${chat.typing[1]} are typing…` : `${chat.typing.length} people are typing…`
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" paddingBottom={1}>
          <Button key="thread-back" plain label="← Remotes" onPress={() => void closeThread($)} />
          {chat.status === 'ready' && (
            <Button key="thread-stash" plain dimColor label={chat.isArchived ? 'Pop' : 'Stash'} onPress={() => void setStashed($, !chat.isArchived)} />
          )}
        </Box>
        <Box flexDirection="row" alignItems="center" columnGap={2} paddingBottom={1}>
          <Box flexShrink={0}>{ring(chat.lane, chat.avatarUser ?? chat.title, 40)}</Box>
          <Box flexDirection="column">
            <Text size="heading" weight="semibold">
              {chat.title}
            </Text>
            <Text size="footnote" color={typing ? PRIMARY : MUTED}>
              {typing || (chat.isOrg ? 'org' : `@${chat.target}`)}
            </Text>
          </Box>
        </Box>
        {chat.status === 'loading' && skeletons('thread', 3, 32)}
        {chat.status === 'failed' && <Text color={DANGER}>Couldn't open this remote: {chat.error}</Text>}
        {chat.hasOlder && chat.messages.length > 0 && <Text size="footnote" color={MUTED}>Older messages are on dev-null.sh.</Text>}
        {shown.map(m => bubble(m, m.id === lastMine))}
        <Box flexDirection="column" paddingTop={1}>
          {chat.access === 'request' && (
            <Box flexDirection="column" rowGap={1}>
              <Text>{`@${chat.target} wants to push to you.`}</Text>
              <Box flexDirection="row" columnGap={2}>
                <Button key="req-merge" variant="primary" label="Merge" onPress={() => void answerRequest($, 'merge')} />
                <Button key="req-drop" label="Drop" onPress={() => void answerRequest($, 'drop')} />
              </Box>
            </Box>
          )}
          {chat.access === 'waiting' && <Text color={MUTED}>{`@${chat.target} hasn't merged your request yet.`}</Text>}
          {chat.access === 'restricted' && <Text color={MUTED}>{`@${chat.target} doesn't follow you, so you can't push to them yet.`}</Text>}
          {chat.access === 'closed' && <Text color={MUTED}>{`@${chat.target} isn't taking remotes.`}</Text>}
          {chat.access === 'open' && chat.status === 'ready' && (
            <Box flexDirection="row">
              <Button
                key="thread-reply"
                variant="primary"
                label="Write a message"
                onPress={() => {
                  void startCommand($, `/devnull remote ${handleOf(chat.isOrg, chat.target)}`)
                  void pingTyping($)
                }}
              />
            </Box>
          )}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {header}
      {tabs}
      <Box flexDirection="row" columnGap={3} paddingBottom={1}>
        {sections.map(sec => (
          <Button key={`rs-${sec.id}`} plain {...(sec.id === box.section ? {} : { dimColor: true as const })} label={sec.label} onPress={() => void loadInbox($, sec.id)} />
        ))}
      </Box>
      {box.error && <Text color={DANGER}>{box.error}</Text>}
      {box.isLoading && box.rows.length === 0 && skeletons('inbox', 4, 36)}
      {box.isLoading && box.rows.length > 0 && progressBar('inbox-progress')}
      {!box.isLoading && !box.error && box.rows.length === 0 && (
        <Text color={MUTED}>{box.section === 'stashed' ? 'Nothing stashed.' : box.section === 'fetched' ? 'No requests.' : 'No remotes yet. Open someone’s profile to start one.'}</Text>
      )}
      {box.rows.map(inboxRow)}
      {box.hasMore && (
        <Box flexDirection="row" justifyContent="center" paddingY={1}>
          {box.isLoading ? busy('rm-loading', 'Loading more') : <Button key="rm-more" label="Load more" onPress={() => void loadInbox($, undefined, true)} />}
        </Box>
      )}
    </Box>
  )
}

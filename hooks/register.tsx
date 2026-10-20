import type { Register } from 'claude-code'

import { finish, logout, poll, startLogin, syncLogin, type Pending } from './login'
import { openPane, registerPane } from './pane'
import { registerPresses } from './presses'
import { resumeThread, sendFromPrompt } from './remotes'
import { offerFromPrompt, registerShip, reviseDraft, startDraft } from './ship'
import { refresh } from './feed'
import { checkRemotes } from './me'
import { loadStats, registerStreaks, startStreaks } from './streaks'
import { registerTools, startTools } from './tools'
import { loadFollowing, registerTranscript, showCommit } from './transcript'
import { LOGIN_WINDOW_MS, PANE } from './state'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'devnull',
      description: 'Open the /dev/null pane (log + notifications)',
      argumentHint: '[post <text> | ship [--full] [focus] | draft [--full] [focus] | revise <changes> | remote @user <message> | show <link> | login | logout]',
    })
    await syncLogin($)
    // The people you follow seed @ completion; in the background, so startup never waits on dev-null.sh.
    void loadFollowing($).catch(() => {})
    // Each feature's own session setup; one session.start hook, as the engine allows one unmatched hook per event.
    await startTools($)
    // Background polling is for a person at the prompt: a -p run or the SDK gets the tools and nothing ticking.
    if (e.isInteractive) {
      const pending = (await $.store.get('pending')) as Pending | undefined
      if (pending && (await $.clock.now()) - pending.startedAt < LOGIN_WINDOW_MS) poll($, pending)
      await startStreaks($)
      await resumeThread($)
    }
    return next(e)
  })

  // /clear, /resume and a fork reset the session's state to its defaults without a session.start: the sign-in,
  // the log, the counts and the header are read back from the store and dev-null.sh.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume' || e.source === 'fork') {
      await syncLogin($)
      void loadFollowing($).catch(() => {})
      void checkRemotes($)
      void loadStats($)
      await refresh($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'devnull' }, async ($, e) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    // The post's own text, line breaks kept: everything after the word "post".
    if (sub === 'post') return { text: await offerFromPrompt($, e.args.trim().slice('post'.length).trim()) }
    if (sub === 'remote') return { text: await sendFromPrompt($, e.args.trim().slice('remote'.length)) }
    if (sub === 'revise') return { text: await reviseDraft($, e.args.trim().slice('revise'.length)) }
    if (sub === 'ship') return { text: await startDraft($, 'ship', e.args.trim().slice('ship'.length)) }
    if (sub === 'draft') return { text: await startDraft($, 'session', e.args.trim().slice('draft'.length)) }
    if (sub === 'login') {
      await $.ui.open({ id: PANE, title: '/dev/null' })
      return { text: rest[0] ? await finish($, rest.join('')) : await startLogin($) }
    }
    if (sub === 'logout') return { text: await logout($) }
    if (sub === 'show') return showCommit($, rest.join(' '))
    await openPane($)
    return { text: '/dev/null pane opened.' }
  })

  registerPane(on)
  registerPresses(on)
  registerShip(on)
  registerTools(on)
  registerTranscript(on)
  registerStreaks(on)
}


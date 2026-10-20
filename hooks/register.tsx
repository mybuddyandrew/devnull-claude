import type { Register } from 'claude-code'

import { finish, logout, poll, startLogin, syncLogin, type Pending } from './login'
import { openPane, registerPane } from './pane'
import { resumeThread, sendFromPrompt } from './remotes'
import { draftFromSession, offerFromPrompt, registerShip, reviseDraft } from './ship'
import { registerStreaks, startStreaks } from './streaks'
import { registerTools, startTools } from './tools'
import { loadFollowing, registerTranscript, showCommit } from './transcript'
import { LOGIN_WINDOW_MS, PANE } from './state'

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'devnull',
      description: 'Open the /dev/null pane (log + notifications)',
      argumentHint: '[post <text> | draft [focus] | revise <changes> | remote @user <message> | show <link> | login | logout]',
    })
    await syncLogin($)
    // The people you follow seed @ completion; in the background, so startup never waits on dev-null.sh.
    void loadFollowing($).catch(() => {})
    const pending = (await $.store.get('pending')) as Pending | undefined
    if (pending && Date.now() - pending.startedAt < LOGIN_WINDOW_MS) poll($, pending)
    // Each feature's own session setup; one session.start hook, as the engine allows one unmatched hook per event.
    await startTools($)
    await startStreaks($)
    await resumeThread($)
    return next(e)
  })

  on('command.run', { command: 'devnull' }, async ($, e) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    // The post's own text, line breaks kept: everything after the word "post".
    if (sub === 'post') return { text: await offerFromPrompt($, e.args.trim().slice('post'.length).trim()) }
    if (sub === 'remote') return { text: await sendFromPrompt($, e.args.trim().slice('remote'.length)) }
    if (sub === 'revise') return { text: await reviseDraft($, e.args.trim().slice('revise'.length)) }
    if (sub === 'draft') {
      if (!(await $.store.get('username'))) return { text: 'Not signed in to /dev/null. Run /devnull login first.' }
      void draftFromSession($, e.args.trim().slice('draft'.length))
      return { text: 'Drafting a post about this session. It appears above the prompt to confirm.' }
    }
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
  registerShip(on, options)
  registerTools(on)
  registerTranscript(on)
  registerStreaks(on)
}


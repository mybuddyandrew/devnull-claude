// The /dev/null pane: picks the view (sign-in, log, profile or Remotes) and draws it.
import { atom, read } from 'claude-code'
import type { EngineInterface, On, RenderInput } from 'claude-code'

import { refresh } from './feed'
import { startLogin, syncLogin } from './login'
import { checkRemotes } from './me'
import { commitDrawer } from './pane-commit'
import { drawFeed } from './pane-feed'
import { makeKit } from './pane-kit'
import { drawProfile } from './pane-profile'
import { drawRemotes } from './pane-remotes'
import { registerScroll } from './pane-scroll'
import { drawTop } from './pane-top'
import { DANGER, INITIAL_LOGIN, INITIAL_PROFILE, INITIAL_TAB, MUTED, PANE } from './state'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const login = atom({ plugin: 'devnull', key: 'login' } as const, INITIAL_LOGIN)
const profile = atom({ plugin: 'devnull', key: 'profile' } as const, INITIAL_PROFILE)
const tab = atom({ plugin: 'devnull', key: 'tab' } as const, INITIAL_TAB)

export async function openPane($: EngineInterface) {
  await syncLogin($)
  await checkRemotes($)
  await $.ui.open({ id: PANE, title: '/dev/null' })
  await refresh($)
}

export async function drawPane($: EngineInterface, e: RenderInput) {
  try {
    const kit = await makeKit($, e)
    const { Box, Text, Button } = kit.els
    const who = await read($, login)
    if (who.status !== 'signed-in') {
      return (
        <Box flexDirection="column" paddingY={2} rowGap={1}>
          <Text size="title" weight="bold">
            /dev/null
          </Text>
          <Text color={MUTED}>a social network for devs</Text>
          {who.status === 'waiting' ? (
            <Text color={MUTED}>Approve this device in your browser, then come back here.</Text>
          ) : (
            <Box flexDirection="row">
              <Button key="sign-in" variant="primary" label="Sign in with GitHub" onPress={() => void startLogin($)} />
            </Box>
          )}
          {who.message && <Text color={DANGER}>{who.message}</Text>}
        </Box>
      )
    }

    const person = await read($, profile)
    const commit = await commitDrawer($, kit)
    if (person) return drawProfile($, kit, commit, person)
    const top = await drawTop($, kit)
    if ((await read($, tab)) === 'remotes') return drawRemotes($, kit, top)
    return drawFeed($, kit, top, commit)
  } catch (error) {
    // Drawn as text so a failure shows its reason instead of an empty pane.
    const { Text } = $.ui.resolve(e)
    return <Text color={DANGER}>/dev/null couldn't draw this: {String((error as Error)?.message ?? error)}</Text>
  }
}

// Draws the pane; register.tsx hands this file its `on`.
export function registerPane(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawPane($, e))
  registerScroll(on)
}

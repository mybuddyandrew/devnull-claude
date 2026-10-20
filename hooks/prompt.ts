// Starting a /devnull command in Claude's prompt box from a press in the pane or the band.
import type { EngineInterface } from 'claude-code'

// A /devnull command at the start of the box, with its @person or org: what a new command takes the place of.
const LEADING_COMMAND = /^\/devnull\s+\S+(?:\s+(?:@\S+|org:\S+))?\s*/

// Puts `command` (and `draft`) in the prompt box with what the person had typed kept after it, so a press never
// throws their words away. Says so when no box takes it (a dialog holds the keys, or there is no box).
export async function startCommand($: EngineInterface, command: string, draft = ''): Promise<boolean> {
  const typed = (await $.prompt.read()).text.replace(LEADING_COMMAND, '').trim()
  const rest = [draft.trim(), typed].filter(Boolean).join(' ')
  const filled = await $.prompt.fill({ text: `${command} ${rest}`, mode: 'replace' }).catch(() => undefined)
  if (filled?.isFilled) return true
  $.ui.toast(filled?.refusal === 'dialog' ? '/dev/null: close the open dialog, then try again.' : "/dev/null: couldn't reach the prompt box.")
  return false
}

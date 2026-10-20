// Presses answered by the Button's key from the newest drawing. The desktop can deliver a press aimed at a drawing
// a redraw has just replaced: that drawing's handles are gone ("ui_press not handled" in the app's log), but the
// press still carries the Button's key, and the newest drawing's Button under that key does the same thing.
import type { On, UiPressArgument } from 'claude-code'

type Press = (e: UiPressArgument) => void

// Each drawn site's newest handlers, by Button key; a site is a component and its instance.
const sites = new Map<string, Map<string, Press>>()

// Notes the Buttons a drawing holds and hands the drawing back unchanged.
export function rememberPresses<T>(component: string, requestId: string | undefined, tree: T): T {
  const found = new Map<string, Press>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node === null || typeof node !== 'object') return
    // A drawn Button carries its key in props and its handler beside them.
    const { type, props, children, onPress } = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown; onPress?: unknown }
    if (type === 'Button' && typeof props?.key === 'string' && typeof onPress === 'function') found.set(props.key, onPress as Press)
    walk(children)
  }
  walk(tree)
  sites.set(`${component}:${requestId ?? ''}`, found)
  return tree
}

export function registerPresses(on: On): void {
  on('ui.press', { plugin: 'devnull' }, async ($, e, next) => {
    const press = sites.get(`${e.component}:${e.requestId}`)?.get(e.element)
    if (!press) return next(e)
    press(e)
    return { element: e.element }
  }).catch(($, e, next) => next(e))
}

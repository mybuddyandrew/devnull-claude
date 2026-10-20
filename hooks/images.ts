// Avatars and commit images, fetched and shrunk on this machine and kept as data: URIs for the pane to draw.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { safeImageUrl } from './text'
import { AVATAR_MAX_CHARS, BIN, INITIAL_AVATARS, INITIAL_PICTURES, PICTURE_MAX_CHARS } from './state'

// $.state atoms are declared in each file that reads or writes them, as the engine's scan requires.
const avatars = atom({ plugin: 'devnull', key: 'avatars' } as const, INITIAL_AVATARS)
const pictures = atom({ plugin: 'devnull', key: 'pictures' } as const, INITIAL_PICTURES)

// Avatars arrive as data: URIs so the SVG ring can draw them with no network of its own.
export async function loadAvatars($: EngineInterface, people: [string, string | undefined][]): Promise<void> {
  const have = await read($, avatars)
  const wanted = new Map(people.filter((p): p is [string, string] => !!p[1] && !((have[p[0]]?.length ?? Infinity) <= AVATAR_MAX_CHARS)))
  const queue = [...wanted]
  // Collected, then written once: every write redraws the pane, and a redraw under a click drops the click.
  const got: Record<string, string> = {}
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await fetchAvatar(next)
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  if (Object.keys(got).length > 0) await update($, avatars, a => ({ ...a, ...got }))

  async function fetchAvatar([username, url]: [string, string]): Promise<void> {
    try {
      if (!safeImageUrl(url)) return
      // Every avatar rides inside the drawn tree, which the desktop drops past a few hundred KB:
      // sips shrinks each to a small JPEG (about 2.5 KB of base64).
      const b64 = await fetchJpeg($, url + (url.includes('?') ? '&' : '?') + 's=64', 64, 55, 10)
      if (b64 === '' || b64.length > AVATAR_MAX_CHARS) return
      got[username] = `data:image/jpeg;base64,${b64}`
    } catch {}
  }
}

// Commit images arrive as small JPEG data: URIs (the desktop draws SVG as an image, with no network of its
// own), at most 260px and 16 KB each, a few at a time; any that fail or run larger are left as links.
export async function loadPictures($: EngineInterface, urls: readonly string[]): Promise<void> {
  const have = await read($, pictures)
  const queue = [...new Set(urls)].filter(u => safeImageUrl(u) && have[u] === undefined)
  // Collected, then written once, as avatars are.
  const got: Record<string, string> = {}
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) await fetchPicture(url)
  }
  await Promise.all([worker(), worker(), worker()])
  if (Object.keys(got).length > 0) await update($, pictures, p => ({ ...p, ...got }))

  async function fetchPicture(url: string): Promise<void> {
    try {
      const b64 = await fetchJpeg($, url, 260, 45, 15)
      // An empty string marks one that failed or ran too large, so it isn't fetched again this session.
      got[url] = b64 !== '' && b64.length <= PICTURE_MAX_CHARS ? `data:image/jpeg;base64,${b64}` : ''
    } catch {}
  }
}

// Fetches one image over https only (redirects included, at most 3), up to 5 MB, and returns it shrunk to a JPEG
// no wider or taller than `size`, as base64; '' when anything fails.
async function fetchJpeg($: EngineInterface, url: string, size: number, quality: number, seconds: number): Promise<string> {
  const script = [
    't=$(/usr/bin/mktemp) || exit 1',
    `/usr/bin/curl -sfL --proto =https --proto-redir =https --max-redirs 3 --max-filesize 5000000 --max-time ${seconds} -o "$t" -- "$1"` +
      ` && /usr/bin/sips -s format jpeg -s formatOptions ${quality} -Z ${size} "$t" --out "$t.jpg" >/dev/null 2>&1` +
      ' && /usr/bin/base64 < "$t.jpg"',
    's=$?; /bin/rm -f "$t" "$t.jpg"; exit $s',
  ].join('\n')
  const out = await $.process.run([BIN.sh, '-c', script, 'sh', url], { timeoutMs: (seconds + 15) * 1000 })
  return out.exitCode === 0 ? out.stdout.replace(/\s+/g, '') : ''
}

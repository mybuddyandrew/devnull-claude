// The pane's drawings: avatars, lanes, images and loaders, as SVG source.

// A ringed avatar, the image clipped to a circle; the initial until the image arrives.
export const avatarSvg = (lane: string, size: number, dataUri?: string, initial = '?'): string => {
  const c = size / 2
  const inner = c - 4
  const face = dataUri
    ? `<clipPath id="a"><circle cx="${c}" cy="${c}" r="${inner}"/></clipPath><image href="${dataUri}" x="4" y="4" width="${size - 8}" height="${size - 8}" clip-path="url(#a)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="${c}" cy="${c}" r="${inner}" fill="#232326"/><text x="${c}" y="${c}" dy="0.35em" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="${Math.round(size * 0.36)}" fill="#ececec">${escapeXml(initial.slice(0, 1).toUpperCase())}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${face}<circle cx="${c}" cy="${c}" r="${c - 1.5}" fill="none" stroke="${lane}" stroke-width="2.5"/></svg>`
}

// The lane's tail under an avatar, fading out: the graph's colour without a row-tall rail.
export const TAIL_HEIGHT = 44

export const tailSvg = (lane: string, width: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${TAIL_HEIGHT}" viewBox="0 0 ${width} ${TAIL_HEIGHT}"><defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${lane}"/><stop offset="1" stop-color="${lane}" stop-opacity="0"/></linearGradient></defs><rect x="${width / 2 - 1}" y="0" width="2" height="${TAIL_HEIGHT}" fill="url(#t)"/></svg>`

// The active tab's underline.
export const underlineSvg = (width: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="3" viewBox="0 0 ${width} 3"><rect width="${width}" height="3" rx="1.5" fill="#7aa2f7"/></svg>`

const escapeXml = (s: string): string => s.replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[ch] ?? ch)

// A commit image drawn inline: its small JPEG in a rounded frame at the image's own shape, at most `max` px wide.
export const pictureSvg = (dataUri: string, width: number, height: number, max = 260): { source: string; width: number; height: number } => {
  const w = Math.max(1, Math.min(max, width || max))
  const h = Math.max(1, Math.round(width && height ? (w * height) / width : w * 0.75))
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><clipPath id="p"><rect width="${w}" height="${h}" rx="8"/></clipPath><image href="${dataUri}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#p)"/><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="8" fill="none" stroke="#2a2a2d"/></svg>`,
    width: w,
    height: h,
  }
}

// Loaders, drawn as small animated SVGs (SMIL, which the desktop runs when the Svg is interactive).
// The pulse and sweep are slow and quiet, like the web's own skeletons.
const PULSE = '<animate attributeName="opacity" values="0.35;0.75;0.35" dur="1.4s" repeatCount="indefinite"/>'

// A placeholder for one row while its list loads: an avatar and three lines of text.
export const skeletonSvg = (width = 480, avatar = 40): { source: string; width: number; height: number } => {
  const x = avatar + 16
  const w = Math.max(80, width - x)
  const bar = (y: number, frac: number, h = 10) => `<rect x="${x}" y="${y}" width="${Math.round(w * frac)}" height="${h}" rx="${h / 2}" fill="#3a3a3e"/>`
  const height = Math.max(avatar, 62)
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g>${PULSE}<circle cx="${avatar / 2}" cy="${avatar / 2}" r="${avatar / 2}" fill="#3a3a3e"/>${bar(4, 0.35, 12)}${bar(26, 0.9)}${bar(44, 0.6)}</g></svg>`,
    width,
    height,
  }
}

// A thin bar sweeping across the top while a list refreshes over what's already shown.
export const progressSvg = (width: number, color: string): { source: string; width: number; height: number } => {
  const seg = Math.round(width * 0.3)
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="2" viewBox="0 0 ${width} 2"><rect width="${width}" height="2" fill="${color}" fill-opacity="0.15"/><rect x="${-seg}" width="${seg}" height="2" rx="1" fill="${color}"><animate attributeName="x" from="${-seg}" to="${width}" dur="1.1s" repeatCount="indefinite"/></rect></svg>`,
    width,
    height: 2,
  }
}

// A small spinning arc beside a button's label.
export const spinnerSvg = (size: number, color: string): string => {
  const c = size / 2
  const r = c - 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-opacity="0.2" stroke-width="2"/><path d="M${c} ${c - r} A${r} ${r} 0 0 1 ${c + r} ${c}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 ${c} ${c}" to="360 ${c} ${c}" dur="0.8s" repeatCount="indefinite"/></path></svg>`
}

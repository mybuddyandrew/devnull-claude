// Signing and sign-in, with no engine: request targets, the signed message, PKCE and the callback link.
// Mirrors App\Devnull\Client and RequestSigner in nativephp/dev-null-app.

export const BASE_URL = 'https://dev-null.sh'

export const NAMESPACE = 'devnull-api'

export const REDIRECT_URI = 'devnull://auth/callback'

// PHP's http_build_query with PHP_QUERY_RFC3986: encodeURIComponent plus !'()*.
export const rfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())

export const query = (params: Record<string, string | null | undefined>): string =>
  Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== undefined && entry[1] !== '')
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join('&')

// The request target as the server sees it: path plus query, exactly as sent.
export const target = (path: string, params: Record<string, string | null | undefined> = {}): string => {
  const qs = query(params)
  return '/api/v1/' + path + (qs === '' ? '' : '?' + qs)
}

export const signingMessage = (timestamp: string, nonce: string, method: string, tgt: string, body: string): string =>
  [timestamp, nonce, method.toUpperCase(), tgt, body].join('\n')

// ssh-keygen -Y sign writes an armored SSHSIG; devnull wants the base64 on one line.
export const unarmor = (armored: string): string =>
  armored
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('-----'))
    .join('')

export const hex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

export const base64Url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n))

export const challenge = async (verifier: string): Promise<string> =>
  base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))

export const authorizeUrl = (p: { fingerprint: string; deviceName: string; challenge: string; state: string }): string =>
  `${BASE_URL}/mobile/authorize?` +
  query({
    fingerprint: p.fingerprint,
    device_name: p.deviceName,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
    redirect_uri: REDIRECT_URI,
  })

// devnull://auth/callback?code=...&state=... (or ?error=access_denied&state=...)
// A malformed escape is skipped rather than thrown.
export const parseCallback = (url: string): { code?: string; state?: string; error?: string } => {
  const qs = url.trim().split('?')[1] ?? ''
  const out: Record<string, string> = {}
  for (const pair of qs.split('&')) {
    const [k, v = ''] = pair.split('=')
    try {
      if (k) out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '))
    } catch {}
  }
  return { code: out.code, state: out.state, error: out.error }
}

// `256 SHA256:abc... comment (ED25519)` → `SHA256:abc...`
export const fingerprintOf = (keygenLine: string): string => keygenLine.trim().split(/\s+/)[1] ?? ''

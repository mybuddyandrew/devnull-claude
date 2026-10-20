// Reading dev-null.sh's JSON without trusting its shape: each helper answers a safe default.
export type Json = Record<string, unknown>

export const obj = (v: unknown): Json => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})

// A non-blank string, or undefined.
export const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)

// A count: a positive number, or 0.
export const count = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0)

// Any finite number, or undefined.
export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

// The objects in an array, anything else dropped.
export const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(x => x !== null && typeof x === 'object').map(obj) : [])

// The `data` array of a list response.
export const dataList = (json: unknown): Json[] => list(obj(json).data)

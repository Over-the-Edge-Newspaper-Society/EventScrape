import { ConvexHttpClient } from 'convex/browser'
import { makeFunctionReference } from 'convex/server'

// Base URL for the (self-hosted) Convex backend. Falls back to the local dev
// instance when VITE_CONVEX_URL is not provided.
const url = import.meta.env.VITE_CONVEX_URL || 'http://127.0.0.1:3210'

export const convex = new ConvexHttpClient(url)

type AnyArgs = Record<string, any>

export async function runQuery<T = any>(name: string, args: AnyArgs = {}): Promise<T> {
  const ref = makeFunctionReference<'query'>(name)
  return (await convex.query(ref, args as any)) as T
}

export async function runMutation<T = any>(name: string, args: AnyArgs = {}): Promise<T> {
  const ref = makeFunctionReference<'mutation'>(name)
  return (await convex.mutation(ref, args as any)) as T
}

export async function runAction<T = any>(name: string, args: AnyArgs = {}): Promise<T> {
  const ref = makeFunctionReference<'action'>(name)
  return (await convex.action(ref, args as any)) as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Recursively walk objects/arrays and, for any plain object that has a string
 * `_id`, add an `id` alias (unless `id` is already present). This bridges
 * Convex's `_id` documents to the admin components' `.id` usage. Timestamps are
 * left as numbers — components consume them via `new Date(x)`, which accepts ms.
 */
export function normalizeIds<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeIds(item)) as unknown as T
  }

  if (isPlainObject(value)) {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      out[key] = normalizeIds(val)
    }
    if (typeof out._id === 'string' && out.id === undefined) {
      out.id = out._id
    }
    return out as unknown as T
  }

  return value
}

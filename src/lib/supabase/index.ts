import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Client-side Supabase (for client components that need direct access)
// Most data access goes through API routes, but some features need client-side Supabase
export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null

export type TableChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

export interface TableChangePayload<T> {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: T | Record<string, never>
  old: Partial<T> | Record<string, never>
}

export interface SubscribeToTableOptions {
  /** Which change events to listen for. Defaults to all. */
  event?: TableChangeEvent
  /** PostgREST filter applied server-side, e.g. `organization_id=eq.${orgId}`. */
  filter?: string
  /** Postgres schema. Defaults to `public`. */
  schema?: string
}

/**
 * Subscribe to row-level changes on a table.
 *
 * Returns the channel so the caller can unsubscribe, or `null` when Supabase is
 * not configured. Note the change handler belongs on `.on()`; `.subscribe()`
 * only reports the connection status of the channel itself.
 */
export function subscribeToTable<T>(
  table: string,
  callback: (payload: TableChangePayload<T>) => void,
  options: SubscribeToTableOptions = {},
) {
  if (!supabase) return null

  const { event = '*', filter, schema = 'public' } = options

  return supabase
    .channel(`${schema}:${table}${filter ? `:${filter}` : ''}`)
    .on(
      'postgres_changes',
      { event, schema, table, ...(filter ? { filter } : {}) } as any,
      (payload: any) => {
        callback({
          eventType: payload.eventType,
          new: payload.new ?? {},
          old: payload.old ?? {},
        })
      },
    )
    .subscribe()
}

export default supabase
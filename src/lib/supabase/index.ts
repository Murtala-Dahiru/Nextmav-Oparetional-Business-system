import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Client-side Supabase (for client components that need direct access)
// Most data access goes through API routes, but some features need client-side Supabase
export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null

// Realtime subscription helper
export async function subscribeToTable<T>(
  table: string,
  filter?: (query: string, client: any) => void,
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*' = '*',
  callback?: (payload: { new: T[]; old: T[] } ) => void,
) {
  if (!supabase) return
  
  const channel = supabase
    .channel(table)
    .on('postgres_changes', { event, schema: 'public', table, filter: event === '*' ? undefined : event })
    .subscribe((payload: { new: any[]; old: any[] }) => {
      callback?.(payload as { new: T[]; old: T[] })
    })
  
  return channel
}

export default supabase
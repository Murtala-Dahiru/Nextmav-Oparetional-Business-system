import { supabaseServer } from '@/lib/supabase/server';
import { success } from '@/lib/api-response';

/**
 * Sign out.
 *
 * Always reports success. If revocation fails the local session cookies are
 * still cleared by the SSR client, and leaving someone on a dashboard they
 * believe they have left is worse than a redundant redirect.
 */
export async function POST() {
  try {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  } catch {
    // Fall through — the client clears local state regardless.
  }
  return success({ message: 'Signed out' });
}

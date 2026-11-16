import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { authenticate, getContext } from '@/lib/auth-context';
import { normalizeRole, roleLabel } from '@/lib/permissions';

async function selectWorkspace(form: FormData) {
  'use server';
  const active = await authenticate();
  const target = await getContext(String(form.get('workspace') ?? ''));
  if (active instanceof Response || !target || target.user.mustChangePassword ||
      active.user.id !== target.user.id || target.user.id !== form.get('account') || target.org.role !== form.get('role')) {
    redirect('/settings/workspaces?unavailable=1');
  }
  (await cookies()).set('nm-organization', target.user.id + ':' + target.org.organizationId, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/',
  });
  redirect('/dashboard');
}

export default async function Workspaces({ searchParams }: { searchParams: Promise<{ unavailable?: string }> }) {
  const ctx = await authenticate();
  if (ctx instanceof Response) return <main className="p-6">Sign in with an active workspace membership to switch workspaces.</main>;
  const { data, error } = await ctx.supabase.from('organization_members')
    .select('organization_id, role, organizations!organization_members_organization_id_fkey(name)')
    .eq('user_id', ctx.user.id).eq('is_active', true).is('deleted_at', null).order('joined_at');
  return <main className="mx-auto max-w-lg space-y-4 p-6">
    <Link href="/settings" className="underline">Back to Settings</Link>
    <h1 className="text-xl font-semibold">Your workspaces</h1>
    {(error || (await searchParams).unavailable) && <p role="alert">The workspace could not be selected. Check your current memberships below.</p>}
    {data?.map(row => {
      const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      const current = row.organization_id === ctx.org.organizationId;
      return <form key={row.organization_id} action={selectWorkspace} className="flex items-center justify-between rounded-xl border p-4">
        <span>{org?.name} · {roleLabel(normalizeRole(row.role))}</span>
        <input type="hidden" name="account" value={ctx.user.id} />
        <input type="hidden" name="role" value={normalizeRole(row.role)} />
        <input type="hidden" name="workspace" value={row.organization_id} />
        <button className="rounded border px-3 py-1.5" disabled={current}>{current ? 'Current' : 'Switch workspace'}</button>
      </form>;
    })}
  </main>;
}

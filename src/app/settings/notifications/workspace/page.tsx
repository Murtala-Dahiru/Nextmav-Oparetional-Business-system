import Link from 'next/link';
import { authenticate, getContext } from '@/lib/auth-context';
import { roleLabel } from '@/lib/permissions';

export default async function NotificationWorkspace({ searchParams }: {
  searchParams: Promise<{ id?: string; organizationId?: string }>;
}) {
  const { id, organizationId } = await searchParams;
  const active = await authenticate();
  const target = organizationId ? await getContext(organizationId) : null;
  if (active instanceof Response || !target || active.user.id !== target.user.id || !id || !/^\d+$/.test(id)) {
    return <main className="p-6">This notification is unavailable. <Link href="/dashboard">Return to workspace</Link></main>;
  }
  const query = new URLSearchParams({ id, organizationId: target.org.organizationId });
  return <main className="mx-auto max-w-lg space-y-5 p-6">
    <h1 className="text-xl font-semibold">Open in another workspace?</h1>
    <p>You are in {active.org.organizationName} as {roleLabel(active.org.role)}.
      {' '}This notification is in {target.org.organizationName}, where your role is {roleLabel(target.org.role)}.</p>
    <form action={'/api/notifications/open?' + query} method="post" className="flex flex-wrap items-center gap-4">
      <input type="hidden" name="role" value={target.org.role} />
      <input type="hidden" name="account" value={active.user.id} />
      <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Switch workspace and open</button>
      <Link href="/dashboard" className="underline">Stay in current workspace</Link>
    </form>
  </main>;
}

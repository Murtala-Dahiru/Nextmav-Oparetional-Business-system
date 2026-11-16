import Link from 'next/link';
import { notFound } from 'next/navigation';
import { authorize } from '@/lib/auth-context';

export default async function OwnExpense({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) notFound();
  const { id } = await params;
  const { data, error } = await ctx.supabase.from('expenses').select('title,status')
    .eq('organization_id',ctx.org.organizationId).eq('submitted_by',ctx.org.memberId)
    .eq('id',id).is('deleted_at',null).maybeSingle();
  if (error) throw new Error('Could not load the expense.');
  if (!data) notFound();
  return <main className="mx-auto max-w-lg space-y-4 p-6">
    <Link className="underline" href="/settings/notifications">Notification history</Link>
    <h1 className="text-xl font-semibold">{data.title}</h1>
    <p>Expense status · {data.status}</p>
  </main>;
}

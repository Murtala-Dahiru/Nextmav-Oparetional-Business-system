import { Bell, MessageSquare, ListTodo, Users, Target, FileText, PenLine, Wallet, LifeBuoy } from 'lucide-react';
import { categoryOf } from '@/lib/notifications/model';
export function NotificationCategoryIcon({ type }: { type: string }) {
  const category = categoryOf(type);
  const Icon = { communication: MessageSquare, projects: ListTodo, hr: Users, crm: Target,
    commercial: FileText, sign: PenLine, finance: Wallet, support: LifeBuoy, system: Bell }[category];
  return <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
    <Icon role="img" aria-label={category} className="size-4" />
  </span>;
}

import { Bell, MessageSquare, ListTodo, Users, Target, FileText, PenLine, Wallet, LifeBuoy } from 'lucide-react';
import { categoryOf } from '@/lib/notifications/model';
export function NotificationCategoryIcon({ type }: { type: string }) {
  const category = categoryOf(type);
  const Icon = { communication: MessageSquare, projects: ListTodo, hr: Users, crm: Target,
    commercial: FileText, sign: PenLine, finance: Wallet, support: LifeBuoy, system: Bell }[category];
  return <Icon aria-label={category} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

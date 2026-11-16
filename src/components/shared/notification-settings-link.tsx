import Link from 'next/link';
import { Bell, ChevronRight } from 'lucide-react';

export function NotificationSettingsLink() {
  return (
    <Link href="/settings/notifications" className="flex items-center gap-3 rounded-xl border bg-card p-4 text-card-foreground hover:bg-muted focus-visible:outline-2">
      <Bell aria-hidden="true" className="size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">Notifications</span>
        <span className="block text-sm text-muted-foreground">Manage your alerts, previews and connected devices.</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
    </Link>
  );
}

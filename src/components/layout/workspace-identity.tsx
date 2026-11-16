'use client';

import { Building2 } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Organization context, distinct from the permanent NextMav product mark.
 * This is not a switcher: the current session has no organization-switch API.
 */
export function WorkspaceIdentity({ collapsed }: { collapsed: boolean }) {
  const name = useAppStore(s => s.user?.organizationName?.trim());
  if (!name) return null;

  const identity = (
    <div className="nm-workspace" data-collapsed={collapsed} tabIndex={collapsed ? 0 : undefined} aria-label={`Current workspace: ${name}`}>
      <span className="nm-workspace-icon"><Building2 size={17} strokeWidth={1.7} aria-hidden="true" /></span>
      {!collapsed && <span className="min-w-0"><span className="nm-workspace-label">Workspace</span><span className="block truncate text-[13px] font-medium">{name}</span></span>}
    </div>
  );
  return collapsed ? <Tooltip><TooltipTrigger asChild>{identity}</TooltipTrigger><TooltipContent side="right">{name}</TooltipContent></Tooltip> : identity;
}

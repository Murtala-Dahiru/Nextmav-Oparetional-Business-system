import * as React from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PageHeaderProps {
  /** Page title displayed prominently */
  title: string;
  /** Optional subtitle / description below the title */
  description?: string;
  /** Right-side action buttons / controls */
  children?: React.ReactNode;
  /** Optional Lucide icon rendered before the title */
  icon?: React.ElementType;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  children,
  icon: Icon,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 py-1 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      {/* Left side: icon + title + description */}
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="bg-emerald-500/10 text-emerald-600 flex size-9 shrink-0 items-center justify-center rounded-lg">
            <Icon className="size-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight text-foreground truncate">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      </div>

      {/* Right side: actions */}
      {children && <div className="flex items-center gap-2 shrink-0 mt-2 sm:mt-0">{children}</div>}
    </div>
  );
}
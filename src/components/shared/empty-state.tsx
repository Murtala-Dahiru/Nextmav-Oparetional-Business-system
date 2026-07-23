import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps {
  /** Optional Lucide icon rendered above the title */
  icon?: React.ElementType;
  /** Title text */
  title: string;
  /** Optional description text */
  description?: string;
  /** Optional action button */
  action?: EmptyStateAction;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-12 px-4 text-center',
        className,
      )}
    >
      {Icon && (
        <div className="bg-muted flex size-14 items-center justify-center rounded-full">
          <Icon className="text-muted-foreground size-7" />
        </div>
      )}
      <h3 className="text-foreground text-base font-semibold">{title}</h3>
      {description && (
        <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
      )}
      {action && (
        <Button
          onClick={action.onClick}
          className="mt-1 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
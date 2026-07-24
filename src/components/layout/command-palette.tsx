'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  BookOpen,
  MessageSquare,
  LifeBuoy,
  UserCog,
  DollarSign,
  Package,
  Calendar,
  Settings,
  Search,
  LogOut,
  User,
  ArrowRight,
  Hexagon,
  FileText,
  CreditCard,
  HelpCircle,
  Shield,
  KeyRound,
  Bell,
  Moon,
  Sun,
  Globe,
  Palette,
  Keyboard,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useAppStore } from '@/store/app-store';
import { MODULES, type ModuleId } from '@/lib/constants';
import { cn } from '@/lib/utils';

const moduleIcons: Record<string, React.ElementType> = {
  LayoutDashboard, Users, FolderKanban, BookOpen, MessageSquare,
  LifeBuoy, UserCog, DollarSign, Package, Calendar, Settings,
};

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const { activeModule, setActiveModule, setSearchOpen, logout, setSidebarCollapsed, visibleModules } = useAppStore();

  // The palette is a navigation surface like any other: it must only offer
  // modules this role can actually open.
  const allowedModuleIds = new Set(visibleModules());
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  // Keyboard shortcut: Ctrl+K or Cmd+K
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  // Also listen to the store's searchOpen
  React.useEffect(() => {
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.searchOpen && !prev.searchOpen) setOpen(true);
      if (!state.searchOpen && prev.searchOpen) setOpen(false);
    });
    return unsub;
  }, []);

  const handleClose = React.useCallback((open: boolean) => {
    setOpen(open);
    if (!open) setSearchOpen(false);
  }, [setSearchOpen]);

  const runCommand = React.useCallback((command: () => void) => {
    setOpen(false);
    command();
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={handleClose}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Navigation */}
        <CommandGroup heading="Navigation">
          {MODULES.filter((m) => allowedModuleIds.has(m.id)).map((mod) => {
            const Icon = moduleIcons[mod.icon] || LayoutDashboard;
            const isActive = activeModule === mod.id;
            return (
              <CommandItem
                key={mod.id}
                onSelect={() => runCommand(() => setActiveModule(mod.id))}
                className={cn(isActive && 'bg-accent')}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{mod.label}</span>
                {isActive && <span className="ml-auto text-xs text-muted-foreground">Current</span>}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        {/* Pages */}
        <CommandGroup heading="Pages">
          <CommandItem onSelect={() => runCommand(() => router.push('/pricing'))}>
            <CreditCard className="mr-2 h-4 w-4" />
            <span>Pricing</span>
            <CommandShortcut>→ Pricing</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push('/features'))}>
            <FileText className="mr-2 h-4 w-4" />
            <span>Features</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push('/help'))}>
            <HelpCircle className="mr-2 h-4 w-4" />
            <span>Help Center</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push('/docs'))}>
            <FileText className="mr-2 h-4 w-4" />
            <span>Documentation</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push('/status'))}>
            <Shield className="mr-2 h-4 w-4" />
            <span>Status Page</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Actions */}
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => runCommand(() => setSidebarCollapsed(!useAppStore.getState().sidebarCollapsed))}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            <span>Toggle Sidebar</span>
            <CommandShortcut>[</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => setTheme(theme === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
            <span>Toggle Theme</span>
            <CommandShortcut>⇧D</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Account */}
        <CommandGroup heading="Account">
          <CommandItem onSelect={() => runCommand(() => router.push('/login'))}>
            <User className="mr-2 h-4 w-4" />
            <span>Profile</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => logout())}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Log out</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
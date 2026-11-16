import {
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  CalendarDays,
  BookOpen,
  Users,
  LifeBuoy,
  Building2,
  FolderKanban,
  Wallet,
  UserCog,
  Package,
  Settings2,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { MODULES, type ModuleId, type RoleId } from '@/lib/constants';
import { isExternalRole } from '@/lib/permissions';

/**
 * Presentation-only navigation registry shared by the sidebar and palette.
 * Groups describe the work: customers & revenue, operations, people & finance,
 * and platform configuration. The server-resolved capability set remains the
 * authority; navigationFor can only remove from that set, never add to it.
 */

export interface ModuleMeta {
  /** The mark, resolved here rather than by name in each consumer. */
  icon: LucideIcon;
  /**
   * What the module is, in one line.
   *
   * Written from what each module actually contains — its own tabs — so it
   * describes the product rather than an aspiration. Used by the collapsed
   * rail's tooltips and by the command palette, where a label alone is often
   * not enough to tell "Workspace" from "My Work".
   */
  summary: string;
}

/**
 * Typed as a total record on purpose: adding a module to `MODULES` without
 * describing it here is a compile error, rather than a row that renders with
 * a fallback icon and no explanation.
 *
 * That was not hypothetical. The sidebar carried its own name→component map
 * with no entry for `CheckSquare` or `Building2`, so My Work and Client
 * Portal — two of the thirteen — both drew the dashboard's icon.
 */
export const MODULE_META: Record<ModuleId, ModuleMeta> = {
  dashboard: {
    icon: LayoutDashboard,
    summary: 'Where the business stands, and what needs attention today',
  },
  mywork: {
    icon: ListChecks,
    summary: 'Your own to-do list, notes and focus sessions',
  },
  communication: {
    icon: MessagesSquare,
    summary: 'Channels, direct messages and meetings',
  },
  calendar: {
    icon: CalendarDays,
    summary: 'Events, schedules and deadlines',
  },
  workspace: {
    icon: BookOpen,
    summary: 'Shared pages, files and sheets',
  },
  crm: {
    icon: Users,
    summary: 'Leads, contacts, companies, deals and the pipeline',
  },
  support: {
    icon: LifeBuoy,
    summary: 'Customer tickets and the knowledge base',
  },
  portal: {
    icon: Building2,
    summary: 'What your clients see: their projects, invoices and tickets',
  },
  projects: {
    icon: FolderKanban,
    summary: 'Projects, tasks and delivery milestones',
  },
  finance: {
    icon: Wallet,
    summary: 'Invoices, expenses and purchase approvals',
  },
  performance: {
    icon: Target,
    summary: "Targets, achievement and what it earns",
  },
  hr: {
    icon: UserCog,
    summary: 'People, leave, attendance, cases and payroll',
  },
  inventory: {
    icon: Package,
    summary: 'Products, warehouses, suppliers and stock movements',
  },
  admin: {
    icon: Settings2,
    summary: 'Users, roles, workplace settings and the audit log',
  },
};

interface NavGroupSpec {
  id: string;
  /**
   * `null` for the first group, which carries no heading.
   *
   * The two most-opened screens in the product should not have to be read
   * past a label to be found, and an unlabelled block at the top is what
   * gives the labelled ones below it something to be distinct from. Five
   * headings with no exception is a wall.
   */
  label: string | null;
  modules: ModuleId[];
}

const NAV_GROUPS: NavGroupSpec[] = [
  { id: 'overview', label: 'Executive Overview', modules: ['dashboard'] },
  { id: 'personal', label: 'My Work', modules: ['mywork'] },
  { id: 'customers', label: 'Customers & revenue', modules: ['crm', 'support', 'portal'] },
  { id: 'operations', label: 'Operations', modules: ['projects', 'inventory', 'workspace', 'calendar'] },
  { id: 'people', label: 'People & finance', modules: ['hr', 'performance', 'finance'] },
  { id: 'collaboration', label: 'Collaboration', modules: ['communication'] },
  { id: 'administration', label: 'Platform', modules: ['admin'] },
];

export interface NavItem {
  id: ModuleId;
  label: string;
  icon: LucideIcon;
  summary: string;
}

export interface NavSection {
  id: string;
  label: string | null;
  items: NavItem[];
}

const LABELS: Record<string, string> = Object.fromEntries(
  MODULES.map(m => [m.id, m.label]),
);

function toItem(id: ModuleId): NavItem {
  const meta = MODULE_META[id];
  return { id, label: LABELS[id] ?? id, icon: meta.icon, summary: meta.summary };
}

/**
 * The navigation for one person, in the order it should be rendered.
 *
 * Groups left with nothing in them are dropped entirely, which is what keeps
 * a finance clerk's sidebar from carrying an "Administration" heading with no
 * rows beneath it.
 *
 * External roles get a flat list and no headings. A client sees three items;
 * grouping three items is noise, and the headings themselves — "Operations",
 * "Administration" — describe a company the client does not work at.
 */
export function navigationFor(
  allowed: readonly ModuleId[],
  role: RoleId,
): NavSection[] {
  const permitted = new Set(allowed);

  if (isExternalRole(role)) {
    const items = MODULES.filter(m => permitted.has(m.id)).map(m => toItem(m.id));
    return items.length ? [{ id: 'portal', label: null, items }] : [];
  }

  const sections: NavSection[] = [];
  const placed = new Set<ModuleId>();

  for (const group of NAV_GROUPS) {
    const items = group.modules.filter(id => permitted.has(id));
    items.forEach(id => placed.add(id));
    if (items.length) {
      sections.push({ id: group.id, label: group.label, items: items.map(toItem) });
    }
  }

  /**
   * Anything permitted but ungrouped, rather than nothing.
   *
   * A module added to `MODULES` and to a role's grants but forgotten here
   * would otherwise be unreachable from the sidebar while appearing to exist
   * everywhere else — the quietest possible way to ship a feature nobody can
   * find. This makes that mistake visible instead of invisible.
   */
  const orphans = MODULES.map(m => m.id).filter(
    id => permitted.has(id) && !placed.has(id),
  );
  if (orphans.length) {
    sections.push({ id: 'other', label: 'More', items: orphans.map(toItem) });
  }

  return sections;
}

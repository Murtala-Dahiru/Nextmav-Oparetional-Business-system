import { MODULES, ROLES, type ModuleId, type RoleId } from '@/lib/constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Capability model — the single source of truth for "who may do what".
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Before this existed the platform carried three unreconciled role
 * vocabularies (`RoleId` in constants, `role-admin|manager|user` rows in the
 * Role table, and `super_admin|employee` from the session), and the only one
 * that affected the UI was a client-side switcher the user could set
 * themselves. Every module therefore had to guess at its own access rules,
 * which is why they behaved like separate applications.
 *
 * Everything now derives from this file: server-side route enforcement,
 * navigation, dashboard composition, and record-level filtering. A role is
 * resolved on the server from the session and is never accepted from the
 * client.
 */

// ─── Actions ───────────────────────────────────────────────────────────────

/**
 * `approve` is deliberately distinct from `edit`: authorising someone else's
 * leave, expense or purchase order is a different responsibility from editing
 * a record, and most roles have one without the other.
 */
export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage'] as const;
export type Action = (typeof ACTIONS)[number];

// ─── Data scope ────────────────────────────────────────────────────────────

/**
 * How much of a module's data a role may see. This is what keeps "HR data
 * inside HR" real rather than aspirational — an employee with `view` on HR
 * still only ever resolves their own records.
 *
 *   own          — records where the user is owner/assignee/subject
 *   department   — records belonging to the user's department
 *   organization — everything in the company workspace
 */
export const SCOPES = ['own', 'department', 'organization'] as const;
export type Scope = (typeof SCOPES)[number];

const SCOPE_RANK: Record<Scope, number> = { own: 0, department: 1, organization: 2 };

export interface Grant {
  actions: readonly Action[];
  scope: Scope;
}

export type RoleGrants = Partial<Record<ModuleId, Grant>>;

// ─── Shorthands ────────────────────────────────────────────────────────────

const FULL: readonly Action[] = ['view', 'create', 'edit', 'delete', 'approve', 'export', 'manage'];
const WRITE: readonly Action[] = ['view', 'create', 'edit', 'export'];
const READ: readonly Action[] = ['view'];

/** Everyone who works here gets these, regardless of function. */
function baseWorkplaceGrants(): RoleGrants {
  return {
    dashboard: { actions: READ, scope: 'own' },
    /**
     * Your own to-do list.
     *
     * Full rights at `own` scope for every internal role, because there is
     * nothing here to restrict: the records are private by construction and
     * the RLS policy admits only their owner. A role that could not create
     * its own to-dos would simply have a broken screen.
     */
    mywork: { actions: FULL, scope: 'own' },
    // Own tasks and the projects they are assigned to.
    projects: { actions: ['view', 'edit'], scope: 'own' },
    workspace: { actions: WRITE, scope: 'organization' },
    communication: { actions: WRITE, scope: 'organization' },
    calendar: { actions: WRITE, scope: 'own' },
    // Self-service only: own attendance, own leave, own documents.
    hr: { actions: ['view', 'create'], scope: 'own' },
    /**
     * Your own numbers, and what they earned.
     *
     * `view` only, at `own` scope. A person reads their targets, their
     * achievement against them and their own incentive entries, and changes
     * none of it. Not being able to set your own target is the entire reason
     * this is not `edit`, and the reason every other grant below is narrower
     * than it first looks.
     */
    performance: { actions: READ, scope: 'own' },
  };
}

// ─── Role → capability map ─────────────────────────────────────────────────

export const ROLE_GRANTS: Record<RoleId, RoleGrants> = {
  owner: Object.fromEntries(
    MODULES.map(m => [m.id, { actions: FULL, scope: 'organization' as Scope }]),
  ) as RoleGrants,

  administrator: Object.fromEntries(
    MODULES.map(m => [m.id, { actions: FULL, scope: 'organization' as Scope }]),
  ) as RoleGrants,

  /**
   * A department manager runs a team, not the company. They see their
   * department across the operational modules and approve for their people,
   * but finance is read-only and admin is closed.
   */
  manager: {
    ...baseWorkplaceGrants(),
    dashboard: { actions: READ, scope: 'department' },
    projects: { actions: [...FULL], scope: 'department' },
    crm: { actions: WRITE, scope: 'department' },
    hr: { actions: ['view', 'approve'], scope: 'department' },
    /**
     * Sets their people's targets, and signs off what those people earned.
     *
     * `approve` without `manage`: a manager approves a claim, they do not
     * write the commission rules that produced it. Those two being separate
     * is what stops a department head inventing their own team's rate.
     */
    performance: {
      actions: ['view', 'create', 'edit', 'approve', 'export'],
      scope: 'department',
    },
    finance: { actions: ['view', 'create', 'approve'], scope: 'department' },
    support: { actions: WRITE, scope: 'department' },
    inventory: { actions: READ, scope: 'organization' },
    calendar: { actions: WRITE, scope: 'department' },
    // Preview only: what does this customer actually see? Read-only, because
    // the portal is a rendering of other modules' data, not a place to edit.
    portal: { actions: READ, scope: 'department' },
  },

  employee: baseWorkplaceGrants(),

  hr_staff: {
    ...baseWorkplaceGrants(),
    dashboard: { actions: READ, scope: 'organization' },
    // HR is the one function that legitimately needs person-level access
    // across the whole organisation.
    hr: { actions: FULL, scope: 'organization' },
    calendar: { actions: WRITE, scope: 'organization' },
    /**
     * HR owns the performance cycle: goals, reviews and the targets they are
     * measured against, for everybody. `manage` because incentive *rules* are
     * a compensation policy, and compensation policy is HR's, not a
     * department head's.
     */
    performance: { actions: FULL, scope: 'organization' },
  },

  finance_staff: {
    ...baseWorkplaceGrants(),
    dashboard: { actions: READ, scope: 'organization' },
    finance: { actions: FULL, scope: 'organization' },
    // Needs purchase orders and stock valuation to close the books.
    inventory: { actions: WRITE, scope: 'organization' },
    // Deal values feed revenue forecasting; no ability to edit the pipeline.
    crm: { actions: READ, scope: 'organization' },
    /**
     * Finance is the second half of an incentive's life: it approves the
     * payment after a manager has approved the claim, and needs to see every
     * entry to do it. No `edit` and no `manage` - Finance pays what the rules
     * produced, and does not adjust either the rules or the amounts.
     */
    performance: {
      actions: ['view', 'approve', 'export'],
      scope: 'organization',
    },
  },

  sales_staff: {
    ...baseWorkplaceGrants(),
    crm: { actions: WRITE, scope: 'own' },
    // Product catalogue and availability, to quote accurately.
    inventory: { actions: READ, scope: 'organization' },
    // An account manager is usually the person a client asks "what can you
    // see?", so they need to be able to look.
    portal: { actions: READ, scope: 'own' },
  },

  support_staff: {
    ...baseWorkplaceGrants(),
    support: { actions: WRITE, scope: 'organization' },
    // Read-only customer context so an agent knows who they are talking to.
    crm: { actions: READ, scope: 'organization' },
  },

  /**
   * External. A client is not an employee: no internal chat, no workspace, no
   * directory, no visibility of anyone else's records.
   */
  client: {
    /**
     * The portal is the client's entire product.
     *
     * `create` alongside `view` covers exactly one write: replying on their
     * own project's thread. The RLS policy `comments_client_insert` is what
     * confines it to that — this grant only decides whether the endpoint is
     * reachable at all.
     */
    portal: { actions: ['view', 'create'], scope: 'own' },
    support: { actions: ['view', 'create'], scope: 'own' },
    /**
     * Read-only, and only their own.
     *
     * Kept because the portal endpoints are guarded on `projects.view`; the
     * database is what restricts the rows to projects belonging to their
     * company, via `auth_client_company_id()`.
     *
     * Note there is no `dashboard`: a client has no internal dashboard to
     * land on, and granting one produced an empty screen as their home page.
     * `defaultModuleFor()` sends them to the portal instead.
     */
    projects: { actions: READ, scope: 'own' },
  },
};

// ─── Role normalisation ────────────────────────────────────────────────────

/**
 * Legacy identifiers that predate this model, mapped onto canonical roles.
 * Kept so existing seeded users and sessions resolve to something sane rather
 * than silently falling back to the least-privileged role.
 */
const LEGACY_ROLE_ALIASES: Record<string, RoleId> = {
  // Prisma Role table
  'role-admin': 'administrator',
  'role-manager': 'manager',
  'role-user': 'employee',
  // Session / Supabase vocabulary
  super_admin: 'owner',
  admin: 'administrator',
  user: 'employee',
  staff: 'employee',
  member: 'employee',
};

const VALID_ROLE_IDS = new Set<string>(ROLES.map(r => r.id));

/**
 * Resolve any historical role identifier to a canonical `RoleId`.
 *
 * Unknown values deliberately fall back to `employee` — the least-privileged
 * internal role — so a typo or an unmapped legacy value can never escalate
 * privileges.
 */
export function normalizeRole(raw: string | null | undefined): RoleId {
  if (!raw) return 'employee';
  const key = String(raw).trim().toLowerCase();
  if (VALID_ROLE_IDS.has(key)) return key as RoleId;
  return LEGACY_ROLE_ALIASES[key] ?? 'employee';
}

// ─── Queries ───────────────────────────────────────────────────────────────

export function grantFor(role: RoleId, module: ModuleId): Grant | null {
  return ROLE_GRANTS[role]?.[module] ?? null;
}

export function canAccessModule(role: RoleId, module: ModuleId): boolean {
  return !!grantFor(role, module);
}

/** Whether `role` may perform `action` within `module`. */
export function can(role: RoleId, module: ModuleId, action: Action): boolean {
  const grant = grantFor(role, module);
  return !!grant && grant.actions.includes(action);
}

/** How much data of `module` this role may resolve. */
export function scopeFor(role: RoleId, module: ModuleId): Scope | null {
  return grantFor(role, module)?.scope ?? null;
}

export function hasScopeAtLeast(role: RoleId, module: ModuleId, min: Scope): boolean {
  const scope = scopeFor(role, module);
  return !!scope && SCOPE_RANK[scope] >= SCOPE_RANK[min];
}

/** Modules this role may open, in canonical navigation order. */
export function allowedModules(role: RoleId): ModuleId[] {
  return MODULES.map(m => m.id).filter(id => canAccessModule(role, id));
}

/**
 * Where a role should land after signing in.
 *
 * External roles go to the portal, which is the whole of their product —
 * falling through to `allowedModules(role)[0]` would send a client to the
 * projects module, whose UI is built for staff and which they can only read a
 * sliver of.
 */
export function defaultModuleFor(role: RoleId): ModuleId {
  if (isExternalRole(role) && canAccessModule(role, 'portal')) return 'portal';
  return canAccessModule(role, 'dashboard') ? 'dashboard' : (allowedModules(role)[0] ?? 'dashboard');
}

export function roleLabel(role: RoleId): string {
  return ROLES.find(r => r.id === role)?.name ?? 'Employee';
}

/** True for roles that are not employees of the organisation. */
export function isExternalRole(role: RoleId): boolean {
  return role === 'client';
}

/**
 * Serialisable capability summary handed to the client so navigation and
 * affordances match what the server will actually permit. This is a mirror of
 * server truth for rendering — never the basis of an access decision.
 */
export interface CapabilitySummary {
  role: RoleId;
  roleLabel: string;
  isExternal: boolean;
  modules: ModuleId[];
  grants: Record<string, { actions: Action[]; scope: Scope }>;
}

export function capabilitySummary(role: RoleId): CapabilitySummary {
  const grants: CapabilitySummary['grants'] = {};
  for (const id of allowedModules(role)) {
    const g = grantFor(role, id)!;
    grants[id] = { actions: [...g.actions], scope: g.scope };
  }
  return {
    role,
    roleLabel: roleLabel(role),
    isExternal: isExternalRole(role),
    modules: allowedModules(role),
    grants,
  };
}

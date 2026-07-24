import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { error } from '@/lib/api-response';
import type { ModuleId, RoleId } from '@/lib/constants';
import {
  normalizeRole, can, scopeFor, canAccessModule,
  type Action, type Scope,
} from '@/lib/permissions';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Acting user — server-side identity resolution.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Route handlers must never take the caller's role from the request body,
 * a header, or a query parameter. They resolve it here, from the session
 * cookie, against the database.
 */

export const SESSION_COOKIE = 'nexuscorp-demo-session';
/** Identifies which user the demo session represents. */
export const SESSION_USER_COOKIE = 'nexuscorp-session-user';

export interface ActingUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  department: string;
  role: RoleId;
  isActive: boolean;
}

/**
 * Fallback identity when a demo session exists but names no specific user
 * (older cookies, or a signup that has not been seeded into the User table).
 */
const FALLBACK_USER: ActingUser = {
  id: 'u1',
  email: 'admin@nexuscorp.io',
  firstName: 'Alex',
  lastName: 'Morgan',
  jobTitle: 'Platform Administrator',
  department: 'Executive',
  role: 'owner',
  isActive: true,
};

function toActingUser(row: {
  id: string; email: string; firstName: string; lastName: string;
  jobTitle: string; department: string; roleId: string; isActive: boolean;
}): ActingUser {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    jobTitle: row.jobTitle,
    department: row.department,
    // The stored value may be a legacy identifier; normalise it so every
    // downstream check speaks one vocabulary.
    role: normalizeRole(row.roleId),
    isActive: row.isActive,
  };
}

/**
 * Resolve the acting user for this request, or null when unauthenticated.
 *
 * Demo mode note: the session cookie is httpOnly but unsigned, so it is a
 * convenience mechanism, not a cryptographic one. It is no weaker than the
 * existing demo login (which accepts any password) — but before this is used
 * with real data the cookie must be replaced by a signed token or the
 * Supabase session, at which point only this function needs to change.
 */
export async function getActingUser(): Promise<ActingUser | null> {
  const store = await cookies();
  if (store.get(SESSION_COOKIE)?.value !== 'true') return null;

  const userId = store.get(SESSION_USER_COOKIE)?.value;
  if (!userId) return FALLBACK_USER;

  try {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        jobTitle: true, department: true, roleId: true, isActive: true,
      },
    });
    if (!row) return FALLBACK_USER;
    // A deactivated account keeps its cookie until expiry; deny immediately.
    if (!row.isActive) return null;
    return toActingUser(row);
  } catch {
    return FALLBACK_USER;
  }
}

/** Look up a user by email for sign-in, so demo logins adopt a real role. */
export async function findUserByEmail(email: string): Promise<ActingUser | null> {
  try {
    const row = await db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        jobTitle: true, department: true, roleId: true, isActive: true,
      },
    });
    return row && row.isActive ? toActingUser(row) : null;
  } catch {
    return null;
  }
}

// ─── Route guards ──────────────────────────────────────────────────────────

export interface AuthorizedContext {
  user: ActingUser;
  scope: Scope;
}

/**
 * Guard for a route handler.
 *
 * Returns either the authorised context or a `Response` to return directly:
 *
 *   const guard = await authorize('finance', 'approve');
 *   if (guard instanceof Response) return guard;
 *   const { user, scope } = guard;
 *
 * 401 means "no session"; 403 means "session, but not permitted" — a
 * distinction clients need in order to decide between redirecting to login
 * and showing a permission message.
 */
export async function authorize(
  module: ModuleId,
  action: Action = 'view',
): Promise<AuthorizedContext | Response> {
  const user = await getActingUser();
  if (!user) return error('Authentication required', 401, 'UNAUTHENTICATED');

  if (!canAccessModule(user.role, module)) {
    return error(
      `Your role (${user.role}) does not have access to ${module}.`,
      403,
      'FORBIDDEN_MODULE',
    );
  }
  if (!can(user.role, module, action)) {
    return error(
      `Your role (${user.role}) cannot ${action} in ${module}.`,
      403,
      'FORBIDDEN_ACTION',
    );
  }

  return { user, scope: scopeFor(user.role, module)! };
}

/**
 * Translate a scope into a Prisma `where` fragment.
 *
 * `ownerField` is whichever column identifies the subject of the record for
 * this module (`ownerId`, `assigneeId`, `requesterId`, …). Passing null means
 * the model has no per-user owner, in which case `own` degrades to
 * `department` — never silently to organization-wide.
 */
export function scopeWhere(
  ctx: AuthorizedContext,
  opts: { ownerField?: string | null; departmentField?: string | null } = {},
): Record<string, unknown> {
  const { user, scope } = ctx;
  const { ownerField = 'ownerId', departmentField = null } = opts;

  if (scope === 'organization') return {};

  if (scope === 'department') {
    if (departmentField) return { [departmentField]: user.department };
    // No department column on this model: fall back to the user's own records
    // rather than exposing the whole organisation.
    return ownerField ? { [ownerField]: user.id } : {};
  }

  // scope === 'own'
  if (ownerField) return { [ownerField]: user.id };
  if (departmentField) return { [departmentField]: user.department };
  return {};
}

import type { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { error } from '@/lib/api-response';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Request rate limiting
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ── What was here before ──────────────────────────────────────────────────
 *
 *  Nothing. `/api/auth/login` accepted unlimited attempts from anywhere, and
 *  the one mention of a rate limit in the codebase was the login route
 *  *translating* GoTrue's own 429 into readable wording. That is not a control
 *  — it is a message about somebody else's control, and Supabase's applies to
 *  its endpoints, not to ours. Credential stuffing against this origin, address
 *  enumeration through the signup form, and mail-bombing a victim through the
 *  password-reset form were all unbounded.
 *
 *  ── Two buckets, because one cannot express the rule ──────────────────────
 *
 *  Per **address** answers "one machine is hammering us".
 *  Per **subject** answers "one account is being attacked from many machines".
 *
 *  Neither alone is enough. An address limit is defeated by a botnet, and it is
 *  also the one that hurts real users first, because a customer's whole office
 *  arrives through a single NAT address. A subject limit survives distribution
 *  and cannot be tripped by a colleague, but it does nothing about a script
 *  walking a list of addresses. Both are checked, and they are configured
 *  separately for exactly that reason: the address limit is set loosely enough
 *  not to punish an office, and the subject limit carries the real protection.
 *
 *  ── Fail open, always ─────────────────────────────────────────────────────
 *
 *  A limiter that throws must never take the platform down. Every failure path
 *  here — a store error, an unidentifiable caller, a disabled flag — permits
 *  the request. A rate limiter is a control on abuse, and abuse is survivable
 *  in a way that "nobody can sign in" is not.
 *
 *  ── Why the counters are in memory ────────────────────────────────────────
 *
 *  Because the deployment is a Node process (`output: "standalone"`), and a
 *  Redis round trip on the login path would add a network dependency, a bill
 *  and a new outage mode to buy accuracy this scale does not need. The
 *  trade-off is stated plainly rather than hidden: with N application
 *  instances the effective limit is N times the configured one, because each
 *  process counts on its own.
 *
 *  When that stops being acceptable — more than a handful of instances, or a
 *  requirement to prove the limit exactly — `setRateLimitStore()` replaces the
 *  counter with a shared one. Nothing at the call sites changes. That seam is
 *  also why this file, and not each route, knows where counters live.
 */

// ── Configuration ──────────────────────────────────────────────────────────

/**
 * The rollback lever.
 *
 * Set `RATE_LIMIT_DISABLED=1` and every check below permits immediately, with
 * no restart of anything else and no code change. If a limit turns out to be
 * wrong in production at three in the morning, this is the thing to reach for
 * before reverting a deployment.
 */
const DISABLED = process.env.RATE_LIMIT_DISABLED === '1';

/**
 * How many proxies sit in front of this application.
 *
 * `x-forwarded-for` is a list that each hop appends to, so the entry a caller
 * cannot forge is counted from the *right*, not the left. With one trusted
 * proxy — Vercel, or the Caddy front in `Caddyfile` — the rightmost entry is
 * the real client and anything the client invented sits harmlessly to its
 * left. Taking the leftmost, which is the more commonly written version of
 * this code, reads a value the attacker chose and makes the address limit
 * decorative.
 */
const TRUSTED_HOPS = Math.max(1, Number(process.env.RATE_LIMIT_TRUSTED_HOPS) || 1);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface RateLimitPolicy {
  /** Stable name. Forms the bucket key, so changing it resets live counters. */
  readonly name: string;
  /** Length of the window these limits are measured over. */
  readonly windowMs: number;
  /** Requests permitted per window from one client address. 0 disables. */
  readonly perAddress: number;
  /** Requests permitted per window against one subject. 0 disables. */
  readonly perSubject: number;
}

function limit(envKey: string, fallback: number): number {
  const raw = Number(process.env[envKey]);
  // A zero is meaningful — it turns that bucket off — so this cannot use `||`.
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

/**
 * The policies, one per kind of abuse rather than one per route.
 *
 * Routes that share an attack story share a bucket: asking for a reset link
 * and asking for a confirmation link are the same act — make this server send
 * mail to an address of my choosing — so they are counted together, and a
 * script cannot get twice the budget by alternating between them.
 *
 * Every limit is deliberately permissive. The instruction these were written
 * against is "prevent abuse without affecting legitimate users", and the way
 * that goes wrong is not a limit set too high — it is a limit set low on a
 * guess, tripped by a customer's office on a Monday morning, and then disabled
 * altogether. Start here, measure, tighten with evidence.
 */
export const RATE_LIMITS = {
  /**
   * Signing in. Subject is the email address being signed in as.
   *
   * Ten attempts a minute is far more than a person mistyping their own
   * password and far fewer than a guessing run. The address allowance is three
   * times that because a hundred-person office is one address to us.
   */
  signIn: {
    name: 'sign-in',
    windowMs: MINUTE,
    perAddress: limit('RATE_LIMIT_SIGN_IN_PER_ADDRESS', 30),
    perSubject: limit('RATE_LIMIT_SIGN_IN_PER_ACCOUNT', 10),
  },

  /**
   * Creating an account. Subject is the address being registered.
   *
   * Hourly rather than per-minute: signup is a once-ever act for a person, so
   * a short window would only ever catch a burst and miss the slow enumeration
   * this is actually for.
   */
  signUp: {
    name: 'sign-up',
    windowMs: HOUR,
    perAddress: limit('RATE_LIMIT_SIGN_UP_PER_ADDRESS', 20),
    perSubject: limit('RATE_LIMIT_SIGN_UP_PER_ACCOUNT', 3),
  },

  /**
   * Anything that makes the platform send mail to an address the caller named.
   * Subject is the recipient.
   *
   * Two victims here, which is why the subject limit is the tight one: the
   * person whose inbox fills up, and the deployment, whose SMTP quota is
   * finite and shared — `DEPLOYMENT.md` records that the built-in mailer
   * allows a handful of messages an hour and that exhausting it breaks signup
   * for everybody.
   */
  emailDispatch: {
    name: 'email-dispatch',
    windowMs: HOUR,
    perAddress: limit('RATE_LIMIT_EMAIL_PER_ADDRESS', 15),
    perSubject: limit('RATE_LIMIT_EMAIL_PER_ACCOUNT', 3),
  },

  /**
   * Setting or replacing a password. Subject is the acting user.
   *
   * `/api/auth/change-password` verifies the *current* password before
   * changing it, which is correct and is also an online guessing oracle for
   * anyone holding a stolen session cookie. That endpoint is the reason this
   * policy exists.
   */
  credentialChange: {
    name: 'credential-change',
    windowMs: 15 * MINUTE,
    perAddress: limit('RATE_LIMIT_CREDENTIAL_PER_ADDRESS', 30),
    perSubject: limit('RATE_LIMIT_CREDENTIAL_PER_ACCOUNT', 10),
  },

  /**
   * Issuing and redeeming invitations. Subject is the acting user.
   *
   * Redemption is guessing-shaped; issuance is mail-bombing-shaped, with the
   * added wrinkle that it is an *authenticated* abuse — a compromised
   * administrator account, or an honest one running a broken script.
   */
  invitation: {
    name: 'invitation',
    windowMs: HOUR,
    perAddress: limit('RATE_LIMIT_INVITATION_PER_ADDRESS', 100),
    perSubject: limit('RATE_LIMIT_INVITATION_PER_ACCOUNT', 50),
  },
} as const satisfies Record<string, RateLimitPolicy>;

/** Every configured policy, for the operational summary in the health route. */
export const RATE_LIMIT_SUMMARY = {
  enabled: !DISABLED,
  trustedHops: TRUSTED_HOPS,
  policies: Object.values(RATE_LIMITS).map(p => ({
    name: p.name,
    windowSeconds: p.windowMs / 1000,
    perAddress: p.perAddress,
    perSubject: p.perSubject,
  })),
} as const;

// ── The store ──────────────────────────────────────────────────────────────

export interface RateLimitVerdict {
  allowed: boolean;
  /** When the oldest hit in this window ages out, in epoch milliseconds. */
  resetAt: number;
}

/**
 * Where counters live.
 *
 * The whole of this module's coupling to infrastructure is this interface. A
 * Redis or DynamoDB implementation supplies `hit()` and nothing else in the
 * application changes — which is the point, and is why the routes call
 * `enforceRateLimit()` rather than touching a counter directly.
 */
export interface RateLimitStore {
  hit(key: string, windowMs: number, max: number): RateLimitVerdict | Promise<RateLimitVerdict>;
}

/**
 * A sliding window of hit timestamps, held in this process.
 *
 * Sliding rather than fixed: a fixed window lets twice the limit through
 * across a boundary, which on a ten-per-minute login limit means twenty
 * attempts in two seconds — the exact burst the limit exists to stop.
 *
 * A rejected request is **not** recorded. Counting refusals would let an
 * attacker hold their own bucket open indefinitely by continuing to knock,
 * which turns a limit into a self-inflicted lockout of the real user.
 */
class MemoryRateLimitStore implements RateLimitStore {
  /**
   * Bounded, because an unbounded map keyed by attacker-supplied values is
   * itself the denial-of-service it was added to prevent.
   */
  private static readonly MAX_KEYS = 20_000;

  private readonly buckets = new Map<string, number[]>();

  hit(key: string, windowMs: number, max: number): RateLimitVerdict {
    const now = Date.now();
    const cutoff = now - windowMs;

    const hits = (this.buckets.get(key) ?? []).filter(t => t > cutoff);
    const allowed = hits.length < max;
    if (allowed) hits.push(now);

    if (hits.length === 0) this.buckets.delete(key);
    else {
      // Re-inserting moves the key to the end of the Map's iteration order,
      // which is what makes the eviction below least-recently-used.
      this.buckets.delete(key);
      this.buckets.set(key, hits);
    }

    if (this.buckets.size > MemoryRateLimitStore.MAX_KEYS) this.evict(now);

    return { allowed, resetAt: (hits[0] ?? now) + windowMs };
  }

  /**
   * Drop what has expired; if that is not enough, drop the coldest keys.
   *
   * Evicting a live bucket forgives whoever owned it, which is the correct
   * direction to be wrong in — see the fail-open note at the top of the file.
   */
  private evict(now: number): void {
    for (const [key, hits] of this.buckets) {
      // Windows differ by policy, so the longest is the only safe yardstick
      // for "certainly expired".
      if (hits[hits.length - 1] <= now - HOUR) this.buckets.delete(key);
    }
    for (const key of this.buckets.keys()) {
      if (this.buckets.size <= MemoryRateLimitStore.MAX_KEYS) break;
      this.buckets.delete(key);
    }
  }
}

let store: RateLimitStore = new MemoryRateLimitStore();

/**
 * Replace the counter.
 *
 * For a shared store when one process stops being the whole deployment, and
 * for tests, which need a counter they can reason about.
 */
export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

// ── Identifying the caller ─────────────────────────────────────────────────

/**
 * The client address, or null when there is not one we can trust.
 *
 * Returning null rather than a placeholder is deliberate, and it is the most
 * consequential decision in this file. Bucketing every unidentifiable caller
 * under one key would mean that a deployment which does not set forwarding
 * headers — a misconfigured proxy, a direct container, a health checker —
 * shares a single allowance across all of its users, and the first thirty
 * sign-ins in a minute lock out the thirty-first. That is a platform outage
 * caused by the control meant to protect it.
 *
 * So an unidentifiable caller is not address-limited at all. The subject limit
 * still applies to them, and it is the one carrying the real protection.
 */
export function clientAddress(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map(s => s.trim()).filter(Boolean);
    // Count from the right: see TRUSTED_HOPS.
    const client = hops[hops.length - TRUSTED_HOPS];
    if (client) return client;
  }
  return request.headers.get('x-real-ip')?.trim() || null;
}

/**
 * Keys are hashed, never stored raw.
 *
 * The subject is usually an email address. Counters are ephemeral here, but
 * the store is swappable by design, and the day one is backed by Redis is the
 * day this application would otherwise start writing customer addresses into a
 * second system with its own retention and its own backups. Hashing now costs
 * nothing and means that never becomes a question.
 */
function keyOf(policy: RateLimitPolicy, kind: 'a' | 's', value: string): string {
  const digest = createHash('sha256').update(value.toLowerCase()).digest('base64url').slice(0, 22);
  return `${policy.name}:${kind}:${digest}`;
}

// ── Enforcement ────────────────────────────────────────────────────────────

/**
 * A refusal that gives nothing away.
 *
 * One wording for every policy and both buckets. Saying "too many attempts for
 * this account" would confirm the account exists, which undoes the care the
 * login and reset routes already take to be uninformative — those routes go to
 * some length to make "no such user" and "wrong password" indistinguishable,
 * and a chattier limiter would hand back exactly what they withhold.
 */
function refuse(resetAt: number): Response {
  const seconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  const response = error(
    'Too many attempts. Please wait a moment and try again.',
    429,
    'RATE_LIMITED',
  );
  // Retry-After is the standard way to tell a well-behaved client — and our
  // own forms — how long to wait, instead of leaving them to guess and retry.
  response.headers.set('Retry-After', String(seconds));
  return response;
}

/**
 * Check both buckets and return a 429 if either is exhausted, otherwise null.
 *
 *     const limited = await enforceRateLimit(request, RATE_LIMITS.signIn, email);
 *     if (limited) return limited;
 *
 * `subject` is whatever the request is acting *on or as* — the address being
 * signed in as, the recipient of the mail, the acting user's id. Omit it when
 * the request has no such identity and only the address bucket applies.
 *
 * Call once per request. Calling twice charges the address bucket twice.
 */
export async function enforceRateLimit(
  request: NextRequest,
  policy: RateLimitPolicy,
  subject?: string | null,
): Promise<Response | null> {
  if (DISABLED) return null;

  try {
    if (policy.perAddress > 0) {
      const address = clientAddress(request);
      if (address) {
        const verdict = await store.hit(
          keyOf(policy, 'a', address), policy.windowMs, policy.perAddress,
        );
        if (!verdict.allowed) return refuse(verdict.resetAt);
      }
    }

    if (policy.perSubject > 0 && subject) {
      const verdict = await store.hit(
        keyOf(policy, 's', subject), policy.windowMs, policy.perSubject,
      );
      if (!verdict.allowed) return refuse(verdict.resetAt);
    }

    return null;
  } catch {
    // Fail open. A broken counter must not become a broken login page.
    return null;
  }
}

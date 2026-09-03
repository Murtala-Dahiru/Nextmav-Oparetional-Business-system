import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { provisionMember } from '@/lib/provisioning';
import { todayIn } from '@/lib/org-time';

type Params = { params: Promise<{ id: string }> };

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Candidate → employee.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The one endpoint the recruitment tab existed to have and never did. It does
 * three things that have to happen together:
 *
 *   1. creates the account and the membership, through `provisionMember()` -
 *      the same code path the administration screen uses, not a copy of it,
 *   2. closes the pipeline through `complete_hire()`, which marks the
 *      application hired, remembers on the candidate which employee they
 *      became, accepts the outstanding offer and fills the opening if that was
 *      its last position,
 *   3. starts the onboarding, if the caller named a template - which is what
 *      makes "hiring leads naturally into becoming a productive employee" a
 *      sequence of rows rather than a sentence.
 *
 * ── Why `hr.manage` and not `admin.manage` ───────────────────────────────
 *
 * Creating an auth account is administrative, and `/api/admin/users` is
 * correctly gated on the administration module. But hiring is HR's job, and
 * `hr_staff` holds no `admin` grant at all - so gating this the same way would
 * mean the head of HR could run an entire recruitment process and then need an
 * administrator to press the last button.
 *
 * `hr.manage` is held by owner, administrator and HR staff and by nobody else:
 * not a manager, whose `hr` grant is `view` and `approve`, and not an
 * employee. That is a narrower grant than handing HR the administration
 * module, and it is the capability model deciding rather than this file.
 *
 * ── The order, and what happens if a step fails ──────────────────────────
 *
 * Provisioning first, because it is the only step that creates something
 * outside this database and the only one that already rolls itself back. Once
 * the membership exists, the remaining two are ordinary writes; if the second
 * fails the person is a real employee whose application was not closed, which
 * is visible, recoverable and far better than an application marked hired with
 * nobody behind it.
 */
export async function POST(req: Request, { params }: Params) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  try {
    const b = acceptBody(await req.json().catch(() => ({})));

    const { data: app, error: ae } = await ctx.supabase
      .from('job_applications')
      .select(
        'id, status, candidate_id, opening_id, ' +
        'candidate:candidates(id, full_name, email, phone), ' +
        'opening:job_openings(id, title, department_id, hiring_manager_id, employment_type)',
      )
      .eq('organization_id', ctx.org.organizationId).eq('id', id)
      .maybeSingle();

    if (ae) return pgError(ae);
    if (!app) return error('Not found', 404, 'NOT_FOUND');

    const application = app as any;
    if (application.status !== 'active') {
      return error(`This application is already ${application.status}.`, 409, 'ALREADY_DECIDED');
    }

    const candidate = application.candidate as any;
    const opening = application.opening as any;

    /**
     * The offer, where there is one, supplies the terms.
     *
     * An accepted offer already says the title, department, manager, type and
     * start date the company committed to, and retyping them into the hire
     * form is how the employment record comes to disagree with the letter the
     * person signed. The body may still override, because an offer can be
     * amended verbally and HR is the one recording what actually happened.
     */
    const { data: offer } = await ctx.supabase
      .from('job_offers')
      .select('*')
      .eq('application_id', id)
      .in('status', ['accepted', 'sent', 'approved'])
      .order('created_at', { ascending: false })
      .maybeSingle();

    const email = String(b.email ?? candidate?.email ?? '').trim().toLowerCase();
    if (!email) {
      return error(
        'This candidate has no email address, so no account can be created for them. Add one first.',
        422, 'EMAIL_REQUIRED',
      );
    }

    /**
     * Splitting a full name is guesswork, and it is guesswork the schema forces
     * - `profiles` carries `first_name` and `last_name`. First word and the
     * rest, so "Chidinma Okonkwo-Bello" and "Maria del Carmen Ruiz" both keep
     * every part of their name, in an order somebody can correct afterwards.
     */
    const parts = String(b.full_name ?? candidate?.full_name ?? '').trim().split(/\s+/);
    const firstName = String(b.first_name ?? parts[0] ?? '').trim();
    const lastName = String(b.last_name ?? parts.slice(1).join(' ')).trim() || firstName;
    if (!firstName) return error('A name is required to create the account.', 422, 'VALIDATION_ERROR');

    const hiredOn = String(b.hired_on ?? offer?.start_on ?? todayIn(ctx.org.timezone));

    const result = await provisionMember(ctx.supabase, ctx.org.organizationId, {
      email,
      firstName,
      lastName,
      role: b.role ?? 'employee',
      phone: b.phone ?? candidate?.phone ?? null,
      jobTitle: b.job_title ?? offer?.job_title ?? opening?.title ?? null,
      departmentId: b.department_id ?? offer?.department_id ?? opening?.department_id ?? null,
      managerId: b.manager_id ?? offer?.manager_id ?? opening?.hiring_manager_id ?? null,
      employeeNumber: b.employee_number ?? null,
      employmentType: b.employment_type ?? offer?.employment_type ?? opening?.employment_type ?? null,
      hiredOn,
      /**
       * A new hire starts at `onboarding`, not `active`.
       *
       * Somebody who begins on Monday is on the payroll and is not yet doing
       * the job, and a directory that cannot tell those apart is one where the
       * "who is available this week" question has no answer. Completing their
       * onboarding checklist is what promotes them, by trigger.
       */
      lifecycleStage: 'onboarding',
      probationEndsOn: b.probation_ends_on ?? probationEnd(hiredOn, offer?.probation_months),
      workLocation: b.work_location ?? null,
    });

    if (!result.ok) return error(result.message, result.status, result.code);

    const memberId = result.member.id as string;

    const { data: closed, error: ce } = await ctx.supabase.rpc('complete_hire', {
      p_application: id,
      p_member: memberId,
    });

    if (ce) {
      /* The employee exists and is real; only the pipeline is unclosed. Say
         exactly that rather than implying nothing happened. */
      return error(
        `${firstName} was added to the organisation, but the application could not be closed: ${ce.message}`,
        409, 'HIRE_PARTIAL',
      );
    }

    /**
     * Onboarding, when a template was chosen.
     *
     * Optional on purpose: an organisation that has not written its onboarding
     * yet must still be able to hire, and an empty checklist created "so the
     * feature is used" is a screen of nothing pretending to be a process.
     */
    let checklist = null;
    if (b.onboarding_template_id) {
      const { data: list, error: le } = await ctx.supabase.rpc('start_employee_checklist', {
        p_member: memberId,
        p_kind: 'onboarding',
        p_template: b.onboarding_template_id,
        p_anchor: hiredOn,
        p_name: null,
      });
      if (!le) checklist = list;
    }

    return success(
      {
        member: result.member,
        application: closed,
        checklist,
        temporaryPassword: result.temporaryPassword,
        mustChangePassword: result.mustChangePassword,
        emailSent: false,
        nextStep: result.nextStep,
      },
      undefined,
      201,
    );
  } catch (e: any) {
    return serverError(e, 'Could not complete the hire');
  }
}

/** The end of probation, when the offer said how long it runs. */
function probationEnd(startISO: string, months: unknown): string | null {
  const n = Number(months);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(`${startISO}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

import { authorize, pgError } from '@/lib/auth-context';
import { success, error, serverError } from '@/lib/api-response';
import { acceptBody } from '@/lib/case';
import { validateRules, describeRuleset } from '@/lib/payroll';
import { STARTER_RULESETS } from '@/lib/payroll-starters';

const SELECT =
  '*, creator:organization_members!payroll_rulesets_created_by_fkey(id, ' +
  'profiles!organization_members_user_id_fkey(full_name))';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Payroll rulesets.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A jurisdiction's payroll arithmetic, as an ordered list of declarative steps.
 * No tax rule is hard-coded anywhere in this product: Nigerian PAYE and a
 * UK-style banded system are two rows, not two code paths, which is the only
 * reason payroll here can leave one country.
 *
 * Readable by everybody with the module, for the reason 0031 gave about
 * incentive rules: a scheme people cannot read is a rumour. A ruleset holds
 * rates and bands, not anybody's pay.
 *
 * Every response carries `verdict` - what `describeRuleset()` says about
 * whether these figures can be trusted - because the screen must never print a
 * payroll number without it.
 */
export async function GET() {
  const ctx = await authorize('hr', 'view');
  if (ctx instanceof Response) return ctx;

  const { data, error: e } = await ctx.supabase
    .from('payroll_rulesets').select(SELECT)
    .eq('organization_id', ctx.org.organizationId)
    .order('is_active', { ascending: false })
    .order('name');

  if (e) return pgError(e);

  return success({
    rulesets: (data ?? []).map((r: any) => ({
      ...r,
      verdict: describeRuleset({
        id: r.id, name: r.name, countryCode: r.country_code, currency: r.currency,
        isStatutoryComplete: r.is_statutory_complete,
        statutoryNote: r.statutory_note ?? '', rules: r.rules ?? { steps: [] },
      }),
    })),
    /**
     * Starting points, offered rather than installed.
     *
     * The same discipline as the checklist starters: a ruleset seeded into
     * every tenant would be one company's tax opinion presented as another's
     * configuration. These are a form to fill in, and whichever is chosen
     * lands as `is_statutory_complete = false` until a person says otherwise.
     */
    starters: STARTER_RULESETS.map(s => ({
      key: s.key, name: s.name, countryCode: s.countryCode,
      currency: s.currency, note: s.note, stepCount: s.rules.steps.length,
    })),
  });
}

export async function POST(req: Request) {
  const ctx = await authorize('hr', 'manage');
  if (ctx instanceof Response) return ctx;

  try {
    const b = acceptBody(await req.json());

    const starter = b.starter ? STARTER_RULESETS.find(s => s.key === String(b.starter)) : null;
    if (b.starter && !starter) {
      return error(`There is no starter ruleset called "${b.starter}".`, 422, 'UNKNOWN_STARTER');
    }

    const name = String(b.name ?? starter?.name ?? '').trim();
    if (!name) return error('A ruleset needs a name', 422, 'VALIDATION_ERROR');

    const rules = b.rules ?? starter?.rules ?? { steps: [] };
    const problems = validateRules(rules);
    if (problems.length) {
      return error(problems.join(' '), 422, 'INVALID_RULES');
    }

    const countryCode = String(b.country_code ?? starter?.countryCode ?? 'NG')
      .toUpperCase().slice(0, 2);

    const { data, error: e } = await ctx.supabase
      .from('payroll_rulesets')
      .insert({
        organization_id: ctx.org.organizationId,
        name,
        country_code: countryCode,
        currency: b.currency || starter?.currency || ctx.org.currency,
        rules,
        /**
         * A new ruleset is never statutory-complete, whatever the caller sent.
         *
         * The flag means "a person has confirmed these are the full statutory
         * rules for this jurisdiction", and a create request cannot be that
         * confirmation - the rules have not been read by anybody yet. It is
         * set afterwards, deliberately, on the edit endpoint.
         */
        is_statutory_complete: false,
        statutory_note: b.statutory_note ?? starter?.note ?? '',
        created_by: ctx.org.memberId,
      })
      .select(SELECT)
      .single();

    if (e) return pgError(e);
    return success(data, undefined, 201);
  } catch (e: any) {
    return serverError(e, 'Could not create the ruleset');
  }
}

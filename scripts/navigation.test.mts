/**
 * The sidebar shows exactly what a role may open — no more, no less.
 *
 *     npm run test:navigation
 *
 * ── The bug this exists to prevent coming back ────────────────────────────
 *
 * Navigation is now grouped, which means the module list and the list that is
 * rendered are two different things for the first time. That introduces a
 * failure nothing else in the harness would catch: a module added to
 * `MODULES` and granted to a role, but left out of every group, is permitted
 * everywhere and reachable from nowhere. It would not fail `tsc`, it would not
 * fail `app:verify` — the endpoint works perfectly — and it would not look
 * broken on screen. It would simply be a feature nobody could find.
 *
 * The reverse matters more: a module appearing in a group it should not, for a
 * role that cannot open it. That is not a rendering mistake, it is an invitation
 * to a 403, and for `admin` it is an invitation that says the wrong thing about
 * what this account is.
 *
 * So every role is walked, and the rendered set is compared with
 * `allowedModules()` — the same function the server's capability summary is
 * built from.
 */
import { ROLES, MODULES } from '../src/lib/constants';
import { allowedModules } from '../src/lib/permissions';
import { navigationFor } from '../src/lib/navigation';

let pass = 0, fail = 0;

const check = (ok: boolean, label: string, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  — ${detail}`}`);
};

console.log('\n  Navigation, per role\n  ────────────────────');

for (const role of ROLES) {
  const allowed = allowedModules(role.id);
  const sections = navigationFor(allowed, role.id);
  const shown = sections.flatMap(s => s.items.map(i => i.id));

  console.log(`\n  ${role.name} (${role.id})`);
  for (const s of sections) {
    console.log(`      ${(s.label ?? '—').padEnd(15)} ${s.items.map(i => i.label).join(' · ')}`);
  }

  check(
    allowed.every(id => shown.includes(id)),
    'every permitted module is reachable',
    `missing: ${allowed.filter(id => !shown.includes(id)).join(', ')}`,
  );
  check(
    shown.every(id => allowed.includes(id)),
    'nothing is offered that the role cannot open',
    `extra: ${shown.filter(id => !allowed.includes(id)).join(', ')}`,
  );
  check(
    new Set(shown).size === shown.length,
    'no module is listed twice',
  );
  check(
    sections.every(s => s.items.length > 0),
    'no group renders with an empty body',
  );
}

console.log('\n  Metadata\n  ────────');

/**
 * Two of the thirteen used to draw the dashboard's icon because the sidebar's
 * name→component map had no entry for them. The record is total now, so this
 * is the second line of defence: a real mark and a real sentence, not a
 * placeholder that type-checks.
 */
const items = navigationFor(MODULES.map(m => m.id), 'owner').flatMap(s => s.items);
check(items.length === MODULES.length, 'an owner sees all thirteen modules');
check(items.every(i => typeof i.icon === 'function' || typeof i.icon === 'object'),
  'every module resolves to an icon component');
check(items.every(i => i.summary.trim().length > 12),
  'every module carries a one-line summary',
  items.filter(i => i.summary.trim().length <= 12).map(i => i.id).join(', '));
check(new Set(items.map(i => i.icon)).size === items.length,
  'no two modules share a mark',
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);

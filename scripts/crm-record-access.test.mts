import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

// Execute the real routes with isolated auth/database adapters. No live data is written.
const result = await build({
  stdin: { contents: `export * as leads from './src/app/api/crm/leads/[id]/route'; export * as deals from './src/app/api/crm/deals/[id]/route'; export * as conversion from './src/app/api/crm/leads/[id]/convert/route'; export { recordHandlers } from './src/lib/supabase/crud';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'isolated-request-context', setup(build) {
    build.onResolve({ filter: /^@\/lib\/(auth-context|api-response|activity)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path.endsWith('auth-context') ? `export async function authorize() { return globalThis.__crmFixture.ctx; } export function pgError() { return Response.json({}, {status: 500}); }` :
      args.path.endsWith('activity') ? `export function recordActivity() { globalThis.__crmFixture.audits++; }` :
      `export function success(data) { return Response.json({data}); } export function error(message, status, code, details) { return Response.json({error: {message,code,details}}, {status}); } export function serverError() { return Response.json({}, {status: 500}); } export const paginated = success;`
    }));
  } }],
});
const routes = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
// Deal routes now require UUIDs and a pipeline revision (Prompt 1 pipeline work).
const recordId = (name: string) => `00000000-0000-4000-8000-${String(['own','other','foreign','deleted','missing'].indexOf(name)+1).padStart(12,'0')}`;

function fixture(role = 'sales_staff') {
  const rows = [
    { id: 'own', organization_id: 'org', owner_id: 'member', deleted_at: null, name: 'Original' },
    { id: 'other', organization_id: 'org', owner_id: 'colleague', deleted_at: null, name: 'Original' },
    { id: 'foreign', organization_id: 'foreign-org', owner_id: 'member', deleted_at: null, name: 'Original' },
    { id: 'deleted', organization_id: 'org', owner_id: 'member', deleted_at: '2026-01-01', name: 'Original' },
  ];
  for (const row of rows) { row.id = recordId(row.id); Object.assign(row, { pipeline_version: 0 }); }
  const state = { audits: 0, ctx: { org: { role, organizationId: 'org', memberId: 'member' }, supabase: { from() {
    const filters: Array<[string, unknown]> = [];
    let payload: Record<string, unknown> | undefined;
    return {
      select() { return this; },
      eq(key: string, value: unknown) { filters.push([key, value]); return this; },
      is(key: string, value: unknown) { filters.push([key, value]); return this; },
      update(value: Record<string, unknown>) { payload = value; return this; },
      delete() { return this; },
      async maybeSingle() {
        const row = rows.find(row => filters.every(([key, value]) => (row as Record<string, unknown>)[key] === value));
        if (row && payload) Object.assign(row, payload);
        return { data: row ?? null, error: null };
      },
    };
  } } } };
  (globalThis as any).__crmFixture = state;
  return { rows, state };
}

for (const resource of ['leads', 'deals']) {
  for (const method of ['GET', 'PATCH', 'PUT', 'DELETE']) {
    test(`${resource} ${method}: deny another owner, tenant, deleted and absent records`, async () => {
      for (const id of ['other', 'foreign', 'deleted', 'missing']) {
        const { rows, state } = fixture();
        const before = structuredClone(rows);
        const response = await routes[resource][method](new Request('http://localhost/record', {
          method, ...(method === 'PATCH' || method === 'PUT' ? { body: JSON.stringify(resource === 'leads' ? { firstName: 'Changed' } : { name: 'Changed', pipelineVersion: 0 }) } : {}),
        }), { params: Promise.resolve({ id: recordId(id) }) });
        assert.equal(response.status, resource === 'deals' && ['PATCH','PUT'].includes(method) ? 409 : 404);
        assert.deepEqual(rows, before);
        assert.equal(state.audits, 0);
      }
    });
    test(`${resource} ${method}: allow owner and organization administrator`, async () => {
      for (const [role, id] of [['sales_staff', 'own'], ['administrator', 'other']]) {
        fixture(role);
        const response = await routes[resource][method](new Request('http://localhost/record', {
          method, ...(method === 'PATCH' || method === 'PUT' ? { body: JSON.stringify(resource === 'leads' ? { firstName: 'Changed' } : { name: 'Changed', pipelineVersion: 0 }) } : {}),
        }), { params: Promise.resolve({ id: recordId(id) }) });
        assert.equal(response.status, 200);
      }
    });
  }
}

test('unscoped shared handler preserves existing organization-wide behavior', async () => {
  fixture();
  const handlers = routes.recordHandlers({ table: 'contacts', module: 'crm' });
  assert.equal((await handlers.GET(new Request('http://localhost'), { params: Promise.resolve({ id: recordId('other') }) })).status, 200);
});

test('conversion endpoint validates before RPC and derives the tenant from the session', async () => {
  const { state } = fixture();
  const calls: any[] = [];
  (state.ctx.supabase as any).rpc = async (...args: any[]) => { calls.push(args); return { data: { already_converted: false }, error: null }; };
  const params = { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000100' }) };
  for (const body of ['{bad', '{"dealValue":-1}', '{"expectedClose":"2026-02-30"}']) {
    assert.equal((await routes.conversion.POST(new Request('http://localhost', { method: 'POST', body }), params)).status, 422);
  }
  assert.equal(calls.length, 0);
  assert.equal((await routes.conversion.POST(new Request('http://localhost', { method: 'POST', body: '{"organizationId":"foreign"}' }), params)).status, 200);
  assert.equal(calls[0][0], 'crm_convert_lead');
  assert.equal(calls[0][1].p_organization_id, 'org');
});

test('conversion endpoint returns actionable conflicts and migration errors without fallback writes', async () => {
  const { state } = fixture();
  const params = { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000100' }) };
  for (const [result, expected] of [
    [{ data: { conflict: true, contacts: [{ id: 'match' }], companies: [] }, error: null }, 409],
    [{ data: null, error: { code: 'PGRST202' } }, 503],
    [{ data: null, error: { code: 'P0002' } }, 404],
    [{ data: null, error: { code: '22023', message: 'Unavailable contact' } }, 422],
  ] as const) {
    (state.ctx.supabase as any).rpc = async () => result;
    const response = await routes.conversion.POST(new Request('http://localhost', { method: 'POST' }), params);
    assert.equal(response.status, expected);
    if (expected === 409) assert.equal((await response.json()).error.details.contacts[0].id, 'match');
  }
});


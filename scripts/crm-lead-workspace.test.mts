import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { leadInputSchema } from '../src/lib/crm/lead-input';
import { leadListScope } from '../src/lib/crm/lead-list-scope';
import type { RequestContext } from '../src/lib/auth-context';

test('lead intake accepts company-only leads and rejects malformed contact, ownership, status and value', () => {
  assert.equal(leadInputSchema.parse({ companyName: '  Acme  ', email: '' }).companyName, 'Acme');
  for (const input of [{}, { firstName: 42 }, { firstName: 'A', email: 'bad' }, { firstName: 'A', estimatedValue: Infinity }, { firstName: 'A', score: 101 }, { firstName: 'A', ownerId: 'foreign' }, { firstName: 'A', status: 'invented' }]) assert.equal(leadInputSchema.safeParse(input).success, false);
});

test('summary drill-downs preserve ownership and reject invalid date predicates', () => {
  const calls: unknown[][] = [];
  const q: any = Object.fromEntries(['eq', 'is', 'not', 'gte'].map(k => [k, (...args: unknown[]) => { calls.push([k, ...args]); return q; }]));
  leadListScope(q, { org: { role: 'sales_staff', memberId: 'me' } } as RequestContext, new URL('https://local/?active=true&createdSince=garbage'));
  assert.deepEqual(calls, [['eq', 'owner_id', 'me'], ['is', 'converted_contact_id', null], ['not', 'status', 'in', '(won,lost)']]);
});

test('engagement distinguishes notes, scheduled work and completed contact; excludes foreign, deleted and unowned leads', async () => {
  const db = new PGlite();
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  try {
    await db.exec(`CREATE ROLE authenticated;
      CREATE TABLE leads(id uuid, organization_id uuid, owner_id uuid, deleted_at timestamptz);
      CREATE TABLE crm_activities(organization_id uuid,lead_id uuid,activity_type text,created_at timestamptz,due_at timestamptz,completed_at timestamptz);
      CREATE FUNCTION crm_record_visible(org uuid,owner uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT org='${id(1)}'::uuid AND owner='${id(10)}'::uuid $$;
      INSERT INTO leads VALUES ('${id(100)}','${id(1)}','${id(10)}',null),('${id(101)}','${id(1)}','${id(11)}',null),('${id(102)}','${id(2)}','${id(10)}',null),('${id(103)}','${id(1)}','${id(10)}',now());
      INSERT INTO crm_activities VALUES
      ('${id(1)}','${id(100)}','note',now()-interval '5 days',null,null),
      ('${id(1)}','${id(100)}','call',now()-interval '4 days',now()-interval '1 day',null),
      ('${id(1)}','${id(100)}','email',now()-interval '3 days',null,null),
      ('${id(1)}','${id(100)}','meeting',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days');
      GRANT SELECT ON leads,crm_activities TO authenticated;`);
    await db.exec(readFileSync('supabase/migrations/0067_crm_lead_engagement.sql','utf8'));
    await db.exec('SET ROLE authenticated');
    const result = await db.query<any>('SELECT * FROM crm_lead_engagement($1,$2)', [id(1), [100,101,102,103].map(id)]);
    assert.equal(result.rows.length, 1);
    assert.equal(Number(result.rows[0].overdue_count), 1);
    assert.ok(Date.parse(result.rows[0].first_response_at) < Date.parse(result.rows[0].last_activity_at));
    assert.ok(Date.parse(result.rows[0].next_follow_up_at) > Date.parse(result.rows[0].last_activity_at));
    assert.equal((await db.query('SELECT * FROM crm_lead_engagement($1,$2)', [id(2), [id(102)]])).rows.length, 0);
  } finally { await db.close(); }
});

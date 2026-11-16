import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('CRM SQL: atomic conversion, matching, retries, rollback and direct-access restrictions', async () => {
  const db = new PGlite({ extensions: { citext } });
  try {
    await db.exec(`
      CREATE EXTENSION citext;
      CREATE ROLE authenticated;
      CREATE TABLE organizations(id uuid PRIMARY KEY);
      CREATE TABLE organization_members(id uuid PRIMARY KEY, organization_id uuid REFERENCES organizations(id), role text);
      CREATE FUNCTION auth_member_id(org uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT id FROM organization_members WHERE organization_id=org AND id=nullif(current_setting('test.member',true),'')::uuid;
      $$;
      CREATE FUNCTION auth_role_in(org uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT role FROM organization_members WHERE organization_id=org AND id=auth_member_id(org);
      $$;
      CREATE FUNCTION can_access_module(org uuid, module text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT CASE
        WHEN module='finance' THEN auth_role_in(org) IN ('owner','administrator','manager','finance_staff')
        WHEN module='support' THEN auth_role_in(org) IN ('owner','administrator','manager','support_staff')
        ELSE auth_role_in(org) IN ('owner','administrator','manager','sales_staff','support_staff','finance_staff') END; $$;
      CREATE TYPE lead_status AS ENUM ('new','contacted','qualified','unqualified','won','lost');
      CREATE TYPE deal_stage AS ENUM ('prospecting','qualification','proposal','negotiation','closed_won','closed_lost');
    `);
    // Use the actual base CRM table definitions, including checks and foreign keys.
    const base = readFileSync('supabase/migrations/0003_business_tables.sql', 'utf8');
    const tables = ['companies', 'contacts', 'leads', 'deals', 'crm_activities'];
    for (const table of tables) {
      const match = base.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`));
      assert.ok(match, table);
      await db.exec(match[0]);
    }
    await db.exec(`CREATE TABLE deal_stage_events(id serial PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), deal_id uuid REFERENCES deals(id));`);
    for (const table of [...tables, 'deal_stage_events']) {
      await db.exec(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY baseline ON ${table} TO authenticated USING (can_access_module(organization_id,'crm')) WITH CHECK (can_access_module(organization_id,'crm'));
        GRANT ALL ON ${table} TO authenticated;`);
    }
    const migration = readFileSync('supabase/migrations/0050_crm_conversion_and_access.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration); // safe reapplication with the repository migration runner
    await db.exec(`INSERT INTO organizations VALUES ('${id(1)}'),('${id(2)}');
      INSERT INTO organization_members VALUES ('${id(10)}','${id(1)}','sales_staff'),('${id(11)}','${id(1)}','sales_staff'),('${id(12)}','${id(1)}','support_staff'),('${id(13)}','${id(1)}','administrator'),('${id(20)}','${id(2)}','sales_staff');
      INSERT INTO leads(id,organization_id,owner_id,first_name,email,company_name,estimated_value) VALUES
        ('${id(100)}','${id(1)}','${id(10)}','Ada',' ADA@example.test ','Acme',100),
        ('${id(101)}','${id(1)}','${id(11)}','Other','other@example.test',NULL,100),
        ('${id(102)}','${id(2)}','${id(20)}','Foreign','foreign@example.test',NULL,100),
        ('${id(103)}','${id(1)}','${id(10)}','Retry','ada@example.test','Acme',100),
        ('${id(104)}','${id(1)}','${id(10)}','Ambiguous','duplicate@example.test',NULL,100),
        ('${id(105)}','${id(1)}','${id(10)}','Rollback','rollback@example.test','Rollback Co',100),
        ('${id(106)}','${id(1)}','${id(10)}','Possible',NULL,'Acme Ltd',100);
      INSERT INTO contacts(id,organization_id,first_name,email) VALUES ('${id(200)}','${id(1)}','Duplicate A','duplicate@example.test'),('${id(201)}','${id(1)}','Duplicate B','duplicate@example.test');
      SET ROLE authenticated; SELECT set_config('test.member','${id(10)}',false);`);
    const convert = async (lead: number, extra = {}) => {
      const args = { org: id(1), lead: id(lead), createDeal: true, name: 'Opportunity', value: 125.50, contact: null, company: null, ...extra };
      const result = await db.query<{ result: any }>('SELECT crm_convert_lead($1,$2,$3,$4,$5,NULL,$6,$7) AS result', [args.org, args.lead, args.createDeal, args.name, args.value, args.contact, args.company]);
      return result.rows[0].result;
    };
    const count = async (table: string) => Number((await db.query<{ count: number }>(`SELECT count(*) FROM ${table}`)).rows[0].count);
    assert.equal(await count('leads'), 5);
    await assert.rejects(convert(101), /Lead not found/);
    await assert.rejects(convert(102, { org: id(2) }), /not permitted/);
    assert.equal((await db.query(`UPDATE leads SET first_name='Hacked' WHERE id='${id(101)}' RETURNING id`)).rows.length, 0);
    await assert.rejects(db.exec(`UPDATE leads SET owner_id='${id(11)}' WHERE id='${id(100)}'`), /row-level security/);

    const first = await convert(100);
    assert.equal(first.already_converted, false);
    assert.equal(first.deal.value, 125.50);
    const beforeRetry = [await count('contacts'), await count('deals'), await count('crm_activities')];
    const retry = await convert(100, { name: 'Changed retry', value: 999 });
    assert.equal(retry.deal.id, first.deal.id);
    assert.equal(retry.contact.id, first.contact.id);
    assert.equal(retry.already_converted, true);
    assert.deepEqual([await count('contacts'), await count('deals'), await count('crm_activities')], beforeRetry);
    const second = await convert(103);
    assert.equal(second.contact.id, first.contact.id, 'case/space normalized exact email reuse');
    assert.equal(second.company.id, first.company.id);
    assert.equal(await count('contacts'), beforeRetry[0]);

    const beforeConflict = [await count('contacts'), await count('deals'), await count('crm_activities')];
    const conflict = await convert(104);
    assert.equal(conflict.conflict, true);
    assert.equal(conflict.contacts.length, 2);
    assert.deepEqual([await count('contacts'), await count('deals'), await count('crm_activities')], beforeConflict);
    assert.equal((await convert(104, { contact: id(201) })).contact.id, id(201));
    const possible = await convert(106);
    assert.equal(possible.conflict, true, 'suffix match requires explicit review');
    assert.equal(possible.companies[0].id, first.company.id);
    await assert.rejects(convert(106, { company: id(999) }), /unavailable/);
    assert.equal((await convert(106, { company: first.company.id })).company.id, first.company.id);

    // Force a failure after inserts, at timeline creation; the entire function rolls back.
    await db.exec(`RESET ROLE; CREATE FUNCTION fail_conversion_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.subject='Lead converted' THEN RAISE EXCEPTION 'injected timeline failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_note BEFORE INSERT ON crm_activities FOR EACH ROW EXECUTE FUNCTION fail_conversion_note(); SET ROLE authenticated;`);
    const beforeFailure = [await count('contacts'), await count('companies'), await count('deals')];
    await assert.rejects(convert(105), /injected timeline failure/);
    assert.deepEqual([await count('contacts'), await count('companies'), await count('deals')], beforeFailure);
    assert.equal((await db.query<{ converted_at: unknown }>(`SELECT converted_at FROM leads WHERE id='${id(105)}'`)).rows[0].converted_at, null);
    await db.exec('RESET ROLE; DROP TRIGGER fail_note ON crm_activities; SET ROLE authenticated;');
    await assert.rejects(convert(105, { value: -1 }), /out of range/);

    await db.exec(`SELECT set_config('test.member','${id(12)}',false);`);
    assert.ok(await count('leads') > 0, 'support retains read access');
    await assert.rejects(convert(105), /not permitted/);
    assert.equal((await db.query(`UPDATE leads SET first_name='Hacked' RETURNING id`)).rows.length, 0);
    await assert.rejects(db.exec(`INSERT INTO contacts(organization_id,first_name) VALUES ('${id(1)}','Forbidden')`), /row-level security/);
    await db.exec(`SELECT set_config('test.member','${id(13)}',false);`);
    assert.ok((await convert(101)).contact.id, 'administrator may convert another owner lead');
    await assert.rejects(db.exec(`UPDATE leads SET owner_id='${id(20)}' WHERE id='${id(105)}'`), /same organization/);
    await assert.rejects(db.exec(`UPDATE leads SET organization_id='${id(2)}' WHERE id='${id(105)}'`), /cannot move/);

    // Reporting fixtures use minimal integration tables; CRM tables above are the real schema.
    await db.exec(`RESET ROLE;
      CREATE TABLE invoices(organization_id uuid,company_id uuid,currency text,total numeric,amount_paid numeric,due_date date,status text,deleted_at timestamptz);
      CREATE TABLE projects(id uuid,organization_id uuid,client_company_id uuid,status text,deleted_at timestamptz);
      CREATE VIEW v_project_health WITH (security_invoker=true) AS SELECT id AS project_id, organization_id, false AS is_at_risk FROM projects;
      CREATE TABLE support_tickets(organization_id uuid,contact_id uuid,status text,deleted_at timestamptz);
      GRANT SELECT ON invoices,projects,v_project_health,support_tickets TO authenticated;
      INSERT INTO deals(organization_id,company_id,owner_id,name,value) SELECT '${id(1)}','${first.company.id}','${id(10)}','Scale ' || n,10 FROM generate_series(1,1500) n;
      INSERT INTO invoices VALUES ('${id(1)}','${first.company.id}','NGN',100,20,'2026-01-01','sent',NULL),
        ('${id(1)}','${first.company.id}','USD',200,50,'2026-01-01','sent',NULL),
        ('${id(1)}','${first.company.id}','USD',999,0,'2026-01-01','cancelled',NULL);
      INSERT INTO support_tickets VALUES ('${id(1)}','${first.contact.id}','open',NULL);
    `);
    await db.exec(readFileSync('supabase/migrations/0051_crm_account_summary.sql', 'utf8'));
    await db.exec('SET ROLE authenticated;');
    const summary = async () => (await db.query<{ data: any }>('SELECT crm_account_summary($1,$2,$3) data', [id(1),first.company.id,'2026-10-25'])).rows[0].data;
    const report = await summary();
    assert.equal(report.open_deals, 1503);
    assert.equal(report.open_deal_value, 15376.5);
    assert.deepEqual(report.invoice_balances, [{ currency: 'NGN', outstanding: 80, overdue: 1 }, { currency: 'USD', outstanding: 150, overdue: 1 }]);
    assert.equal(report.open_tickets, 1);
    await db.exec(`SELECT set_config('test.member','${id(11)}',false);`);
    const colleagueReport = await summary();
    assert.equal(colleagueReport.open_deals, 0);
    assert.deepEqual(colleagueReport.invoice_balances, []);
    assert.equal(colleagueReport.open_tickets, 0);
    console.log('SQL assertions passed; fixtures use local embedded Postgres only.');
  } finally { await db.close(); }
});

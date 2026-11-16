-- Additive commercial ledger. Authenticated clients cannot bypass transactional writes.
CREATE TABLE IF NOT EXISTS crm_commercial_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 kind text NOT NULL CHECK(kind IN ('quote','proposal','contract','renewal')),
 number text NOT NULL, title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 company_id uuid NOT NULL REFERENCES companies(id), contact_id uuid REFERENCES contacts(id), deal_id uuid REFERENCES deals(id),
 owner_id uuid NOT NULL REFERENCES organization_members(id), parent_id uuid REFERENCES crm_commercial_records(id),
 quote_version_id uuid, status text NOT NULL DEFAULT 'draft', revision integer NOT NULL DEFAULT 1,
 currency text NOT NULL, total numeric NOT NULL DEFAULT 0 CHECK(total>=0),
 issue_date date NOT NULL DEFAULT current_date, expires_on date, effective_on date,
 content jsonb NOT NULL DEFAULT '{}', pricing jsonb NOT NULL DEFAULT '{}',
 submitted_by uuid REFERENCES organization_members(id), approved_version_id uuid, issued_version_id uuid, executed_version_id uuid,
 created_by uuid NOT NULL REFERENCES organization_members(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,number), UNIQUE(organization_id,id), CHECK(expires_on IS NULL OR effective_on IS NULL OR expires_on>=effective_on)
);
CREATE TABLE IF NOT EXISTS crm_commercial_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, record_id uuid NOT NULL,
 revision integer NOT NULL, purpose text NOT NULL, snapshot jsonb NOT NULL, created_by uuid NOT NULL REFERENCES organization_members(id),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,record_id) REFERENCES crm_commercial_records(organization_id,id), UNIQUE(record_id,revision,purpose)
);
DO $$ BEGIN
ALTER TABLE crm_commercial_records ADD FOREIGN KEY(quote_version_id) REFERENCES crm_commercial_versions(id),
 ADD FOREIGN KEY(approved_version_id) REFERENCES crm_commercial_versions(id), ADD FOREIGN KEY(issued_version_id) REFERENCES crm_commercial_versions(id), ADD FOREIGN KEY(executed_version_id) REFERENCES crm_commercial_versions(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS crm_commercial_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, record_id uuid NOT NULL,
 revision integer NOT NULL, operation text NOT NULL, note text NOT NULL DEFAULT '', actor_id uuid NOT NULL REFERENCES organization_members(id),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,record_id) REFERENCES crm_commercial_records(organization_id,id)
);
CREATE TABLE IF NOT EXISTS crm_commercial_policies (
 organization_id uuid NOT NULL PRIMARY KEY REFERENCES organizations(id), revision integer NOT NULL DEFAULT 1,
 allow_self_approval boolean NOT NULL DEFAULT false, approver_roles text[] NOT NULL DEFAULT ARRAY['owner','administrator'],
 updated_at timestamptz NOT NULL DEFAULT now(), CHECK(approver_roles <@ ARRAY['owner','administrator']::text[] AND cardinality(approver_roles)>0)
);
CREATE TABLE IF NOT EXISTS crm_commercial_taxes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100), rate numeric NOT NULL CHECK(rate BETWEEN 0 AND 100 AND rate=round(rate,4)),
 active boolean NOT NULL DEFAULT true, UNIQUE(organization_id,name)
);
CREATE TABLE IF NOT EXISTS crm_commercial_obligations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, record_id uuid NOT NULL,
 description text NOT NULL CHECK(length(description) BETWEEN 1 AND 2000), owner_id uuid NOT NULL REFERENCES organization_members(id),
 due_on date NOT NULL, priority text NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','cancelled')), evidence text NOT NULL DEFAULT '',
 revision integer NOT NULL DEFAULT 1, activity_id uuid REFERENCES crm_activities(id), created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 FOREIGN KEY(organization_id,record_id) REFERENCES crm_commercial_records(organization_id,id)
);
CREATE TABLE IF NOT EXISTS crm_commercial_files (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, record_id uuid NOT NULL, filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 250),
 mime_type text NOT NULL CHECK(mime_type IN ('application/pdf','image/png','image/jpeg')), size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760),
 storage_path text NOT NULL UNIQUE, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), created_by uuid NOT NULL REFERENCES organization_members(id),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,record_id) REFERENCES crm_commercial_records(organization_id,id)
);
CREATE INDEX IF NOT EXISTS commercial_directory ON crm_commercial_records(organization_id,kind,updated_at DESC,id);
CREATE INDEX IF NOT EXISTS commercial_company ON crm_commercial_records(organization_id,company_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS commercial_deal ON crm_commercial_records(organization_id,deal_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS commercial_owner ON crm_commercial_records(organization_id,owner_id,status);
CREATE INDEX IF NOT EXISTS commercial_expiration ON crm_commercial_records(organization_id,expires_on,status);
CREATE INDEX IF NOT EXISTS commercial_versions ON crm_commercial_versions(record_id,created_at DESC);
CREATE INDEX IF NOT EXISTS commercial_history ON crm_commercial_history(record_id,created_at DESC);
CREATE INDEX IF NOT EXISTS commercial_obligations_due ON crm_commercial_obligations(organization_id,status,due_on);
CREATE INDEX IF NOT EXISTS commercial_files_record ON crm_commercial_files(record_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.crm_commercial_visible(p_org uuid,p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM crm_commercial_records r WHERE r.id=p_id AND r.organization_id=p_org AND crm_record_visible(p_org,r.owner_id)
 AND (r.deal_id IS NULL OR crm_entity_visible(p_org,'deal',r.deal_id)))
$$;
REVOKE ALL ON FUNCTION crm_commercial_visible(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_commercial_visible(uuid,uuid) TO authenticated;
ALTER TABLE crm_commercial_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_commercial_records FROM anon,authenticated;
GRANT SELECT ON crm_commercial_records TO authenticated;
DROP POLICY IF EXISTS commercial_read ON crm_commercial_records;
CREATE POLICY commercial_read ON crm_commercial_records FOR SELECT TO authenticated USING(crm_commercial_visible(organization_id,id));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['crm_commercial_versions','crm_commercial_history','crm_commercial_obligations','crm_commercial_files'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON %I FROM anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON %I TO authenticated',t);
  EXECUTE format('DROP POLICY IF EXISTS commercial_read ON %I',t);
  EXECUTE format('CREATE POLICY commercial_read ON %I FOR SELECT TO authenticated USING(crm_commercial_visible(organization_id,record_id))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['crm_commercial_policies','crm_commercial_taxes'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON %I FROM anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON %I TO authenticated',t);
  EXECUTE format('DROP POLICY IF EXISTS commercial_read ON %I',t);
  EXECUTE format('CREATE POLICY commercial_read ON %I FOR SELECT TO authenticated USING(can_access_module(organization_id,''crm''))',t);
 END LOOP;
END $$;

-- Currency precision is explicit; no rates or implicit conversions.
CREATE TABLE IF NOT EXISTS crm_commercial_currencies(code text PRIMARY KEY, decimals integer NOT NULL CHECK(decimals BETWEEN 0 AND 4));
ALTER TABLE crm_commercial_currencies ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON crm_commercial_currencies TO authenticated;
DROP POLICY IF EXISTS currency_read ON crm_commercial_currencies;
CREATE POLICY currency_read ON crm_commercial_currencies FOR SELECT TO authenticated USING(true);
INSERT INTO crm_commercial_currencies VALUES ('USD',2),('NGN',2),('EUR',2),('GBP',2),('JPY',0),('KWD',3),('BHD',3),('CAD',2),('AUD',2),('CHF',2),('ZAR',2),('GHS',2),('KES',2),('AED',2),('INR',2),('CNY',2) ON CONFLICT(code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.crm_commercial_price(p_org uuid,p_currency text,p_content jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE digits integer; item jsonb; q numeric; unit_price numeric; pct numeric; doc_pct numeric; rate numeric; gross numeric; discount numeric; net numeric; tax numeric;
 subtotal numeric:=0; discounts numeric:=0; taxes numeric:=0; total numeric:=0; charges numeric; lines jsonb:='[]'; tax_name text;
BEGIN
 SELECT decimals INTO digits FROM crm_commercial_currencies WHERE code=p_currency;
 IF digits IS NULL THEN RAISE EXCEPTION 'Unsupported currency' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_content->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_content->'items')>100 THEN RAISE EXCEPTION 'Provide up to 100 line items' USING ERRCODE='22023'; END IF;
 doc_pct:=coalesce((p_content->>'discountPercent')::numeric,0); charges:=coalesce((p_content->>'charges')::numeric,0);
 IF doc_pct NOT BETWEEN 0 AND 100 OR doc_pct<>round(doc_pct,4) OR charges<0 OR charges>1e12 OR charges<>round(charges,digits) THEN RAISE EXCEPTION 'Invalid discount or charge precision' USING ERRCODE='22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_content->'items') LOOP
  q:=(item->>'quantity')::numeric;unit_price:=(item->>'unitPrice')::numeric;pct:=coalesce((item->>'discountPercent')::numeric,0);
  IF q IS NULL OR unit_price IS NULL OR q<=0 OR q>1e8 OR q<>round(q,4) OR unit_price<0 OR unit_price>1e12 OR unit_price<>round(unit_price,digits) OR pct NOT BETWEEN 0 AND 100 OR pct<>round(pct,4) OR length(coalesce(item->>'description','')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Invalid line item or monetary precision' USING ERRCODE='22023'; END IF;
  rate:=0;tax_name:='No tax';
  IF nullif(item->>'taxId','') IS NOT NULL THEN
   SELECT t.rate,t.name INTO rate,tax_name FROM crm_commercial_taxes t WHERE id=(item->>'taxId')::uuid AND organization_id=p_org AND active;
   IF rate IS NULL THEN RAISE EXCEPTION 'Choose an active organization tax rule' USING ERRCODE='22023';END IF;
  END IF;
  gross:=round(q*unit_price,digits);
  discount:=round(gross*pct/100,digits);discount:=discount+round((gross-discount)*doc_pct/100,digits);
  net:=gross-discount;
  IF coalesce((p_content->>'taxInclusive')::boolean,false) THEN tax:=round(net-net/(1+rate/100),digits);net:=net-tax;
  ELSE tax:=round(net*rate/100,digits); END IF;
  subtotal:=subtotal+gross;discounts:=discounts+discount;taxes:=taxes+tax;total:=total+net+tax;
  lines:=lines||jsonb_build_array(item||jsonb_build_object('taxName',tax_name,'taxRate',rate::text,'subtotal',gross::text,'discount',discount::text,'net',net::text,'tax',tax::text,'total',(net+tax)::text));
 END LOOP;
 RETURN jsonb_build_object('currency',p_currency,'decimals',digits,'subtotal',subtotal::text,'discount',discounts::text,'tax',taxes::text,'charges',charges::text,'total',(total+charges)::text,'lines',lines,'rounding','Half up per line; line discount then document discount; charges are explicitly non-taxable');
END $$;
REVOKE ALL ON FUNCTION crm_commercial_price(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.crm_commercial_save(p_org uuid,p_id uuid,p_revision integer,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r crm_commercial_records%ROWTYPE; rid uuid:=coalesce(p_id,gen_random_uuid()); member uuid:=auth_member_id(p_org); c jsonb:=p_data->'content'; price jsonb; quote crm_commercial_versions%ROWTYPE;
 company uuid:=(p_data->>'companyId')::uuid; contact uuid:=nullif(p_data->>'contactId','')::uuid; deal uuid:=nullif(p_data->>'dealId','')::uuid;
 owner uuid:=coalesce(nullif(p_data->>'ownerId','')::uuid,member); parent uuid:=nullif(p_data->>'parentId','')::uuid; qv uuid:=nullif(p_data->>'quoteVersionId','')::uuid;
BEGIN
 IF member IS NULL OR auth_role_in(p_org) NOT IN ('owner','administrator','manager','sales_staff') THEN RAISE EXCEPTION 'Commercial editing not permitted' USING ERRCODE='42501'; END IF;
 IF p_id IS NOT NULL THEN
  SELECT * INTO r FROM crm_commercial_records WHERE id=p_id AND organization_id=p_org AND crm_commercial_visible(p_org,id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Record not found' USING ERRCODE='P0002'; END IF;
  IF r.revision<>p_revision THEN RAISE EXCEPTION 'Stale revision' USING ERRCODE='PT409'; END IF;
  IF r.status NOT IN ('draft','changes_requested','rejected','in_preparation','negotiating','upcoming') THEN RAISE EXCEPTION 'Create a revision before editing approved or issued terms' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_data->>'kind' NOT IN ('quote','proposal','contract','renewal') OR (p_id IS NOT NULL AND p_data->>'kind'<>r.kind) OR length(coalesce(p_data->>'title','')) NOT BETWEEN 1 AND 200 OR octet_length(c::text)>200000 OR jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid commercial document' USING ERRCODE='22023';END IF;
 IF NOT crm_entity_visible(p_org,'company',company) OR company IS NULL THEN RAISE EXCEPTION 'Customer not available' USING ERRCODE='42501';END IF;
 IF contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM contacts WHERE id=contact AND organization_id=p_org AND company_id=company AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Contact must belong to this customer' USING ERRCODE='42501';END IF;
 IF deal IS NOT NULL AND NOT EXISTS(SELECT 1 FROM deals WHERE id=deal AND organization_id=p_org AND company_id=company AND crm_entity_visible(p_org,'deal',id)) THEN RAISE EXCEPTION 'Opportunity must belong to this customer and be accessible' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM organization_members WHERE id=owner AND organization_id=p_org AND is_active AND deleted_at IS NULL AND role IN ('owner','administrator','manager','sales_staff')) OR NOT crm_record_visible(p_org,owner) THEN RAISE EXCEPTION 'Invalid owner' USING ERRCODE='42501';END IF;
 IF parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_commercial_records WHERE id=parent AND organization_id=p_org AND company_id=company AND crm_commercial_visible(p_org,id)) THEN RAISE EXCEPTION 'Source agreement not available' USING ERRCODE='42501';END IF;
 IF p_data->>'kind'='renewal' AND NOT EXISTS(SELECT 1 FROM crm_commercial_records WHERE id=parent AND kind='contract' AND executed_version_id IS NOT NULL) THEN RAISE EXCEPTION 'Renewals require an executed source contract' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(c->'sections') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'sections')>40 OR EXISTS(SELECT 1 FROM jsonb_array_elements(c->'sections') s WHERE length(coalesce(s->>'title','')) NOT BETWEEN 1 AND 200 OR length(coalesce(s->>'body',''))>20000) THEN RAISE EXCEPTION 'Invalid document sections' USING ERRCODE='22023'; END IF;
 IF coalesce(c->>'renewalType','unknown') NOT IN ('manual','automatic','non_renewing','unknown') OR coalesce((c->>'noticeDays')::int,0) NOT BETWEEN 0 AND 3650 THEN RAISE EXCEPTION 'Invalid renewal terms' USING ERRCODE='22023'; END IF;
 price:=crm_commercial_price(p_org,p_data->>'currency',c);
 IF qv IS NOT NULL THEN
  SELECT v.* INTO quote FROM crm_commercial_versions v JOIN crm_commercial_records x ON x.id=v.record_id WHERE v.id=qv AND v.organization_id=p_org AND x.kind='quote' AND x.company_id=company AND v.purpose IN ('approved','issued') AND crm_commercial_visible(p_org,x.id);
  IF NOT FOUND OR quote.snapshot->>'currency'<>p_data->>'currency' OR jsonb_array_length(c->'items')>0 THEN RAISE EXCEPTION 'Choose an authorized approved quote version in this currency; remove independent pricing' USING ERRCODE='22023';END IF;
  price:=quote.snapshot->'pricing';
 END IF;
 IF p_id IS NULL THEN
  INSERT INTO crm_commercial_records(id,organization_id,kind,number,title,company_id,contact_id,deal_id,owner_id,parent_id,quote_version_id,currency,total,issue_date,expires_on,effective_on,content,pricing,created_by,status)
  VALUES(rid,p_org,p_data->>'kind',upper(left(p_data->>'kind',3))||'-'||upper(left(replace(rid::text,'-',''),12)),p_data->>'title',company,contact,deal,owner,parent,qv,p_data->>'currency',(price->>'total')::numeric,coalesce(nullif(p_data->>'issueDate','')::date,current_date),nullif(p_data->>'expiresOn','')::date,nullif(p_data->>'effectiveOn','')::date,c,price,member,CASE WHEN p_data->>'kind'='renewal' THEN 'upcoming' ELSE 'draft' END);
 ELSE
  UPDATE crm_commercial_records SET title=p_data->>'title',company_id=company,contact_id=contact,deal_id=deal,owner_id=owner,parent_id=parent,quote_version_id=qv,currency=p_data->>'currency',total=(price->>'total')::numeric,
   issue_date=coalesce(nullif(p_data->>'issueDate','')::date,current_date),expires_on=nullif(p_data->>'expiresOn','')::date,effective_on=nullif(p_data->>'effectiveOn','')::date,content=c,pricing=price,revision=revision+1,approved_version_id=NULL,submitted_by=NULL,status=CASE WHEN kind='renewal' THEN status ELSE 'draft' END,updated_at=now() WHERE id=rid;
 END IF;
 INSERT INTO crm_commercial_history(organization_id,record_id,revision,operation,actor_id) SELECT p_org,rid,revision,'saved',member FROM crm_commercial_records WHERE id=rid;
 RETURN rid;
END $$;
REVOKE ALL ON FUNCTION crm_commercial_save(uuid,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_commercial_save(uuid,uuid,integer,jsonb) TO authenticated;

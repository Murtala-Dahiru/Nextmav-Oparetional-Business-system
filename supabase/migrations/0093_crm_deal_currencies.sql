-- Native opportunity amounts: no conversion and no cross-currency summation.
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS currency text;
-- Backfill only the new column without rewriting commercial timestamps, revisions,
-- activities or immutable business-event snapshots. The transaction holds the table lock.
DO $backfill$
DECLARE enabled_triggers text[]; t text;
BEGIN
 SELECT array_agg(tgname) INTO enabled_triggers FROM pg_trigger WHERE tgrelid='public.deals'::regclass AND NOT tgisinternal AND tgenabled='O';
 FOREACH t IN ARRAY coalesce(enabled_triggers,ARRAY[]::text[]) LOOP EXECUTE format('ALTER TABLE public.deals DISABLE TRIGGER %I',t); END LOOP;
 UPDATE public.deals d SET currency=coalesce((SELECT btrim(e.payload->>'currency') FROM business_events e WHERE e.organization_id=d.organization_id AND e.entity_id=d.id AND e.entity_type='deal' AND e.payload->>'currency' ~ '^[A-Z]{3}$' ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1),btrim(public.org_currency(d.organization_id))) WHERE currency IS NULL;
 FOREACH t IN ARRAY coalesce(enabled_triggers,ARRAY[]::text[]) LOOP EXECUTE format('ALTER TABLE public.deals ENABLE TRIGGER %I',t); END LOOP;
END $backfill$;
ALTER TABLE public.deals ALTER COLUMN currency SET NOT NULL;
CREATE OR REPLACE FUNCTION public.crm_set_deal_currency() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.currency IS NULL THEN NEW.currency:=btrim(public.org_currency(NEW.organization_id)); END IF;
 IF NEW.currency IS NULL OR NOT(NEW.currency=ANY(ARRAY['AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CLP','CNY','COP','CRC','CUC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HRK','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SLL','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','UYU','UZS','VES','VND','VUV','WST','XAF','XCD','XCG','XDR','XOF','XPF','XSU','YER','ZAR','ZMW','ZWG','ZWL'])) THEN RAISE EXCEPTION 'Choose a supported ISO currency' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS aa_deal_currency ON public.deals;
CREATE TRIGGER aa_deal_currency BEFORE INSERT OR UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.crm_set_deal_currency();
REVOKE ALL ON FUNCTION public.crm_set_deal_currency() FROM PUBLIC;
CREATE INDEX IF NOT EXISTS idx_deals_pipeline_currency ON deals (organization_id,pipeline_id,currency,expected_close,id) WHERE deleted_at IS NULL;

CREATE OR REPLACE VIEW public.v_pipeline_summary WITH(security_invoker=true) AS  SELECT organization_id,
    stage,
    count(*) AS deal_count,
    COALESCE(sum((CASE WHEN d.currency=btrim(public.org_currency(d.organization_id)) THEN d.value END)), 0::numeric) AS total_value,
    COALESCE(sum((CASE WHEN d.currency=btrim(public.org_currency(d.organization_id)) THEN d.value END) * probability::numeric / 100.0), 0::numeric) AS weighted_value,
    COALESCE(avg(probability), 0::numeric) AS avg_probability
   FROM deals d
  WHERE deleted_at IS NULL
  GROUP BY organization_id, stage;

CREATE OR REPLACE VIEW public.v_sales_performance WITH(security_invoker=true) AS  SELECT d.organization_id,
    d.owner_id,
    p.full_name AS owner_name,
    count(*) AS total_deals,
    count(*) FILTER (WHERE d.stage = 'closed_won'::deal_stage) AS won_deals,
    count(*) FILTER (WHERE d.stage = 'closed_lost'::deal_stage) AS lost_deals,
    COALESCE(sum((CASE WHEN d.currency=btrim(public.org_currency(d.organization_id)) THEN d.value END)) FILTER (WHERE d.stage = 'closed_won'::deal_stage), 0::numeric) AS won_value,
    COALESCE(sum((CASE WHEN d.currency=btrim(public.org_currency(d.organization_id)) THEN d.value END)) FILTER (WHERE d.stage <> ALL (ARRAY['closed_won'::deal_stage, 'closed_lost'::deal_stage])), 0::numeric) AS open_value,
        CASE
            WHEN count(*) FILTER (WHERE d.stage = ANY (ARRAY['closed_won'::deal_stage, 'closed_lost'::deal_stage])) = 0 THEN 0::numeric
            ELSE round(100.0 * count(*) FILTER (WHERE d.stage = 'closed_won'::deal_stage)::numeric / count(*) FILTER (WHERE d.stage = ANY (ARRAY['closed_won'::deal_stage, 'closed_lost'::deal_stage]))::numeric, 1)
        END AS win_rate
   FROM deals d
     LEFT JOIN organization_members om ON om.id = d.owner_id
     LEFT JOIN profiles p ON p.id = om.user_id
  WHERE d.deleted_at IS NULL
  GROUP BY d.organization_id, d.owner_id, p.full_name;

CREATE OR REPLACE VIEW public.v_crm_pipeline_owner WITH(security_invoker=true) AS  SELECT organization_id,
    owner_id,
    stage,
    count(*) AS deal_count,
    COALESCE(sum((CASE WHEN d.currency=btrim(public.org_currency(d.organization_id)) THEN d.value END)), 0::numeric) AS total_value,
    COALESCE(sum((CASE WHEN d.currency=btrim(public.org_currency(d.organization_id)) THEN d.value END) * probability::numeric / 100.0), 0::numeric) AS weighted_value
   FROM deals d
  WHERE deleted_at IS NULL
  GROUP BY organization_id, owner_id, stage;

CREATE OR REPLACE VIEW public.v_dashboard_stats WITH(security_invoker=true) AS  SELECT id AS organization_id,
    ( SELECT count(*) AS count
           FROM organization_members om
          WHERE om.organization_id = o.id AND om.is_active) AS headcount,
    ( SELECT count(*) AS count
           FROM departments d
          WHERE d.organization_id = o.id AND d.deleted_at IS NULL) AS department_count,
    ( SELECT count(*) AS count
           FROM profiles p
             JOIN organization_members om2 ON om2.user_id = p.id
          WHERE om2.organization_id = o.id AND p.last_seen_at > (now() - '00:15:00'::interval)) AS online_now,
    ( SELECT count(*) AS count
           FROM projects pr
          WHERE pr.organization_id = o.id AND pr.status = 'active'::project_status AND pr.deleted_at IS NULL) AS active_projects,
    ( SELECT count(*) AS count
           FROM tasks t
          WHERE t.organization_id = o.id AND t.status <> 'done'::task_status AND t.deleted_at IS NULL) AS open_tasks,
    ( SELECT count(*) AS count
           FROM tasks t
          WHERE t.organization_id = o.id AND t.status <> 'done'::task_status AND t.due_date < CURRENT_DATE AND t.deleted_at IS NULL) AS overdue_tasks,
    ( SELECT count(*) AS count
           FROM support_tickets st
          WHERE st.organization_id = o.id AND (st.status <> ALL (ARRAY['resolved'::ticket_status, 'closed'::ticket_status])) AND st.deleted_at IS NULL) AS open_tickets,
    ( SELECT count(*) AS count
           FROM support_tickets st
          WHERE st.organization_id = o.id AND st.resolved_at IS NULL AND st.due_at < now() AND st.deleted_at IS NULL) AS breached_tickets,
    ( SELECT COALESCE(sum((CASE WHEN d.currency=btrim(public.org_currency(d.organization_id)) THEN d.value END) * d.probability::numeric / 100.0), 0::numeric) AS "coalesce"
           FROM deals d
          WHERE d.organization_id = o.id AND (d.stage <> ALL (ARRAY['closed_won'::deal_stage, 'closed_lost'::deal_stage])) AND d.deleted_at IS NULL) AS weighted_pipeline,
    ( SELECT COALESCE(sum((CASE WHEN d.currency=btrim(public.org_currency(d.organization_id)) THEN d.value END)), 0::numeric) AS "coalesce"
           FROM deals d
          WHERE d.organization_id = o.id AND (d.stage <> ALL (ARRAY['closed_won'::deal_stage, 'closed_lost'::deal_stage])) AND d.deleted_at IS NULL) AS open_pipeline,
    ( SELECT COALESCE(sum(i.total), 0::numeric) AS "coalesce"
           FROM invoices i
          WHERE i.organization_id = o.id AND i.status = 'paid'::invoice_status AND i.deleted_at IS NULL) AS revenue_collected,
    ( SELECT COALESCE(sum(i.total - i.amount_paid), 0::numeric) AS "coalesce"
           FROM invoices i
          WHERE i.organization_id = o.id AND (i.status <> ALL (ARRAY['paid'::invoice_status, 'cancelled'::invoice_status, 'draft'::invoice_status])) AND i.deleted_at IS NULL) AS receivables,
    ( SELECT count(*) AS count
           FROM leave_requests lr
          WHERE lr.organization_id = o.id AND lr.status = 'pending'::leave_status) AS pending_leave,
    ( SELECT count(*) AS count
           FROM expenses e
          WHERE e.organization_id = o.id AND e.status = 'pending'::expense_status AND e.deleted_at IS NULL) AS pending_expenses,
    ( SELECT count(*) AS count
           FROM products pr
          WHERE pr.organization_id = o.id AND pr.is_active AND pr.deleted_at IS NULL AND pr.stock <= pr.reorder_level) AS low_stock_products
   FROM organizations o
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.crm_pipeline_workspace(p_org uuid, p_pipeline uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$

 WITH visible AS (

  SELECT d.*,s.inactivity_days,

    CASE WHEN d.stage='closed_won' THEN 'won' WHEN d.stage='closed_lost' THEN 'lost' ELSE d.forecast_category END bucket

  FROM deals d LEFT JOIN crm_pipeline_stages s ON s.id=d.pipeline_stage_id AND s.organization_id=d.organization_id

  WHERE d.organization_id=p_org AND d.pipeline_id=p_pipeline AND d.deleted_at IS NULL AND d.currency=coalesce(nullif(p_filters->>'currency',''),btrim(public.org_currency(p_org)))

    AND public.crm_record_visible(d.organization_id,d.owner_id)

    AND (coalesce(p_filters->>'forecastCategory','')='' OR d.forecast_category=p_filters->>'forecastCategory')

    AND (coalesce(p_filters->>'stage','')='' OR (p_filters->>'stage'='open' AND d.stage NOT IN ('closed_won','closed_lost')) OR d.stage::text=p_filters->>'stage')

    AND (coalesce(p_filters->>'search','')='' OR position(lower(p_filters->>'search') in lower(d.name))>0 OR position(lower(p_filters->>'search') in lower(coalesce(d.notes,'')))>0)

    AND (nullif(p_filters->>'ownerId','') IS NULL OR d.owner_id=(p_filters->>'ownerId')::uuid)

    AND (nullif(p_filters->>'teamMemberId','') IS NULL OR (p_filters->>'teamMemberId')::uuid=ANY(d.deal_team_ids))

    AND (nullif(p_filters->>'companyId','') IS NULL OR d.company_id=(p_filters->>'companyId')::uuid)

    AND (nullif(p_filters->>'pipelineStageId','') IS NULL OR d.pipeline_stage_id=(p_filters->>'pipelineStageId')::uuid)

    AND (nullif(p_filters->>'closeFrom','') IS NULL OR d.expected_close>=(p_filters->>'closeFrom')::date)

    AND (nullif(p_filters->>'closeTo','') IS NULL OR d.expected_close<=(p_filters->>'closeTo')::date)

    AND (nullif(p_filters->>'minValue','') IS NULL OR d.value>=(p_filters->>'minValue')::numeric)

    AND (nullif(p_filters->>'maxValue','') IS NULL OR d.value<=(p_filters->>'maxValue')::numeric)

 ), facts AS (

  SELECT v.*,

   (SELECT max(coalesce(a.completed_at,a.created_at)) FROM crm_activities a WHERE a.organization_id=p_org AND a.deal_id=v.id AND a.activity_type IN ('call','email','meeting','video','visit','demo') AND (a.due_at IS NULL OR a.completed_at IS NOT NULL)) last_activity,

   (SELECT max(e.created_at) FROM crm_pipeline_events e WHERE e.organization_id=p_org AND e.deal_id=v.id AND e.to_stage_id=v.pipeline_stage_id AND e.from_stage_id IS DISTINCT FROM e.to_stage_id) stage_since,

   EXISTS(SELECT 1 FROM crm_activities a WHERE a.organization_id=p_org AND a.deal_id=v.id AND a.due_at<now() AND a.completed_at IS NULL) overdue_followup,

   EXISTS(SELECT 1 FROM crm_stage_approvals a JOIN crm_pipelines p ON p.id=v.pipeline_id WHERE a.organization_id=p_org AND a.deal_id=v.id AND a.status='pending' AND a.deal_version=v.pipeline_version AND a.pipeline_version=p.version) awaiting_approval

  FROM visible v WHERE v.stage NOT IN ('closed_won','closed_lost')

 ), risks AS (

  SELECT id,name,value,expected_close,next_step,last_activity,stage_since,

   array_remove(ARRAY[

    CASE WHEN expected_close<coalesce(nullif(p_filters->>'today','')::date,current_date) THEN 'Past expected close' END,

    CASE WHEN btrim(next_step)='' THEN 'Missing next step' END,

    CASE WHEN overdue_followup THEN 'Overdue follow-up' END,

    CASE WHEN awaiting_approval THEN 'Awaiting approval' END,
    CASE WHEN NOT EXISTS(SELECT 1 FROM crm_opportunity_plans p CROSS JOIN LATERAL jsonb_array_elements(p.stakeholders) s WHERE p.organization_id=p_org AND p.deal_id=facts.id AND s->>'role' IN ('decision_maker','economic_buyer')) THEN 'No documented opportunity decision-maker' END,
    CASE WHEN EXISTS(SELECT 1 FROM crm_pipeline_stages s CROSS JOIN LATERAL unnest(s.required_fields) field JOIN deals d ON d.id=facts.id WHERE s.id=facts.pipeline_stage_id AND s.organization_id=p_org AND (crm_visible_deal_requirement(p_org,d.id,field) IS NULL OR crm_visible_deal_requirement(p_org,d.id,field)='null'::jsonb OR btrim(crm_visible_deal_requirement(p_org,d.id,field)#>>'{}')='' OR (field='value' AND d.value<=0))) THEN 'Incomplete current-stage evidence' END,

    CASE WHEN coalesce(last_activity,created_at)<now()-make_interval(days=>coalesce(inactivity_days,30)) THEN 'No recent recorded engagement' END,

    CASE WHEN stage_since<now()-make_interval(days=>coalesce(inactivity_days,30)) THEN 'Long stage duration' END

   ],NULL) signals,inactivity_days

  FROM facts

 ), stages AS (

  SELECT pipeline_stage_id stage_id,count(*) deal_count,sum(value) total_value,sum(CASE WHEN stage IN ('closed_won','closed_lost') THEN 0 ELSE value*probability/100 END) weighted_value

  FROM visible GROUP BY pipeline_stage_id

 ), forecast AS (

  SELECT bucket category,count(*) deal_count,sum(value) total_value,sum(CASE WHEN bucket IN ('won','lost','omitted') THEN 0 ELSE value*probability/100 END) weighted_value

  FROM visible GROUP BY bucket

 ) SELECT jsonb_build_object(

  'currency',coalesce(nullif(p_filters->>'currency',''),btrim(public.org_currency(p_org))),
 'currencies',coalesce((SELECT jsonb_agg(c.currency ORDER BY c.currency) FROM (SELECT DISTINCT currency FROM deals WHERE organization_id=p_org AND pipeline_id=p_pipeline AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id)) c),'[]'::jsonb),
 'stages',coalesce((SELECT jsonb_agg(to_jsonb(stages)) FROM stages),'[]'::jsonb),

  'forecast',coalesce((SELECT jsonb_agg(to_jsonb(forecast)) FROM forecast),'[]'::jsonb),

  'risks',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM risks WHERE cardinality(signals)>0 ORDER BY cardinality(signals) DESC,id LIMIT 50) r),'[]'::jsonb),

  'riskCount',(SELECT count(*) FROM risks WHERE cardinality(signals)>0),

  'periods',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM (SELECT coalesce(to_char(expected_close,'YYYY-MM'),'Unscheduled') period,count(*) deal_count,sum(value) total_value,sum(value*probability/100) weighted_value FROM visible WHERE stage NOT IN ('closed_won','closed_lost') AND forecast_category<>'omitted' GROUP BY 1 ORDER BY 1) m),'[]'::jsonb),

  'owners',coalesce((SELECT jsonb_agg(to_jsonb(o)) FROM (SELECT owner_id,count(*) deal_count,sum(value) total_value,sum(value*probability/100) weighted_value FROM visible WHERE stage NOT IN ('closed_won','closed_lost') AND forecast_category<>'omitted' GROUP BY owner_id ORDER BY sum(value) DESC) o),'[]'::jsonb),

  'lossReasons',coalesce((SELECT jsonb_agg(to_jsonb(l)) FROM (SELECT coalesce(nullif(btrim(lost_reason),''),'Not recorded') reason,count(*) deal_count FROM visible WHERE stage='closed_lost' GROUP BY 1 ORDER BY count(*) DESC LIMIT 20) l),'[]'::jsonb),

  'averageWonCycleDays',(SELECT round(avg(extract(epoch FROM (closed_at-created_at))/86400),1) FROM visible WHERE stage='closed_won' AND closed_at>=created_at),

  'stageConversion',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM (

   SELECT source.id stage_id,count(DISTINCT e.deal_id) departed_deals,count(DISTINCT e.deal_id) FILTER(WHERE target.position>source.position AND target.canonical_stage<>'closed_lost') advanced_deals

   FROM crm_pipeline_events e JOIN visible v ON v.id=e.deal_id JOIN crm_pipeline_stages source ON source.id=e.from_stage_id JOIN crm_pipeline_stages target ON target.id=e.to_stage_id

   WHERE e.organization_id=p_org AND e.from_stage_id IS DISTINCT FROM e.to_stage_id AND source.canonical_stage NOT IN ('closed_won','closed_lost')

   GROUP BY source.id

  ) c),'[]'::jsonb),

  'stageAging',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT pipeline_stage_id stage_id,count(*) deal_count,count(stage_since) known_entry_count,round(avg(extract(epoch FROM (now()-stage_since))/86400),1) average_days FROM facts GROUP BY pipeline_stage_id) a),'[]'::jsonb),

  'metrics',(SELECT jsonb_build_object(

   'openCount',count(*) FILTER(WHERE stage NOT IN ('closed_won','closed_lost')),

   'openValue',coalesce(sum(value) FILTER(WHERE stage NOT IN ('closed_won','closed_lost')),0),

   'weightedValue',coalesce(sum(value*probability/100) FILTER(WHERE stage NOT IN ('closed_won','closed_lost')),0),

   'closingSoon',count(*) FILTER(WHERE stage NOT IN ('closed_won','closed_lost') AND expected_close BETWEEN coalesce(nullif(p_filters->>'today','')::date,current_date) AND coalesce(nullif(p_filters->>'today','')::date,current_date)+14),

   'pastClose',count(*) FILTER(WHERE stage NOT IN ('closed_won','closed_lost') AND expected_close<coalesce(nullif(p_filters->>'today','')::date,current_date)),

   'missingNextStep',count(*) FILTER(WHERE stage NOT IN ('closed_won','closed_lost') AND btrim(next_step)=''),

   'averageAge',coalesce(round(avg(extract(epoch FROM (now()-created_at))/86400) FILTER(WHERE stage NOT IN ('closed_won','closed_lost'))),0),

   'wonCount',count(*) FILTER(WHERE stage='closed_won'),

   'lostCount',count(*) FILTER(WHERE stage='closed_lost'),

   'wonValue',coalesce(sum(value) FILTER(WHERE stage='closed_won'),0)

  ) FROM visible)

 )

$function$
;

CREATE OR REPLACE FUNCTION public.crm_account_summary(p_org uuid, p_company uuid, p_today date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH customer AS (
    SELECT id FROM companies WHERE id = p_company AND organization_id = p_org AND deleted_at IS NULL
      AND public.can_access_module(p_org, 'crm')
  ), deal_totals AS (
    SELECT count(*) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')) AS open_count,
      coalesce(sum(CASE WHEN currency=btrim(public.org_currency(p_org)) THEN value END) FILTER (WHERE stage NOT IN ('closed_won','closed_lost')),0) AS open_value,
      coalesce(sum(CASE WHEN currency=btrim(public.org_currency(p_org)) THEN value END) FILTER (WHERE stage = 'closed_won'),0) AS won_value
    FROM deals WHERE organization_id = p_org AND company_id IN (SELECT id FROM customer) AND deleted_at IS NULL
      AND public.crm_record_visible(organization_id,owner_id)
  ), invoice_totals AS (
    SELECT currency, coalesce(sum(greatest(total - amount_paid,0)),0) AS outstanding,
      count(*) FILTER (WHERE due_date < p_today) AS overdue
    FROM invoices WHERE organization_id = p_org AND company_id IN (SELECT id FROM customer) AND deleted_at IS NULL
      AND status NOT IN ('paid','cancelled') AND public.can_access_module(p_org,'finance')
    GROUP BY currency
  ), project_totals AS (
    SELECT count(*) FILTER (WHERE p.status IN ('active','planning')) AS active,
      count(*) FILTER (WHERE h.is_at_risk) AS at_risk
    FROM projects p LEFT JOIN v_project_health h ON h.project_id=p.id AND h.organization_id=p.organization_id
    WHERE p.organization_id=p_org AND p.client_company_id IN (SELECT id FROM customer) AND p.deleted_at IS NULL
      AND public.can_access_module(p_org,'projects')
  )
  SELECT jsonb_build_object(
    'deal_currencies',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.currency) FROM (SELECT currency,count(*) FILTER(WHERE stage NOT IN ('closed_won','closed_lost')) open_count,coalesce(sum(value) FILTER(WHERE stage NOT IN ('closed_won','closed_lost')),0) open_value,coalesce(sum(value) FILTER(WHERE stage='closed_won'),0) won_value FROM deals WHERE organization_id=p_org AND company_id IN(SELECT id FROM customer) AND deleted_at IS NULL AND public.crm_record_visible(organization_id,owner_id) GROUP BY currency) g),'[]'::jsonb),
 'contacts', (SELECT count(*) FROM contacts WHERE organization_id=p_org AND company_id IN (SELECT id FROM customer) AND deleted_at IS NULL),
    'open_deals', d.open_count, 'open_deal_value', d.open_value, 'won_deal_value', d.won_value,
    'active_projects', p.active, 'projects_at_risk', p.at_risk,
    'last_contact', (SELECT max(coalesce(completed_at,created_at)) FROM crm_activities WHERE organization_id=p_org AND company_id IN (SELECT id FROM customer) AND (due_at IS NULL OR completed_at IS NOT NULL)),
    'next_follow_up', (SELECT min(due_at) FROM crm_activities WHERE organization_id=p_org AND company_id IN (SELECT id FROM customer) AND completed_at IS NULL),
    'invoice_balances', coalesce((SELECT jsonb_agg(jsonb_build_object('currency',currency,'outstanding',outstanding,'overdue',overdue) ORDER BY currency) FROM invoice_totals),'[]'),
    'open_tickets', (SELECT count(*) FROM support_tickets t JOIN contacts c ON c.id=t.contact_id AND c.organization_id=t.organization_id
      WHERE t.organization_id=p_org AND c.company_id IN (SELECT id FROM customer) AND c.deleted_at IS NULL AND t.deleted_at IS NULL
      AND t.status NOT IN ('resolved','closed') AND public.can_access_module(p_org,'support'))
  ) FROM deal_totals d CROSS JOIN project_totals p;
$function$
;

CREATE OR REPLACE FUNCTION public.crm_pipeline_summary(p_org uuid, p_pipeline uuid, p_search text DEFAULT ''::text, p_owner uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(stage_id uuid, deal_count bigint, total_value numeric, weighted_value numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT d.pipeline_stage_id,count(*),coalesce(sum(d.value),0),coalesce(sum(d.value*d.probability/100),0)
 FROM deals d WHERE d.organization_id=p_org AND d.pipeline_id=p_pipeline AND d.deleted_at IS NULL AND d.currency=btrim(public.org_currency(p_org))
 AND public.crm_record_visible(d.organization_id,d.owner_id)
 AND (coalesce(p_search,'')='' OR position(lower(p_search) in lower(d.name))>0 OR position(lower(p_search) in lower(coalesce(d.notes,'')))>0)
 AND (p_owner IS NULL OR d.owner_id=p_owner) AND (p_from IS NULL OR d.expected_close>=p_from) AND (p_to IS NULL OR d.expected_close<=p_to)
 GROUP BY d.pipeline_stage_id
$function$
;

CREATE OR REPLACE FUNCTION public.crm_pipeline_forecast(p_org uuid, p_pipeline uuid, p_search text DEFAULT ''::text, p_owner uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(category text, deal_count bigint, total_value numeric, weighted_value numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH visible AS (
  SELECT d.*,CASE WHEN d.stage='closed_won' THEN 'won' WHEN d.stage='closed_lost' THEN 'lost' ELSE d.forecast_category END AS bucket
  FROM deals d WHERE d.organization_id=p_org AND d.pipeline_id=p_pipeline AND d.deleted_at IS NULL AND d.currency=btrim(public.org_currency(p_org))
   AND public.crm_record_visible(d.organization_id,d.owner_id)
   AND (coalesce(p_search,'')='' OR position(lower(p_search) in lower(d.name))>0 OR position(lower(p_search) in lower(coalesce(d.notes,'')))>0)
   AND (p_owner IS NULL OR d.owner_id=p_owner)
   AND (p_from IS NULL OR d.expected_close>=p_from) AND (p_to IS NULL OR d.expected_close<=p_to)
 ) SELECT bucket,count(*),coalesce(sum(value),0),
   coalesce(sum(CASE WHEN bucket IN ('won','lost','omitted') THEN 0 ELSE value*probability/100 END),0)
 FROM visible GROUP BY bucket
$function$
;

-- Preserve immutable event snapshots; new events freeze the deal's own currency.
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.emit_deal_events()'::regprocedure) INTO definition;
 definition:=replace(definition,'public.org_currency(NEW.organization_id)','NEW.currency'); EXECUTE definition;
 SELECT pg_get_functiondef('public.crm_record_pipeline_event()'::regprocedure) INTO definition;
 definition:=replace(definition,'ARRAY[''value'',''probability''','ARRAY[''currency'',''value'',''probability'''); EXECUTE definition;
END $$;

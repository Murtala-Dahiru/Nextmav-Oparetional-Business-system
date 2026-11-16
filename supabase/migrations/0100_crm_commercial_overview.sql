CREATE OR REPLACE FUNCTION public.crm_commercial_overview(p_org uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH visible AS (SELECT * FROM crm_commercial_records WHERE organization_id=p_org), money AS (
 SELECT currency,
 coalesce(sum(total) FILTER(WHERE kind='quote' AND status IN ('draft','pending_approval','approved','issued','sent') AND (expires_on IS NULL OR expires_on>=current_date)),0)::text open_quotes,
 coalesce(sum(total) FILTER(WHERE kind='contract' AND status='active' AND executed_version_id IS NOT NULL AND effective_on<=current_date AND (expires_on IS NULL OR expires_on>=current_date)),0)::text active_contracts,
 coalesce(sum(total) FILTER(WHERE kind='contract' AND status='active' AND executed_version_id IS NOT NULL AND expires_on BETWEEN current_date AND current_date+90),0)::text expiring_contracts
 FROM visible GROUP BY currency), actions AS (
 SELECT id,kind,number,title,status,expires_on FROM visible WHERE status IN ('pending_approval','changes_requested','sent_for_signature','upcoming','in_preparation','negotiating','renewal_proposed') OR (expires_on<=current_date+30 AND status IN ('issued','sent','shared','active','executed')) ORDER BY expires_on NULLS LAST,updated_at LIMIT 20
 ), recent AS (SELECT * FROM crm_commercial_history WHERE organization_id=p_org AND created_at>=now()-interval '90 days')
 SELECT jsonb_build_object('currencies',coalesce((SELECT jsonb_agg(money) FROM money),'[]'),
 'counts',(SELECT jsonb_build_object('quoteApprovals',count(*) FILTER(WHERE kind='quote' AND status='pending_approval'),
 'customerDecisions',count(*) FILTER(WHERE kind IN ('quote','proposal') AND status IN ('sent','shared') AND (expires_on IS NULL OR expires_on>=current_date)),
 'proposalsInProgress',count(*) FILTER(WHERE kind='proposal' AND status IN ('draft','pending_approval','approved','issued','shared','changes_requested')),
 'contractApprovals',count(*) FILTER(WHERE kind='contract' AND status='pending_approval'),
 'awaitingSignature',count(*) FILTER(WHERE kind='contract' AND status='sent_for_signature'),
 'expiringContracts',count(*) FILTER(WHERE kind='contract' AND status IN ('active','executed') AND expires_on BETWEEN current_date AND current_date+90),
 'renewals',count(*) FILTER(WHERE kind='renewal' AND status NOT IN ('renewed','not_renewed','cancelled'))) FROM visible),
 'overdueObligations',(SELECT count(*) FROM crm_commercial_obligations WHERE organization_id=p_org AND status='open' AND due_on<current_date),
 'actions',coalesce((SELECT jsonb_agg(actions) FROM actions),'[]'),
 'decisions90Days',(SELECT jsonb_build_object('accepted',count(*) FILTER(WHERE operation='accept'),'declined',count(*) FILTER(WHERE operation='decline')) FROM recent),
 'asOf',now())
$$;
REVOKE ALL ON FUNCTION crm_commercial_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm_commercial_overview(uuid) TO authenticated;

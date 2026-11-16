-- Include witness and countersigner actions in the existing pending-signature overview.
CREATE OR REPLACE FUNCTION public.sign_overview(p_org uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
 'total',count(*),'completed',count(*) FILTER(WHERE status='completed'),
 'declined',count(*) FILTER(WHERE status='declined'),'draft',count(*) FILTER(WHERE status='draft'),
 'pending',count(*) FILTER(WHERE status IN ('sent','in_progress')),
 'awaitingSignature',count(*) FILTER(WHERE status IN ('sent','in_progress') AND EXISTS(SELECT 1 FROM jsonb_array_elements(data->'recipients') r WHERE r->>'role' IN ('signer','witness','countersigner') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'actions') a WHERE a->>'recipientId'=r->>'id'))),
 'awaitingApproval',count(*) FILTER(WHERE status IN ('sent','in_progress') AND EXISTS(SELECT 1 FROM jsonb_array_elements(data->'recipients') r WHERE r->>'role'='approver' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'actions') a WHERE a->>'recipientId'=r->>'id'))),
 'myAction',count(*) FILTER(WHERE status IN ('sent','in_progress') AND EXISTS(SELECT 1 FROM jsonb_array_elements(data->'recipients') r WHERE r->>'role'<>'viewer' AND lower(r->>'email')=lower(auth.jwt()->>'email') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'actions') a WHERE a->>'recipientId'=r->>'id'))),
 'expiring',count(*) FILTER(WHERE status IN ('sent','in_progress') AND (data->>'expiresAt')::timestamptz BETWEEN now() AND now()+interval '7 days'),
 'expired',count(*) FILTER(WHERE status IN ('sent','in_progress') AND (data->>'expiresAt')::timestamptz<now()),
 'failed',count(*) FILTER(WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(data->'events') v WHERE v->>'type'='invitation.failed'))
 ) FROM sign_envelopes WHERE organization_id=p_org AND archived_at IS NULL
$$;

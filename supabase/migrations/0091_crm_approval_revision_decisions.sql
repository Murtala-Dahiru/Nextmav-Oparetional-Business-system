CREATE OR REPLACE FUNCTION public.crm_decide_stage_approval(p_org uuid,p_id uuid,p_approve boolean,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request crm_stage_approvals%ROWTYPE; deal_revision integer; configuration_revision integer; pipeline uuid;
BEGIN
 IF auth_member_id(p_org) IS NULL OR auth_role_in(p_org) NOT IN ('owner','administrator') THEN RAISE EXCEPTION 'Stage approval is not permitted' USING ERRCODE='42501'; END IF;
 IF p_approve IS NULL OR length(coalesce(p_note,''))>4000 THEN RAISE EXCEPTION 'Invalid approval decision' USING ERRCODE='22023'; END IF;
 SELECT * INTO request FROM crm_stage_approvals WHERE id=p_id AND organization_id=p_org AND status='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Pending approval not found' USING ERRCODE='P0002'; END IF;
 -- Same lock order as stage movement: deal, pipeline, approval.
 SELECT pipeline_version,pipeline_id INTO deal_revision,pipeline FROM deals WHERE id=request.deal_id AND organization_id=p_org AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Deal not found' USING ERRCODE='P0002'; END IF;
 SELECT version INTO configuration_revision FROM crm_pipelines WHERE id=pipeline AND organization_id=p_org AND NOT archived FOR SHARE;
 IF configuration_revision IS NULL OR request.deal_version<>deal_revision OR request.pipeline_version<>configuration_revision THEN RAISE EXCEPTION 'Approval refers to an earlier revision; request a new review' USING ERRCODE='PT409'; END IF;
 UPDATE crm_stage_approvals SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,decided_by=auth_member_id(p_org),decided_at=now(),decision_note=coalesce(p_note,'') WHERE id=p_id AND organization_id=p_org AND status='pending';
 IF NOT FOUND THEN RAISE EXCEPTION 'Approval was already decided' USING ERRCODE='PT409'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.crm_decide_stage_approval(uuid,uuid,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_decide_stage_approval(uuid,uuid,boolean,text) TO authenticated;

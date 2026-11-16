CREATE INDEX IF NOT EXISTS idx_crm_deal_due ON crm_activities(organization_id,deal_id,due_at) WHERE completed_at IS NULL AND deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_deal_engagement ON crm_activities(organization_id,deal_id,created_at DESC) WHERE deal_id IS NOT NULL AND activity_type IN ('call','email','meeting','video','visit','demo');
CREATE INDEX IF NOT EXISTS idx_crm_stage_approval_pending ON crm_stage_approvals(organization_id,deal_id,deal_version,pipeline_version) WHERE status='pending';
DO $$ DECLARE name text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  FOREACH name IN ARRAY ARRAY['crm_pipelines','crm_pipeline_stages','crm_stage_approvals','crm_opportunity_plans','crm_pipeline_views'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=name) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',name);
   END IF;
  END LOOP;
 END IF;
END $$;

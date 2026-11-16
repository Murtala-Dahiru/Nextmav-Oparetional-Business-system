-- A stale client revision is an application conflict, not a transaction
-- serialization failure. PT409 prevents database gateways retrying a request
-- whose supplied revision can never become current.
DO $$
DECLARE routine regprocedure; definition text;
BEGIN
 FOR routine IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('crm_move_deal','crm_save_pipeline','crm_save_deal_execution','crm_pipeline_lifecycle','crm_save_opportunity_plan') LOOP
  SELECT pg_get_functiondef(routine) INTO definition;
  EXECUTE replace(definition,'''40001''','''PT409''');
 END LOOP;
END $$;

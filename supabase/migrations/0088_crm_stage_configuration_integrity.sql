DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('public.crm_save_pipeline(uuid,uuid,integer,text,text,jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,'IF p_id IS NULL THEN',
 'IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_stages) s WHERE s->>''canonicalStage'' NOT IN (''closed_won'',''closed_lost'')) THEN RAISE EXCEPTION ''A pipeline needs at least one open stage'' USING ERRCODE=''22023''; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_stages) s WHERE (s->>''canonicalStage''=''closed_won'' AND (s->>''probability'')::integer<>100) OR (s->>''canonicalStage''=''closed_lost'' AND (s->>''probability'')::integer<>0)) THEN RAISE EXCEPTION ''Won stages require 100 percent probability; lost stages require zero'' USING ERRCODE=''22023''; END IF;
  IF p_id IS NULL THEN');
 EXECUTE definition;
END $$;

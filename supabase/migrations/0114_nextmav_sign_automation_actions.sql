DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('crm_automation_validate(jsonb)'::regprocedure) INTO definition;
 IF position('Agreement triggers support notification' in definition)=0 THEN
 definition:=replace(definition,'FOR s IN SELECT * FROM jsonb_array_elements(w->''steps'') LOOP',
 'FOR s IN SELECT * FROM jsonb_array_elements(w->''steps'') LOOP
 IF entity=''agreement'' AND s->>''type'' NOT IN (''notify'',''wait'',''check'') THEN RAISE EXCEPTION ''Agreement triggers support notification, wait and condition actions'' USING ERRCODE=''22023'';END IF;');
 IF position('Agreement triggers support notification' in definition)=0 THEN RAISE EXCEPTION 'Automation validation anchor missing';END IF;
 EXECUTE definition;
 END IF;
END $$;

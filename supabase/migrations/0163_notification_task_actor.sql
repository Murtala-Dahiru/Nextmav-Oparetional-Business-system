-- The actor captured in the business transaction assigned the task. Its original reporter may be a different person.
CREATE OR REPLACE FUNCTION public.notification_describe() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source record; label text;
BEGIN
 IF NEW.entity_type='message' THEN
   SELECT m.body,m.sender_id,m.parent_id,c.name,p.full_name INTO source
   FROM messages m JOIN channels c ON c.id=m.channel_id AND c.organization_id=m.organization_id
   JOIN organization_members om ON om.id=m.sender_id AND om.organization_id=m.organization_id
   JOIN profiles p ON p.id=om.user_id WHERE m.id=NEW.entity_id AND m.organization_id=NEW.organization_id;
   IF FOUND THEN
     NEW.actor_id:=source.sender_id;
     NEW.title:=coalesce(nullif(source.full_name,''),'A teammate') || CASE WHEN NEW.type='message_mention' THEN ' mentioned you' WHEN source.parent_id IS NOT NULL THEN ' replied' ELSE ' sent you a message' END;
     NEW.body:=left(regexp_replace(regexp_replace(coalesce(source.body,''),'<[^>]*>',' ','g'),'[[:space:]]+',' ','g'),160);
     IF NEW.body='' THEN NEW.body:='Open the conversation to view this message.'; END IF;
     NEW.body:=NEW.body || ' · ' || left(source.name,60);
   END IF;
 ELSIF NEW.entity_type='task' THEN
   SELECT t.title,t.due_date,p.full_name INTO source FROM tasks t
   LEFT JOIN organization_members m ON m.id=NEW.actor_id AND m.organization_id=t.organization_id
   LEFT JOIN profiles p ON p.id=m.user_id WHERE t.id=NEW.entity_id AND t.organization_id=NEW.organization_id;
   IF FOUND THEN
     NEW.body:=left(source.title,140);
     IF NEW.type='task_assigned' THEN
       NEW.title:='New task: '||left(source.title,90);
       IF source.full_name IS NOT NULL THEN NEW.body:=NEW.body||' · Assigned by '||left(source.full_name,50); END IF;
     END IF;
     IF source.due_date IS NOT NULL THEN NEW.body:=NEW.body||' · Due '||source.due_date::text; END IF;
   END IF;
 ELSIF NEW.entity_type='lead' THEN
   SELECT trim(concat_ws(' ',first_name,last_name)) INTO label FROM leads WHERE id=NEW.entity_id AND organization_id=NEW.organization_id;
   IF nullif(label,'') IS NOT NULL THEN NEW.body:='Lead: '||left(label,200); END IF;
 ELSIF NEW.entity_type='ticket' THEN
   SELECT subject INTO label FROM support_tickets WHERE id=NEW.entity_id AND organization_id=NEW.organization_id;
   IF label IS NOT NULL THEN NEW.body:=left(label,240); END IF;
 ELSIF NEW.entity_type='commercial' THEN
   SELECT title INTO label FROM crm_commercial_records WHERE id=NEW.entity_id AND organization_id=NEW.organization_id;
   IF label IS NOT NULL THEN NEW.body:=left(label,240)||' · '||replace(NEW.type,'commercial_',''); END IF;
 ELSIF NEW.entity_type='agreement' THEN
   SELECT title INTO label FROM sign_envelopes WHERE id=NEW.entity_id AND organization_id=NEW.organization_id;
   IF label IS NOT NULL THEN NEW.body:=left(label,240); END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.notification_describe() FROM PUBLIC,anon,authenticated;

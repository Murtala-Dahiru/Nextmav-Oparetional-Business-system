-- Only format supplied presentation fields. No identifiers or contact addresses as name fallbacks.
CREATE OR REPLACE FUNCTION public.notification_message_copy(sender text, message text, channel_type text,
  channel_label text, event_type text, reply boolean) RETURNS TABLE(title text, body text)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 WITH names AS (
   SELECT nullif(btrim(regexp_replace(sender,'[[:cntrl:]]+',' ','g')),'') AS person,
          nullif(btrim(channel_label),'') AS room,
          nullif(btrim(regexp_replace(regexp_replace(message,'<[^>]*>',' ','g'),'[[:space:]]+',' ','g')),'') AS preview
 ), labels AS (
   SELECT CASE WHEN person !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' AND person !~ '@'
               THEN left(person,72) END AS person,
          CASE WHEN channel_type <> 'direct' AND room !~* '(^dm-|[0-9a-f]{8}-[0-9a-f]{4}-)' THEN left(room,56) END AS room, preview
   FROM names
 )
 SELECT CASE WHEN person IS NULL THEN CASE WHEN event_type='message_mention' THEN 'You were mentioned'
                WHEN reply THEN 'New reply' WHEN channel_type='direct' THEN 'New direct message' ELSE 'New message' END
             ELSE person || CASE WHEN event_type='message_mention' THEN ' mentioned you' WHEN reply THEN ' replied' ELSE ' sent you a message' END END,
        concat_ws(' · ',coalesce(CASE WHEN length(preview)>160 THEN left(preview,159)||'…' ELSE preview END,'Open the conversation to view the message.'),room)
 FROM labels;
$$;
REVOKE ALL ON FUNCTION public.notification_message_copy(text,text,text,text,text,boolean) FROM PUBLIC, anon, authenticated;

-- The actor captured in the business transaction assigned the task. Its original reporter may be a different person.
CREATE OR REPLACE FUNCTION public.notification_describe() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source record; label text;
BEGIN
 IF NEW.entity_type='message' THEN
   SELECT m.sender_id, presentation.title, presentation.body INTO source
   FROM messages m JOIN channels c ON c.id=m.channel_id AND c.organization_id=m.organization_id
   JOIN organization_members om ON om.id=m.sender_id AND om.organization_id=m.organization_id
   JOIN profiles p ON p.id=om.user_id
   CROSS JOIN LATERAL public.notification_message_copy(p.full_name,m.body,c.type::text,
     coalesce(nullif(btrim(c.display_name),''),c.name),NEW.type,m.parent_id IS NOT NULL) presentation
   WHERE m.id=NEW.entity_id AND m.organization_id=NEW.organization_id;
   IF FOUND THEN
     NEW.actor_id:=source.sender_id;
     NEW.title:=source.title;
     NEW.body:=source.body;
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

-- Repair existing visible message records without creating notification or delivery rows.
UPDATE notifications n SET title=copy.title, body=copy.body, actor_id=m.sender_id
FROM messages m JOIN channels c ON c.id=m.channel_id AND c.organization_id=m.organization_id
JOIN organization_members sender ON sender.id=m.sender_id AND sender.organization_id=m.organization_id
JOIN profiles p ON p.id=sender.user_id
JOIN channel_members cm ON cm.channel_id=c.id
JOIN organization_members recipient ON recipient.id=cm.member_id AND recipient.organization_id=m.organization_id
CROSS JOIN LATERAL public.notification_message_copy(p.full_name,m.body,c.type::text,
  coalesce(nullif(btrim(c.display_name),''),c.name),
  CASE WHEN cm.member_id=ANY(m.mentions) THEN 'message_mention' ELSE 'message_received' END,m.parent_id IS NOT NULL) copy
WHERE n.entity_type='message' AND n.type IN ('message_received','message_mention')
AND n.entity_id=m.id AND n.organization_id=m.organization_id AND n.recipient_id=recipient.id
AND recipient.is_active AND recipient.deleted_at IS NULL AND m.deleted_at IS NULL AND NOT c.is_archived
AND (n.title,n.body,n.actor_id) IS DISTINCT FROM (copy.title,copy.body,m.sender_id);
-- Strip legacy DM suffixes even where the user no longer has access, without retrieving message content.
UPDATE notifications SET body=regexp_replace(body,' · dm-[0-9a-f-]+$','','i')
WHERE body ~* ' · dm-[0-9a-f-]+$' AND entity_type IN ('message','channel');

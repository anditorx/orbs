-- Broadcast every new event so API servers can push it to subscribed clients.
-- Payload stays small (Postgres NOTIFY limit is 8000 bytes); listeners fetch the row by seq.
CREATE OR REPLACE FUNCTION orbs_notify_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'orbs_event',
    json_build_object(
      'seq', NEW.seq,
      'orgId', NEW.org_id,
      'streamType', NEW.stream_type,
      'streamId', NEW.stream_id,
      'type', NEW.type
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER event_notify_after_insert
AFTER INSERT ON "event"
FOR EACH ROW EXECUTE FUNCTION orbs_notify_event();

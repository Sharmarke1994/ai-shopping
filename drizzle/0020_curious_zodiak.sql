CREATE TABLE "shopping_private"."space_visual_designs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"room_revision" integer NOT NULL,
	"action_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"basis" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"storage_key" text,
	"byte_size" integer,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_visual_action" UNIQUE("space_id","action_id"),
	CONSTRAINT "space_visual_basis_shape" CHECK (jsonb_typeof("shopping_private"."space_visual_designs"."basis") = 'object' and ("shopping_private"."space_visual_designs"."basis"->>'version') is not null and "shopping_private"."space_visual_designs"."basis"->>'version' = '1' and octet_length("shopping_private"."space_visual_designs"."basis"::text) <= 196608),
	CONSTRAINT "space_visual_request_hash" CHECK ("shopping_private"."space_visual_designs"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "space_visual_state" CHECK (
    ("shopping_private"."space_visual_designs"."status" = 'draft' and "shopping_private"."space_visual_designs"."started_at" is null and "shopping_private"."space_visual_designs"."finished_at" is null and "shopping_private"."space_visual_designs"."storage_key" is null and "shopping_private"."space_visual_designs"."byte_size" is null and "shopping_private"."space_visual_designs"."failure" is null) or
    ("shopping_private"."space_visual_designs"."status" = 'running' and "shopping_private"."space_visual_designs"."started_at" is not null and "shopping_private"."space_visual_designs"."finished_at" is null and "shopping_private"."space_visual_designs"."storage_key" is null and "shopping_private"."space_visual_designs"."byte_size" is null and "shopping_private"."space_visual_designs"."failure" is null) or
    ("shopping_private"."space_visual_designs"."status" = 'failed' and "shopping_private"."space_visual_designs"."started_at" is not null and "shopping_private"."space_visual_designs"."finished_at" is not null and "shopping_private"."space_visual_designs"."storage_key" is null and "shopping_private"."space_visual_designs"."byte_size" is null and "shopping_private"."space_visual_designs"."failure" is not null and "shopping_private"."space_visual_designs"."failure" in ('provider_failed','reference_unavailable')) or
    ("shopping_private"."space_visual_designs"."status" = 'completed' and "shopping_private"."space_visual_designs"."started_at" is not null and "shopping_private"."space_visual_designs"."finished_at" is not null and "shopping_private"."space_visual_designs"."storage_key" is not null and "shopping_private"."space_visual_designs"."storage_key" ~ '^[a-f0-9]{64}$' and "shopping_private"."space_visual_designs"."byte_size" is not null and "shopping_private"."space_visual_designs"."byte_size" between 1 and 12582912 and "shopping_private"."space_visual_designs"."failure" is null)
  )
);
--> statement-breakpoint
ALTER TABLE "shopping_private"."space_visual_designs" ADD CONSTRAINT "space_visual_basis_fk" FOREIGN KEY ("space_id","room_revision") REFERENCES "shopping_private"."space_revisions"("space_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION shopping_private.guard_space_visual_design() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Saved room designs cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'New designs must be drafts'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.space_id, NEW.room_revision, NEW.action_id, NEW.request_hash, NEW.basis, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.space_id, OLD.room_revision, OLD.action_id, OLD.request_hash, OLD.basis, OLD.created_at) THEN
    RAISE EXCEPTION 'Saved design basis is immutable';
  END IF;
  IF NOT ((OLD.status = 'draft' AND NEW.status = 'running') OR
    (OLD.status = 'running' AND NEW.status IN ('completed', 'failed') AND NEW.started_at = OLD.started_at)) THEN
    RAISE EXCEPTION 'Invalid design generation transition';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER space_visual_design_guard BEFORE INSERT OR UPDATE OR DELETE ON shopping_private.space_visual_designs
FOR EACH ROW EXECUTE FUNCTION shopping_private.guard_space_visual_design();

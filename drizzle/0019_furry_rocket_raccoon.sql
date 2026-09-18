CREATE TABLE "shopping_private"."space_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"filename" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_assets_identity" UNIQUE("space_id","id"),
	CONSTRAINT "space_assets_digest" UNIQUE("space_id","sha256"),
	CONSTRAINT "space_assets_key" CHECK ("shopping_private"."space_assets"."storage_key" = "shopping_private"."space_assets"."sha256" and "shopping_private"."space_assets"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "space_assets_type" CHECK ("shopping_private"."space_assets"."content_type" in ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "space_assets_size" CHECK ("shopping_private"."space_assets"."byte_size" between 1 and 12582912),
	CONSTRAINT "space_assets_filename" CHECK (length("shopping_private"."space_assets"."filename") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."space_revision_assets" (
	"space_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "space_revision_assets_space_id_revision_asset_id_pk" PRIMARY KEY("space_id","revision","asset_id")
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."space_revisions" (
	"space_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_revisions_space_id_revision_pk" PRIMARY KEY("space_id","revision"),
	CONSTRAINT "space_revisions_nonnegative" CHECK ("shopping_private"."space_revisions"."revision" >= 0),
	CONSTRAINT "space_revisions_snapshot" CHECK (jsonb_typeof("shopping_private"."space_revisions"."snapshot") = 'object' and ("shopping_private"."space_revisions"."snapshot"->>'version') is not null and ("shopping_private"."space_revisions"."snapshot"->>'version') = '1' and octet_length("shopping_private"."space_revisions"."snapshot"::text) <= 131072)
);
--> statement-breakpoint
CREATE TABLE "shopping_private"."spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"room_type" text,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spaces_name_bounded" CHECK (length(trim("shopping_private"."spaces"."name")) between 1 and 100),
	CONSTRAINT "spaces_revision_nonnegative" CHECK ("shopping_private"."spaces"."current_revision" >= 0),
	CONSTRAINT "spaces_room_type" CHECK ("shopping_private"."spaces"."room_type" is null or "shopping_private"."spaces"."room_type" in ('bedroom','living_room','office','kitchen','dining_room','other'))
);
--> statement-breakpoint
ALTER TABLE "shopping_private"."space_assets" ADD CONSTRAINT "space_assets_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "shopping_private"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."space_revision_assets" ADD CONSTRAINT "space_revision_assets_revision_fk" FOREIGN KEY ("space_id","revision") REFERENCES "shopping_private"."space_revisions"("space_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."space_revision_assets" ADD CONSTRAINT "space_revision_assets_owner_fk" FOREIGN KEY ("space_id","asset_id") REFERENCES "shopping_private"."space_assets"("space_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."space_revisions" ADD CONSTRAINT "space_revisions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "shopping_private"."spaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- The circular pointer must exist by transaction commit, including revision zero.
ALTER TABLE shopping_private.spaces ADD CONSTRAINT spaces_current_revision_fk
FOREIGN KEY (id,current_revision) REFERENCES shopping_private.space_revisions(space_id,revision)
DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION shopping_private.protect_space_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Space history and photo metadata are immutable';
END $$;
--> statement-breakpoint
CREATE TRIGGER space_revisions_immutable BEFORE UPDATE OR DELETE ON shopping_private.space_revisions FOR EACH ROW EXECUTE FUNCTION shopping_private.protect_space_history();
--> statement-breakpoint
CREATE TRIGGER space_assets_immutable BEFORE UPDATE OR DELETE ON shopping_private.space_assets FOR EACH ROW EXECUTE FUNCTION shopping_private.protect_space_history();
--> statement-breakpoint
CREATE TRIGGER space_revision_assets_immutable BEFORE UPDATE OR DELETE ON shopping_private.space_revision_assets FOR EACH ROW EXECUTE FUNCTION shopping_private.protect_space_history();
--> statement-breakpoint
CREATE FUNCTION shopping_private.guard_space_revision_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_rev integer;
BEGIN
  SELECT current_revision INTO current_rev FROM shopping_private.spaces WHERE id = NEW.space_id FOR UPDATE;
  IF current_rev IS NULL OR NEW.revision <> current_rev + 1 THEN
    RAISE EXCEPTION 'Cannot append photo membership to a current or historical revision';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER space_revision_membership_insert BEFORE INSERT ON shopping_private.space_revision_assets FOR EACH ROW EXECUTE FUNCTION shopping_private.guard_space_revision_membership();
--> statement-breakpoint
CREATE FUNCTION shopping_private.guard_space_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.current_revision <> OLD.current_revision + 1 THEN
    RAISE EXCEPTION 'Space revision must advance exactly once';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER spaces_monotonic_head BEFORE UPDATE ON shopping_private.spaces FOR EACH ROW EXECUTE FUNCTION shopping_private.guard_space_head();

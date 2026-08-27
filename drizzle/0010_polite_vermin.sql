CREATE TABLE "shopping_private"."saved_candidate_listings" (
	"task_id" uuid NOT NULL,
	"candidate_listing_id" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_candidate_listings_pk" PRIMARY KEY("task_id","candidate_listing_id")
);
--> statement-breakpoint
ALTER TABLE "shopping_private"."candidate_listings" DROP CONSTRAINT "candidate_listings_url_shape";--> statement-breakpoint
ALTER TABLE "shopping_private"."candidate_listings" ADD COLUMN "merchant_destination_url" text;--> statement-breakpoint
ALTER TABLE "shopping_private"."saved_candidate_listings" ADD CONSTRAINT "saved_candidate_listings_candidate_fk" FOREIGN KEY ("task_id","candidate_listing_id") REFERENCES "shopping_private"."candidate_listings"("task_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_private"."candidate_listings" ADD CONSTRAINT "candidate_listings_url_shape" CHECK (char_length("shopping_private"."candidate_listings"."url") between 1 and 4000 and "shopping_private"."candidate_listings"."url" ~ '^https?://' and char_length("shopping_private"."candidate_listings"."canonical_url") between 1 and 4000 and "shopping_private"."candidate_listings"."canonical_url" ~ '^https?://' and ("shopping_private"."candidate_listings"."merchant_destination_url" is null or (char_length("shopping_private"."candidate_listings"."merchant_destination_url") between 1 and 4000 and "shopping_private"."candidate_listings"."merchant_destination_url" ~ '^https?://')));
--> statement-breakpoint
REVOKE ALL ON TABLE "shopping_private"."saved_candidate_listings" FROM PUBLIC;
--> statement-breakpoint
DO $guard$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE shopping_private.saved_candidate_listings FROM %I',
        client_role
      );
    END IF;
  END LOOP;
END
$guard$;

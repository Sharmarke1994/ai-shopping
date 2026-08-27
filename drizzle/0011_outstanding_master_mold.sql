ALTER TABLE "shopping_private"."candidate_listings" ADD COLUMN "merchant_destination_source" text;--> statement-breakpoint
UPDATE "shopping_private"."candidate_listings"
SET "merchant_destination_source" = 'shopping_result'
WHERE "merchant_destination_url" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "shopping_private"."candidate_listings" ADD CONSTRAINT "candidate_listings_destination_provenance_shape" CHECK (("shopping_private"."candidate_listings"."merchant_destination_url" is null and "shopping_private"."candidate_listings"."merchant_destination_source" is null) or ("shopping_private"."candidate_listings"."merchant_destination_url" is not null and "shopping_private"."candidate_listings"."merchant_destination_source" in ('shopping_result', 'verified_organic')));

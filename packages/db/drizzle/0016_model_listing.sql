ALTER TABLE "ai_model" ADD COLUMN "listed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "org_model" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;
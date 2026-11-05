CREATE TABLE "ai_model" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"input_usd_per_mtok" numeric(12, 6),
	"output_usd_per_mtok" numeric(12, 6),
	"quality_score" real,
	"max_data_class" text DEFAULT 'internal' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_model" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"model_ref_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_model" ADD CONSTRAINT "org_model_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_model" ADD CONSTRAINT "org_model_model_ref_id_ai_model_id_fk" FOREIGN KEY ("model_ref_id") REFERENCES "public"."ai_model"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_provider_model_uq" ON "ai_model" USING btree ("provider","model_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_model_uq" ON "org_model" USING btree ("org_id","model_ref_id");--> statement-breakpoint
-- Carry over anything already in the old per-organization catalog (it was empty in dev).
INSERT INTO "ai_model" ("id", "provider", "model_id", "display_name", "input_usd_per_mtok", "output_usd_per_mtok", "quality_score", "max_data_class", "active")
SELECT gen_random_uuid()::text, "provider", "model_id", min("display_name"), max("input_usd_per_mtok"), max("output_usd_per_mtok"), max("quality_score"), max("max_data_class"), true
FROM "model_catalog" GROUP BY "provider", "model_id";--> statement-breakpoint
INSERT INTO "org_model" ("id", "org_id", "model_ref_id", "enabled")
SELECT gen_random_uuid()::text, mc."org_id", am."id", mc."enabled"
FROM "model_catalog" mc JOIN "ai_model" am ON am."provider" = mc."provider" AND am."model_id" = mc."model_id";

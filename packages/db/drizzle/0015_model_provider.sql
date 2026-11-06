CREATE TABLE "model_provider" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"api_key_enc" text NOT NULL,
	"key_hint" text NOT NULL,
	"project_name" text,
	"project_number" text,
	"status" text DEFAULT 'failed' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_provider" ADD CONSTRAINT "model_provider_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_provider_provider_uq" ON "model_provider" USING btree ("provider");
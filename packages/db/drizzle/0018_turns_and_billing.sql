CREATE TABLE "turn" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"engine" jsonb NOT NULL,
	"provider" text,
	"model_id" text,
	"error_code" text,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "model_provider" ADD COLUMN "billing_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "turn" ADD CONSTRAINT "turn_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn" ADD CONSTRAINT "turn_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "turn_thread_created_idx" ON "turn" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "turn_status_idx" ON "turn" USING btree ("status","created_at");
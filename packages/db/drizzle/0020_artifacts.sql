CREATE TABLE "artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_version" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"version" integer NOT NULL,
	"html" text NOT NULL,
	"turn_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_thread_id_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_version" ADD CONSTRAINT "artifact_version_artifact_id_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_thread_idx" ON "artifact" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_version_uq" ON "artifact_version" USING btree ("artifact_id","version");
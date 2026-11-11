CREATE TABLE "customization_project" (
	"customization_id" text NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customization" ADD COLUMN "applies_to" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "customization_project" ADD CONSTRAINT "customization_project_customization_id_customization_id_fk" FOREIGN KEY ("customization_id") REFERENCES "public"."customization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customization_project" ADD CONSTRAINT "customization_project_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customization_project_uq" ON "customization_project" USING btree ("customization_id","project_id");--> statement-breakpoint
CREATE INDEX "customization_project_project_idx" ON "customization_project" USING btree ("project_id");
--> statement-breakpoint
-- Instructions used to be limited to one project through customization.project_id; carry that over.
INSERT INTO "customization_project" ("customization_id", "project_id") SELECT "id", "project_id" FROM "customization" WHERE "project_id" IS NOT NULL;--> statement-breakpoint
UPDATE "customization" SET "applies_to" = 'projects' WHERE "project_id" IS NOT NULL;

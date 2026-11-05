ALTER TABLE "member" ALTER COLUMN "role" SET DEFAULT 'org.member';--> statement-breakpoint
-- Rename existing roles: system "admin" -> "system.admin"; company owner/admin -> "org.admin"; member -> "org.member".
UPDATE "user" SET "role" = 'system.admin' WHERE "role" = 'admin';--> statement-breakpoint
UPDATE "member" SET "role" = 'org.admin' WHERE "role" IN ('owner', 'admin');--> statement-breakpoint
UPDATE "member" SET "role" = 'org.member' WHERE "role" = 'member';--> statement-breakpoint
UPDATE "invitation" SET "role" = 'org.admin' WHERE "role" IN ('owner', 'admin');--> statement-breakpoint
UPDATE "invitation" SET "role" = 'org.member' WHERE "role" = 'member' OR "role" IS NULL;

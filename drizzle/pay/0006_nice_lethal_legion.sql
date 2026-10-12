CREATE TABLE "pay_freemium_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pay_freemium_projects_user_idx" ON "pay_freemium_projects" USING btree ("clerk_user_id");
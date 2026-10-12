CREATE TABLE "pay_contributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"order_id" uuid,
	"subscription_id" text,
	"description" text NOT NULL,
	"amount" integer NOT NULL,
	"amount_refunded" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"message" text,
	"paid_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pay_contributions_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "pay_member_role_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"from_role" text,
	"to_role" text,
	"subscription_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_members" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"wall_name" text,
	"community_role" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pay_contributions" ADD CONSTRAINT "pay_contributions_order_id_pay_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pay_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_contributions_user_idx" ON "pay_contributions" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "pay_member_role_changes_user_idx" ON "pay_member_role_changes" USING btree ("clerk_user_id");
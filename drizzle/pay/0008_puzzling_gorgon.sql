CREATE TABLE "pay_usage_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"meter" text NOT NULL,
	"threshold" integer NOT NULL,
	"status" text NOT NULL,
	"triggered_at" timestamp with time zone,
	"triggered_value" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"meter" text NOT NULL,
	"value" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"test_clock_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "pay_usage_alerts_user_idx" ON "pay_usage_alerts" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "pay_usage_events_customer_idx" ON "pay_usage_events" USING btree ("stripe_customer_id","occurred_at");
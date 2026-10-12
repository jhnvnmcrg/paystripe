CREATE TABLE "pay_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"status" text NOT NULL,
	"price_lookup_key" text,
	"items" jsonb NOT NULL,
	"currency" text NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancel_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"test_clock_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_test_clock_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"module" text NOT NULL,
	"test_clock_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_test_clock_runs_test_clock_id_unique" UNIQUE("test_clock_id"),
	CONSTRAINT "pay_test_clock_runs_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE INDEX "pay_subscriptions_user_module_idx" ON "pay_subscriptions" USING btree ("clerk_user_id","module");--> statement-breakpoint
CREATE INDEX "pay_test_clock_runs_user_module_idx" ON "pay_test_clock_runs" USING btree ("clerk_user_id","module");
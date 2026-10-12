CREATE TABLE "pay_credit_accounts" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"auto_recharge" boolean DEFAULT false NOT NULL,
	"recharge_threshold" integer DEFAULT 100 NOT NULL,
	"recharge_pack" text DEFAULT 'starter' NOT NULL,
	"payment_method_id" text,
	"card_brand" text,
	"card_last4" text,
	"recharge_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_credit_accounts_balance_ok" CHECK ("pay_credit_accounts"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pay_credit_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"description" text NOT NULL,
	"source_id" text,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_credit_ledger_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "pay_credit_recharges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"trigger_key" text NOT NULL,
	"order_id" uuid NOT NULL,
	"pack" text NOT NULL,
	"credits" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_intent_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_credit_recharges_trigger_key_unique" UNIQUE("trigger_key"),
	CONSTRAINT "pay_credit_recharges_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "pay_credit_recharges_payment_intent_id_unique" UNIQUE("payment_intent_id")
);
--> statement-breakpoint
ALTER TABLE "pay_credit_ledger" ADD CONSTRAINT "pay_credit_ledger_order_id_pay_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pay_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_credit_recharges" ADD CONSTRAINT "pay_credit_recharges_order_id_pay_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pay_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_credit_ledger_user_idx" ON "pay_credit_ledger" USING btree ("clerk_user_id");
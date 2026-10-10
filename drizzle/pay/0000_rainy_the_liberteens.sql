CREATE TABLE "pay_checkout_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_customers" (
	"clerk_user_id" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "pay_order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"stripe_price_id" text,
	"lookup_key" text,
	"stripe_product_id" text,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_amount" integer,
	"amount_total" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"checkout_session_id" text,
	"payment_intent_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"currency" text,
	"amount_subtotal" integer,
	"amount_discount" integer DEFAULT 0 NOT NULL,
	"amount_shipping" integer DEFAULT 0 NOT NULL,
	"amount_total" integer,
	"amount_refunded" integer DEFAULT 0 NOT NULL,
	"application_fee_amount" integer,
	"shipping" jsonb,
	"fulfillment_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_orders_checkout_session_id_unique" UNIQUE("checkout_session_id"),
	CONSTRAINT "pay_orders_payment_intent_id_unique" UNIQUE("payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "pay_stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"livemode" boolean NOT NULL,
	"stripe_created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pay_order_items" ADD CONSTRAINT "pay_order_items_order_id_pay_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pay_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_orders_user_module_idx" ON "pay_orders" USING btree ("clerk_user_id","module");
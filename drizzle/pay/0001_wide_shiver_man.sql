CREATE TABLE "pay_license_activations" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_key_id" uuid NOT NULL,
	"machine_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_license_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"order_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"lookup_key" text NOT NULL,
	"product_name" text NOT NULL,
	"max_activations" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_license_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "pay_license_activations" ADD CONSTRAINT "pay_license_activations_license_key_id_pay_license_keys_id_fk" FOREIGN KEY ("license_key_id") REFERENCES "public"."pay_license_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_license_keys" ADD CONSTRAINT "pay_license_keys_order_id_pay_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pay_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pay_license_activations_key_machine_idx" ON "pay_license_activations" USING btree ("license_key_id","machine_id");--> statement-breakpoint
CREATE INDEX "pay_license_keys_user_idx" ON "pay_license_keys" USING btree ("clerk_user_id");
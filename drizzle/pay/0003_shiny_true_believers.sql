CREATE TABLE "pay_reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_shipments" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"carrier" text NOT NULL,
	"tracking_number" text NOT NULL,
	"shipped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_skus" (
	"sku" text PRIMARY KEY NOT NULL,
	"on_hand" integer NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_skus_stock_ok" CHECK ("pay_skus"."reserved" >= 0 AND "pay_skus"."reserved" <= "pay_skus"."on_hand")
);
--> statement-breakpoint
ALTER TABLE "pay_reservations" ADD CONSTRAINT "pay_reservations_order_id_pay_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pay_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_reservations" ADD CONSTRAINT "pay_reservations_sku_pay_skus_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."pay_skus"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_shipments" ADD CONSTRAINT "pay_shipments_order_id_pay_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pay_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pay_reservations_order_sku_idx" ON "pay_reservations" USING btree ("order_id","sku");
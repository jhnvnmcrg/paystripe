CREATE TABLE "pay_download_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"product_name" text NOT NULL,
	"file_name" text NOT NULL,
	"max_downloads" integer NOT NULL,
	"downloads_used" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"last_downloaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pay_download_grants" ADD CONSTRAINT "pay_download_grants_order_id_pay_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."pay_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_download_grants_user_idx" ON "pay_download_grants" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pay_download_grants_order_asset_idx" ON "pay_download_grants" USING btree ("order_id","asset_id");
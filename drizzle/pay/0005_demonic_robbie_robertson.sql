CREATE TABLE "pay_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "pay_api_keys_clerk_user_id_unique" UNIQUE("clerk_user_id"),
	CONSTRAINT "pay_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "pay_entitlements" (
	"clerk_user_id" text NOT NULL,
	"feature_lookup_key" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_entitlements_clerk_user_id_feature_lookup_key_pk" PRIMARY KEY("clerk_user_id","feature_lookup_key")
);

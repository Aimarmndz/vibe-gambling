CREATE TABLE "cosmetics_owned" (
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cosmetics_owned_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"user_id" uuid NOT NULL,
	"season_id" text NOT NULL,
	"item_id" text NOT NULL,
	"charges" integer NOT NULL,
	"armed" boolean DEFAULT false NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "inventory_user_id_season_id_item_id_pk" PRIMARY KEY("user_id","season_id","item_id"),
	CONSTRAINT "inventory_charges_check" CHECK ("inventory"."charges" >= 0)
);
--> statement-breakpoint
CREATE TABLE "item_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"season_id" text NOT NULL,
	"item_id" text NOT NULL,
	"price" bigint NOT NULL,
	"paid_with" text DEFAULT 'balance' NOT NULL,
	"refund" bigint DEFAULT 0 NOT NULL,
	"round_id" uuid,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "item_purchases_price_check" CHECK ("item_purchases"."price" > 0),
	CONSTRAINT "item_purchases_refund_check" CHECK ("item_purchases"."refund" >= 0),
	CONSTRAINT "item_purchases_paid_with_check" CHECK ("item_purchases"."paid_with" in ('balance', 'debt'))
);
--> statement-breakpoint
CREATE TABLE "round_item_effects" (
	"round_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"detail" jsonb,
	CONSTRAINT "round_item_effects_round_id_item_id_pk" PRIMARY KEY("round_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "item_net" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "felt" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "chip_skin" text;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "streak_asterisk" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cosmetics_owned" ADD CONSTRAINT "cosmetics_owned_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_purchases" ADD CONSTRAINT "item_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_purchases" ADD CONSTRAINT "item_purchases_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_purchases" ADD CONSTRAINT "item_purchases_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round_item_effects" ADD CONSTRAINT "round_item_effects_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_purchases_request_key" ON "item_purchases" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "item_purchases_user_season_item_idx" ON "item_purchases" USING btree ("user_id","season_id","item_id");--> statement-breakpoint
CREATE INDEX "item_purchases_user_created_idx" ON "item_purchases" USING btree ("user_id","created_at");
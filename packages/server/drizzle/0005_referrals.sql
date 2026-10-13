CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid,
	"invitee_id" uuid,
	"redeemed_at" timestamp with time zone NOT NULL,
	"season_id" text NOT NULL,
	"welcome_bonus" bigint NOT NULL,
	"activated_at" timestamp with time zone,
	"commission" bigint,
	"paid_season_id" text,
	CONSTRAINT "referrals_not_self_check" CHECK ("referrals"."referrer_id" <> "referrals"."invitee_id"),
	CONSTRAINT "referrals_welcome_bonus_check" CHECK ("referrals"."welcome_bonus" >= 0),
	CONSTRAINT "referrals_activation_check" CHECK (("referrals"."activated_at" is null) = ("referrals"."commission" is null) and ("referrals"."activated_at" is null) = ("referrals"."paid_season_id" is null)),
	CONSTRAINT "referrals_commission_check" CHECK ("referrals"."commission" is null or "referrals"."commission" >= 0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_invitee_id_users_id_fk" FOREIGN KEY ("invitee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_paid_season_id_seasons_id_fk" FOREIGN KEY ("paid_season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_invitee_key" ON "referrals" USING btree ("invitee_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_season_idx" ON "referrals" USING btree ("referrer_id","paid_season_id");--> statement-breakpoint
CREATE INDEX "referrals_pending_idx" ON "referrals" USING btree ("invitee_id") WHERE "referrals"."activated_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_key" ON "users" USING btree ("referral_code");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_check" CHECK ("users"."referral_code" is null or "users"."referral_code" ~ '^[2-9A-HJKMNP-TV-Z]{8}$');
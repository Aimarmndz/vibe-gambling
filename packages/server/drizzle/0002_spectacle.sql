CREATE TABLE "achievements" (
	"user_id" uuid NOT NULL,
	"achievement_id" text NOT NULL,
	"season_id" text NOT NULL,
	"unlocked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "achievements_user_id_achievement_id_pk" PRIMARY KEY("user_id","achievement_id")
);
--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "after_spin" integer;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "spin_number" integer;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "streak_after" integer;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "net_worth_after" bigint;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "went_broke" boolean;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "broke_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rounds_user_season_resolved_idx" ON "rounds" USING btree ("user_id","season_id","resolved_at") WHERE "rounds"."status" = 'resolved';--> statement-breakpoint
CREATE INDEX "rounds_user_zero_idx" ON "rounds" USING btree ("user_id") WHERE "rounds"."status" = 'resolved' and "rounds"."result" = 0;
CREATE TABLE "bets" (
	"round_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"kind" text NOT NULL,
	"selection" jsonb NOT NULL,
	"amount" bigint NOT NULL,
	"won" boolean NOT NULL,
	"payout" bigint NOT NULL,
	CONSTRAINT "bets_round_id_position_pk" PRIMARY KEY("round_id","position"),
	CONSTRAINT "bets_amount_check" CHECK ("bets"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "device_auths" (
	"poll_id_hash" text PRIMARY KEY NOT NULL,
	"device_code" text NOT NULL,
	"interval_seconds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_polled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hall_of_ruin" (
	"season_id" text NOT NULL,
	"rank" smallint NOT NULL,
	"user_id" uuid NOT NULL,
	"net_worth" bigint NOT NULL,
	"spins" integer NOT NULL,
	CONSTRAINT "hall_of_ruin_season_id_rank_pk" PRIMARY KEY("season_id","rank")
);
--> statement-breakpoint
CREATE TABLE "link_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"season_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"interest_per_spin" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"season_id" text NOT NULL,
	"status" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"reveal_at" timestamp with time zone,
	"resolved_by_turn_id" text,
	"result" smallint,
	"source" text,
	"staked" bigint,
	"returned" bigint,
	"net" bigint,
	"jackpot" boolean,
	"git_push_ok" boolean,
	"test_failed" boolean,
	"duration_ms" integer,
	"interest_charged" bigint,
	"color_streak_color" text,
	"color_streak_count" integer,
	CONSTRAINT "rounds_status_check" CHECK ("rounds"."status" in ('open', 'resolved', 'expired')),
	CONSTRAINT "rounds_result_check" CHECK ("rounds"."result" is null or ("rounds"."result" between 0 and 36))
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" text PRIMARY KEY NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_kind_check" CHECK ("sessions"."kind" in ('mod', 'web'))
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"user_id" uuid NOT NULL,
	"turn_id" text NOT NULL,
	"round_id" uuid NOT NULL,
	"reused" boolean NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "turns_user_id_turn_id_pk" PRIMARY KEY("user_id","turn_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"login" text NOT NULL,
	"avatar_url" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"locale" text,
	"last_bets" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_locale_check" CHECK ("users"."locale" is null or "users"."locale" in ('en', 'es'))
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"user_id" uuid NOT NULL,
	"season_id" text NOT NULL,
	"balance" bigint NOT NULL,
	"debt" bigint DEFAULT 0 NOT NULL,
	"net_worth" bigint GENERATED ALWAYS AS (balance - debt) STORED NOT NULL,
	"spins" integer DEFAULT 0 NOT NULL,
	"loans" integer DEFAULT 0 NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"best_streak" integer DEFAULT 0 NOT NULL,
	"slip" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_user_id_season_id_pk" PRIMARY KEY("user_id","season_id"),
	CONSTRAINT "wallets_balance_check" CHECK ("wallets"."balance" >= 0),
	CONSTRAINT "wallets_debt_check" CHECK ("wallets"."debt" >= 0),
	CONSTRAINT "wallets_spins_check" CHECK ("wallets"."spins" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_of_ruin" ADD CONSTRAINT "hall_of_ruin_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hall_of_ruin" ADD CONSTRAINT "hall_of_ruin_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_codes" ADD CONSTRAINT "link_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_auths_expires_at_idx" ON "device_auths" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "hall_of_ruin_user_id_idx" ON "hall_of_ruin" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "link_codes_user_id_idx" ON "link_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "link_codes_expires_at_idx" ON "link_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "loans_user_season_idx" ON "loans" USING btree ("user_id","season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_one_open_per_user_key" ON "rounds" USING btree ("user_id") WHERE "rounds"."status" = 'open';--> statement-breakpoint
CREATE INDEX "rounds_user_resolved_idx" ON "rounds" USING btree ("user_id","resolved_at");--> statement-breakpoint
CREATE INDEX "rounds_season_status_idx" ON "rounds" USING btree ("season_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "turns_round_id_idx" ON "turns" USING btree ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_github_id_key" ON "users" USING btree ("github_id");--> statement-breakpoint
CREATE INDEX "wallets_season_net_worth_idx" ON "wallets" USING btree ("season_id","net_worth");--> statement-breakpoint
CREATE INDEX "wallets_season_spins_idx" ON "wallets" USING btree ("season_id","spins");
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_status_check";--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "deferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "spend_request_id" text;--> statement-breakpoint
CREATE INDEX "rounds_user_deferred_idx" ON "rounds" USING btree ("user_id","season_id","deferred_at") WHERE "rounds"."status" = 'deferred';--> statement-breakpoint
CREATE INDEX "rounds_user_reveal_idx" ON "rounds" USING btree ("user_id","reveal_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_spend_request_key" ON "rounds" USING btree ("user_id","spend_request_id") WHERE "rounds"."spend_request_id" is not null;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_deferred_check" CHECK ("rounds"."status" <> 'deferred' or ("rounds"."deferred_at" is not null and "rounds"."resolved_by_turn_id" is not null));--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_status_check" CHECK ("rounds"."status" in ('open', 'resolved', 'expired', 'deferred'));
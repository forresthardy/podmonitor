CREATE TYPE "public"."interest_match_decision" AS ENUM('auto_queued', 'review', 'confirmed', 'dismissed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."interest_match_signal" AS ENUM('cheap', 'transcript');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episode_interest_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"episode_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"interest_id" uuid,
	"score" real NOT NULL,
	"signal" "interest_match_signal" NOT NULL,
	"decision" "interest_match_decision" NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episode_interest_matches" ADD CONSTRAINT "episode_interest_matches_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episode_interest_matches" ADD CONSTRAINT "episode_interest_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "episode_interest_matches" ADD CONSTRAINT "episode_interest_matches_interest_id_interests_id_fk" FOREIGN KEY ("interest_id") REFERENCES "public"."interests"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "episode_interest_matches_episode_user_unique" ON "episode_interest_matches" USING btree ("episode_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "episode_interest_matches_user_decision_idx" ON "episode_interest_matches" USING btree ("user_id","decision");
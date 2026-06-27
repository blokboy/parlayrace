CREATE TYPE "public"."external_source_provider" AS ENUM('POLYMARKET', 'KALSHI', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('OPEN', 'CLOSED', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."parlay_status" AS ENUM('ACTIVE', 'LOST', 'WON');--> statement-breakpoint
CREATE TYPE "public"."provider_sync_job_type" AS ENUM('CATALOG', 'ODDS', 'STATUS', 'FULL');--> statement-breakpoint
CREATE TYPE "public"."provider_sync_run_status" AS ENUM('RUNNING', 'SUCCESS', 'PARTIAL_FAILURE', 'FAILURE');--> statement-breakpoint
CREATE TABLE "external_market" (
	"id" text PRIMARY KEY NOT NULL,
	"source_provider" "external_source_provider" NOT NULL,
	"source_market_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"status" "market_status" DEFAULT 'OPEN' NOT NULL,
	"close_time" timestamp,
	"resolve_time" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_market" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "external_outcome" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"label" text NOT NULL,
	"external_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_outcome" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "external_price_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"outcome_id" text NOT NULL,
	"source_provider" "external_source_provider" NOT NULL,
	"probability" numeric(12, 6) NOT NULL,
	"price" numeric(12, 6) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"fetched_at" timestamp NOT NULL,
	"payload_hash" text NOT NULL,
	"payload_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_price_snapshot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "paper_portfolio" (
	"user_id" text PRIMARY KEY NOT NULL,
	"cash_balance" real DEFAULT 1000 NOT NULL,
	"positions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_portfolio" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "parlay_team" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parlay_team" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "parlay_team_member" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parlay_team_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "parlay_team_parlay" (
	"id" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"started_by_user_id" text NOT NULL,
	"status" "parlay_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parlay_team_parlay" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "parlay_team_parlay_share" (
	"id" text PRIMARY KEY NOT NULL,
	"parlay_id" text NOT NULL,
	"team_id" text NOT NULL,
	"added_by_user_id" text NOT NULL,
	"position_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"placed_at" timestamp NOT NULL,
	"card_title" text NOT NULL,
	"market_id" text,
	"option_label" text NOT NULL,
	"side" text NOT NULL,
	"shares" real NOT NULL,
	"stake" real NOT NULL,
	"entry_price" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_share" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provider_dead_letter" (
	"id" text PRIMARY KEY NOT NULL,
	"source_provider" "external_source_provider" NOT NULL,
	"job_type" "provider_sync_job_type" NOT NULL,
	"sync_run_id" text,
	"external_ref" text,
	"reason" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"payload_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_dead_letter" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provider_sync_run" (
	"id" text PRIMARY KEY NOT NULL,
	"source_provider" "external_source_provider" NOT NULL,
	"job_type" "provider_sync_job_type" NOT NULL,
	"status" "provider_sync_run_status" DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp,
	"duration_ms" integer,
	"attempted_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"lag_seconds" integer,
	"stale_market_count" integer,
	"error_rate" numeric(7, 4),
	"metadata" jsonb,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "provider_sync_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "user_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "external_outcome" ADD CONSTRAINT "external_outcome_market_id_external_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."external_market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_price_snapshot" ADD CONSTRAINT "external_price_snapshot_market_id_external_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."external_market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_price_snapshot" ADD CONSTRAINT "external_price_snapshot_outcome_id_external_outcome_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."external_outcome"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_portfolio" ADD CONSTRAINT "paper_portfolio_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team" ADD CONSTRAINT "parlay_team_created_by_user_id_user_profile_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team_member" ADD CONSTRAINT "parlay_team_member_team_id_parlay_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."parlay_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team_member" ADD CONSTRAINT "parlay_team_member_user_id_user_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team_parlay" ADD CONSTRAINT "parlay_team_parlay_team_id_parlay_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."parlay_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team_parlay" ADD CONSTRAINT "parlay_team_parlay_started_by_user_id_user_profile_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."user_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_share" ADD CONSTRAINT "parlay_team_parlay_share_parlay_id_parlay_team_parlay_id_fk" FOREIGN KEY ("parlay_id") REFERENCES "public"."parlay_team_parlay"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_share" ADD CONSTRAINT "parlay_team_parlay_share_team_id_parlay_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."parlay_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_share" ADD CONSTRAINT "parlay_team_parlay_share_added_by_user_id_user_profile_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."user_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_dead_letter" ADD CONSTRAINT "provider_dead_letter_sync_run_id_provider_sync_run_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."provider_sync_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_id_user_id_fk" FOREIGN KEY ("id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_market_source_market_unique" ON "external_market" USING btree ("source_provider","source_market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "parlay_team_member_team_user_unique" ON "parlay_team_member" USING btree ("team_id","user_id");
ALTER TABLE "parlay_team_parlay"
ADD COLUMN "claimable_amount" real DEFAULT 0 NOT NULL,
ADD COLUMN "settled_amount" real DEFAULT 0 NOT NULL,
ADD COLUMN "settled_at" timestamp,
ADD COLUMN "transferred_to_user_id" text,
ADD COLUMN "loss_sequence" integer;
--> statement-breakpoint
ALTER TABLE "parlay_team_parlay" ADD CONSTRAINT "parlay_team_parlay_transferred_to_user_id_user_profile_id_fk" FOREIGN KEY ("transferred_to_user_id") REFERENCES "public"."user_profile"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "parlay_team_parlay_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"parlay_id" text NOT NULL,
	"team_id" text NOT NULL,
	"user_id" text NOT NULL,
	"amount" real NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_claim" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_claim" ADD CONSTRAINT "parlay_team_parlay_claim_parlay_id_parlay_team_parlay_id_fk" FOREIGN KEY ("parlay_id") REFERENCES "public"."parlay_team_parlay"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_claim" ADD CONSTRAINT "parlay_team_parlay_claim_team_id_parlay_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."parlay_team"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_claim" ADD CONSTRAINT "parlay_team_parlay_claim_user_id_user_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profile"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "parlay_team_parlay_claim_parlay_user_unique" ON "parlay_team_parlay_claim" USING btree ("parlay_id","user_id");
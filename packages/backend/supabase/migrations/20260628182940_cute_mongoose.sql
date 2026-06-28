CREATE TABLE "parlay_team_parlay_rollover" (
	"id" text PRIMARY KEY NOT NULL,
	"parlay_id" text NOT NULL,
	"team_id" text NOT NULL,
	"source_share_id" text NOT NULL,
	"target_share_id" text NOT NULL,
	"amount" real NOT NULL,
	"target_price" real NOT NULL,
	"shares_added" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_rollover" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_share" ADD COLUMN "result" text;--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_share" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_share" ADD COLUMN "resolved_price" real;--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_rollover" ADD CONSTRAINT "parlay_team_parlay_rollover_parlay_id_parlay_team_parlay_id_fk" FOREIGN KEY ("parlay_id") REFERENCES "public"."parlay_team_parlay"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_rollover" ADD CONSTRAINT "parlay_team_parlay_rollover_team_id_parlay_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."parlay_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_rollover" ADD CONSTRAINT "parlay_team_parlay_rollover_source_share_id_parlay_team_parlay_share_id_fk" FOREIGN KEY ("source_share_id") REFERENCES "public"."parlay_team_parlay_share"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team_parlay_rollover" ADD CONSTRAINT "parlay_team_parlay_rollover_target_share_id_parlay_team_parlay_share_id_fk" FOREIGN KEY ("target_share_id") REFERENCES "public"."parlay_team_parlay_share"("id") ON DELETE cascade ON UPDATE no action;

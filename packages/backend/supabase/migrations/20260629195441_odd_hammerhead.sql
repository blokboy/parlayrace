CREATE TABLE "parlay_team_leg_combo" (
	"id" text PRIMARY KEY NOT NULL,
	"parlay_id" text NOT NULL,
	"team_id" text NOT NULL,
	"leg_share_id" text NOT NULL,
	"added_by_user_id" text NOT NULL,
	"source_event_id" text NOT NULL,
	"combo_market_id" text NOT NULL,
	"combo_outcome_label" text NOT NULL,
	"option_label" text NOT NULL,
	"bet_type" text NOT NULL,
	"line" real,
	"shares" real NOT NULL,
	"stake" real NOT NULL,
	"entry_price" real NOT NULL,
	"result" text,
	"resolved_at" timestamp,
	"resolved_price" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parlay_team_leg_combo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "parlay_team_leg_combo" ADD CONSTRAINT "parlay_team_leg_combo_parlay_id_parlay_team_parlay_id_fk" FOREIGN KEY ("parlay_id") REFERENCES "public"."parlay_team_parlay"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team_leg_combo" ADD CONSTRAINT "parlay_team_leg_combo_team_id_parlay_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."parlay_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team_leg_combo" ADD CONSTRAINT "parlay_team_leg_combo_leg_share_id_parlay_team_parlay_share_id_fk" FOREIGN KEY ("leg_share_id") REFERENCES "public"."parlay_team_parlay_share"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parlay_team_leg_combo" ADD CONSTRAINT "parlay_team_leg_combo_added_by_user_id_user_profile_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."user_profile"("id") ON DELETE cascade ON UPDATE no action;